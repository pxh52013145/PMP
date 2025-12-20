import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import {
  useNavigation,
  type NavigationPageType,
  type NavigationParamsMap,
} from '../../contexts/NavigationContext';
import { getInstalledPmpmPlugin } from './pmpm';

type PluginAudioApi = {
  getState: () => unknown;
  onStateChange: (cb: (state: unknown) => void) => () => void;
  onTimeUpdate: (cb: (time: number) => void) => () => void;
  onEnded: (cb: () => void) => () => void;
  play: () => Promise<void>;
  pause: () => Promise<void> | void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
};

type PluginNavigationApi = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type PageWithoutParams = {
  [K in NavigationPageType]: NavigationParamsMap[K] extends undefined ? K : never;
}[NavigationPageType];

type PageWithParams = Exclude<NavigationPageType, PageWithoutParams>;

const PAGES_REQUIRING_PARAMS = new Set<NavigationPageType>(['track', 'album', 'artist']);

export type PluginMountApi = {
  audio: PluginAudioApi;
  navigation: PluginNavigationApi;
};

type PluginRuntime = {
  mount: (container: HTMLElement, api: PluginMountApi) => void | (() => void);
  unmount?: (container: HTMLElement) => void;
};

const runtimeCache = new Map<string, Promise<PluginRuntime>>();

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256HexFromString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

async function loadPluginRuntime(pluginId: string): Promise<PluginRuntime> {
  const installed = getInstalledPmpmPlugin(pluginId);
  if (!installed) {
    throw new Error(`Plugin not installed: ${pluginId}`);
  }

  if (installed.entrySha256) {
    const computed = await sha256HexFromString(installed.entryCode);
    if (computed !== installed.entrySha256) {
      throw new Error(
        `Plugin integrity check failed (entrySha256 mismatch). Please reinstall: ${pluginId}`
      );
    }
  }

  const blob = new Blob([installed.entryCode], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    const mount =
      (mod.mount as PluginRuntime['mount'] | undefined) ??
      ((mod.default as { mount?: PluginRuntime['mount'] } | undefined)?.mount as
        | PluginRuntime['mount']
        | undefined);
    const unmount =
      (mod.unmount as PluginRuntime['unmount'] | undefined) ??
      ((mod.default as { unmount?: PluginRuntime['unmount'] } | undefined)?.unmount as
        | PluginRuntime['unmount']
        | undefined);

    if (typeof mount !== 'function') {
      throw new Error('Plugin entry must export `mount(container, api)`');
    }

    return { mount, unmount };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ensurePluginRuntime(pluginId: string): Promise<PluginRuntime> {
  const existing = runtimeCache.get(pluginId);
  if (existing) return existing;
  const promise = loadPluginRuntime(pluginId).catch((err) => {
    runtimeCache.delete(pluginId);
    throw err;
  });
  runtimeCache.set(pluginId, promise);
  return promise;
}

export function PluginMagnetHost({ pluginId }: { pluginId: string }) {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const permissions = useMemo(() => {
    const installed = getInstalledPmpmPlugin(pluginId);
    return new Set(installed?.manifest.permissions ?? []);
  }, [pluginId]);

  const api = useMemo<PluginMountApi>(() => {
    const allowAudioState = permissions.has('api:audio-state');
    const allowAudioControl = permissions.has('api:audio-control');
    const allowNavigation = permissions.has('api:navigation');

    const warnDenied = (capability: string, action: string) => {
      console.warn(`[PluginMagnetHost] Permission denied (${capability}): ${pluginId} -> ${action}`);
    };

    return {
      audio: {
        getState: () => {
          if (!allowAudioState) {
            warnDenied('api:audio-state', 'audio.getState()');
            return null;
          }
          return audioService.getState();
        },
        onStateChange: (cb) => {
          if (!allowAudioState) {
            warnDenied('api:audio-state', 'audio.onStateChange(cb)');
            return () => {};
          }
          return audioService.onStateChange((state) => cb(state));
        },
        onTimeUpdate: (cb) => {
          if (!allowAudioState) {
            warnDenied('api:audio-state', 'audio.onTimeUpdate(cb)');
            return () => {};
          }
          return audioService.onTimeUpdate(cb);
        },
        onEnded: (cb) => {
          if (!allowAudioState) {
            warnDenied('api:audio-state', 'audio.onEnded(cb)');
            return () => {};
          }
          return audioService.onEnded(cb);
        },
        play: async () => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', 'audio.play()');
            return;
          }
          await audioService.play();
        },
        pause: () => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', 'audio.pause()');
            return;
          }
          return audioService.pause();
        },
        stop: () => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', 'audio.stop()');
            return;
          }
          audioService.stop();
        },
        seek: (time) => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', `audio.seek(${time})`);
            return;
          }
          audioService.seek(time);
        },
        setVolume: (volume) => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', `audio.setVolume(${volume})`);
            return;
          }
          audioService.setVolume(volume);
        },
        toggleMute: () => {
          if (!allowAudioControl) {
            warnDenied('api:audio-control', 'audio.toggleMute()');
            return;
          }
          audioService.toggleMute();
        },
      },
      navigation: {
        navigateTo: (page, params) => {
          if (!allowNavigation) {
            warnDenied('api:navigation', `navigation.navigateTo(${page})`);
            return;
          }
          if (params === undefined) {
            if (PAGES_REQUIRING_PARAMS.has(page)) {
              console.warn(`[PluginMagnetHost] navigateTo(${page}) requires params; ignoring request.`);
              return;
            }
            navigation.navigateTo(page as PageWithoutParams);
            return;
          }

          if (!PAGES_REQUIRING_PARAMS.has(page)) {
            console.warn(`[PluginMagnetHost] navigateTo(${page}) ignores params; navigating without params.`);
            navigation.navigateTo(page as PageWithoutParams);
            return;
          }
 
          navigation.navigateTo(page as PageWithParams, params as never);
        },
        goBack: () => {
          if (!allowNavigation) {
            warnDenied('api:navigation', 'navigation.goBack()');
            return;
          }
          navigation.goBack();
        },
      },
    };
  }, [audioService, navigation, permissions, pluginId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setError(null);

    void ensurePluginRuntime(pluginId)
      .then((runtime) => {
        if (cancelled) return;
        try {
          const cleanup = runtime.mount(container, api);
          cleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      try {
        cleanupRef.current?.();
      } finally {
        cleanupRef.current = null;
        container.innerHTML = '';
      }
    };
  }, [api, pluginId]);

  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Error</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
