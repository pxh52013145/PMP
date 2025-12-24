import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import {
  useNavigation,
  type NavigationPageType,
  type NavigationParamsFor,
} from '../../contexts/NavigationContext';
import { parseNavigationParams } from '../../contracts/navigationParams';
import {
  getPmpmPluginEffectivePermissions,
  getPmpmPluginsRevision,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { ensurePmpmPluginRuntime, type PmpmPluginRuntime } from './pmpmRuntime';

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
  [K in NavigationPageType]: NavigationParamsFor<K> extends undefined ? K : never;
}[NavigationPageType];

type PageWithParams = Exclude<NavigationPageType, PageWithoutParams>;

const PAGES_REQUIRING_PARAMS = new Set<NavigationPageType>([
  'track',
  'album',
  'artist',
  'plugin-page',
  'plugin-visualizer',
]);

export type PluginMountApi = {
  audio: PluginAudioApi;
  navigation: PluginNavigationApi;
};

export function PluginMagnetHost({ pluginId }: { pluginId: string }) {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const permissions = useMemo(() => {
    void pluginStoreRevision;
    return getPmpmPluginEffectivePermissions(pluginId);
  }, [pluginId, pluginStoreRevision]);

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
              console.warn(
                `[PluginMagnetHost] navigateTo(${page}) requires params; ignoring request.`
              );
              return;
            }
            navigation.navigateTo(page as PageWithoutParams);
            return;
          }

          if (!PAGES_REQUIRING_PARAMS.has(page)) {
            console.warn(
              `[PluginMagnetHost] navigateTo(${page}) ignores params; navigating without params.`
            );
            navigation.navigateTo(page as PageWithoutParams);
            return;
          }

          const validated = parseNavigationParams(page, params);
          if (!validated) {
            console.warn(
              `[PluginMagnetHost] navigateTo(${page}) params invalid; ignoring request.`
            );
            return;
          }

          navigation.navigateTo(page as PageWithParams, validated as Record<string, unknown>);
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

    void ensurePmpmPluginRuntime(pluginId)
      .then((runtime) => {
        if (cancelled) return;
        try {
          const cleanup = (runtime as PmpmPluginRuntime).mount(container, api);
          cleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        recordPmpmPluginCrash(pluginId, err, 'magnet');
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
