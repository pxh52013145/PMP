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

async function loadPluginRuntime(pluginId: string): Promise<PluginRuntime> {
  const installed = getInstalledPmpmPlugin(pluginId);
  if (!installed) {
    throw new Error(`Plugin not installed: ${pluginId}`);
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
  const promise = loadPluginRuntime(pluginId);
  runtimeCache.set(pluginId, promise);
  return promise;
}

export function PluginMagnetHost({ pluginId }: { pluginId: string }) {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo<PluginMountApi>(() => {
    return {
      audio: {
        getState: () => audioService.getState(),
        onStateChange: (cb) => audioService.onStateChange((state) => cb(state)),
        onTimeUpdate: (cb) => audioService.onTimeUpdate(cb),
        onEnded: (cb) => audioService.onEnded(cb),
        play: () => audioService.play(),
        pause: () => audioService.pause(),
        stop: () => audioService.stop(),
        seek: (time) => audioService.seek(time),
        setVolume: (volume) => audioService.setVolume(volume),
        toggleMute: () => audioService.toggleMute(),
      },
      navigation: {
        navigateTo: (page, params) => {
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
        goBack: () => navigation.goBack(),
      },
    };
  }, [audioService, navigation]);

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
