import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { NavigationPageType, NavigationParamsFor } from '../../../contracts/navigation';
import { parseNavigationParams } from '../../../contracts/navigationParams';
import type { PlayMode, Track } from '../../../services/audio';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import { getDynamicColorsForImageUrl } from '../../../utils/dynamicColors';
import { closePluginWindow, openPluginWindow } from '../../../utils/pluginWindows';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  patchPmpmPluginConfig,
  readPmpmPluginConfig,
  subscribePmpmPluginConfig,
  clearPmpmPluginConfig,
  writePmpmPluginConfig,
  type PmpmPluginConfig,
} from '../pluginConfig';
import { recordPmpmPermissionDenied } from '../pmpmGovernance';
import { hasPermission, PLUGIN_PERMISSIONS } from './permissions';
import type {
  HostAudioService,
  HostNavigation,
  PluginCoverSnapshot,
  PluginMountApi,
  PluginNavigationSnapshot,
} from './types';

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

const PLAY_MODES = new Set<string>(['sequence', 'loop', 'single-loop', 'shuffle']);

export function createPluginMountApi({
  pluginId,
  hostLabel,
  permissions,
  audioService,
  navigation,
}: {
  pluginId: string;
  hostLabel: string;
  permissions: Set<string>;
  audioService: HostAudioService;
  navigation: HostNavigation;
}): PluginMountApi {
  const allowHost = hasPermission(permissions, PLUGIN_PERMISSIONS.host);
  const allowAudioState = hasPermission(permissions, PLUGIN_PERMISSIONS.audioState);
  const allowAudioControl = hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl);
  const allowAudioVisual = hasPermission(permissions, PLUGIN_PERMISSIONS.audioVisual);
  const allowAudioCover = hasPermission(permissions, PLUGIN_PERMISSIONS.audioCover);
  const allowNavigation = hasPermission(permissions, PLUGIN_PERMISSIONS.navigation);
  const allowPluginConfig = hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal);
  const allowWindows = hasPermission(permissions, PLUGIN_PERMISSIONS.window);

  const warnDenied = (capability: string, action: string) => {
    console.warn(`[${hostLabel}] Permission denied (${capability}): ${pluginId} -> ${action}`);
    try {
      recordPmpmPermissionDenied({ pluginId, hostLabel, capability, action });
    } catch {
      // ignore
    }
  };

  let coverCache: { key: string; value: PluginCoverSnapshot | null } | null = null;
  let coverInflight: { key: string; promise: Promise<PluginCoverSnapshot | null> } | null = null;

  const getCover = async (): Promise<PluginCoverSnapshot | null> => {
    if (!allowAudioCover) {
      warnDenied('api:audio-cover', 'audio.getCover()');
      return null;
    }

    const track = resolveCurrentTrack(audioService.getState());
    if (!track) return null;

    const cacheKey = buildTrackKey(track);
    if (!cacheKey) return null;

    if (coverCache?.key === cacheKey) {
      return coverCache.value;
    }
    if (coverInflight?.key === cacheKey) {
      return await coverInflight.promise;
    }

    const promise = (async (): Promise<PluginCoverSnapshot | null> => {
      const coverUrl = await resolveCoverDataUrl(track);
      if (!coverUrl) return null;

      const colors = await getDynamicColorsForImageUrl(coverUrl, cacheKey);
      return { url: coverUrl, colors };
    })();

    coverInflight = { key: cacheKey, promise };

    try {
      const value = await promise;
      coverCache = { key: cacheKey, value };
      return value;
    } finally {
      if (coverInflight?.key === cacheKey) {
        coverInflight = null;
      }
    }
  };

  const windowApi = {
    open: async (windowId: string, options?: { title?: string; width?: number; height?: number; x?: number; y?: number }) => {
      if (!allowWindows) {
        warnDenied('api:window', `window.open(${windowId})`);
        return;
      }
      if (typeof windowId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(windowId)) {
        console.warn(`[${hostLabel}] Invalid windowId "${String(windowId)}" (plugin=${pluginId})`);
        return;
      }

      await openPluginWindow({
        pluginId,
        windowId,
        title: options?.title,
        width: options?.width,
        height: options?.height,
        x: options?.x,
        y: options?.y,
      });
    },
    close: async (windowId: string) => {
      if (!allowWindows) {
        warnDenied('api:window', `window.close(${windowId})`);
        return;
      }
      if (typeof windowId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(windowId)) {
        console.warn(`[${hostLabel}] Invalid windowId "${String(windowId)}" (plugin=${pluginId})`);
        return;
      }
      await closePluginWindow(pluginId, windowId);
    },
  };

  const getNavigationSnapshot = (): PluginNavigationSnapshot | null => {
    if (!allowNavigation) {
      warnDenied('api:navigation', 'navigation.getSnapshot()');
      return null;
    }

    const getSnapshot = navigation.getSnapshot;
    if (typeof getSnapshot !== 'function') return null;

    try {
      const snap = getSnapshot();
      return snap && typeof snap === 'object'
        ? snap
        : null;
    } catch (error) {
      console.warn(`[${hostLabel}] navigation.getSnapshot() failed (plugin=${pluginId})`, error);
      return null;
    }
  };

  return {
    host: {
      getInfo: () => {
        if (!allowHost) {
          warnDenied('api:host', 'host.getInfo()');
          return null;
        }
        return {
          pluginId,
          hostLabel,
          hostApiVersion: HOST_API_VERSION,
          appVersion: APP_VERSION,
          runtime: isTauriRuntime() ? 'tauri' : 'web',
        };
      },
      listPermissions: () => {
        if (!allowHost) {
          warnDenied('api:host', 'host.listPermissions()');
          return [];
        }
        return Array.from(permissions);
      },
      hasPermission: (capability) => {
        if (!allowHost) {
          warnDenied('api:host', `host.hasPermission(${String(capability)})`);
          return false;
        }
        return hasPermission(permissions, String(capability ?? ''));
      },
    },
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
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onStateChange callback (plugin=${pluginId})`);
          return () => {};
        }
        return audioService.onStateChange((state) => cb(state));
      },
      onTimeUpdate: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onTimeUpdate(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onTimeUpdate callback (plugin=${pluginId})`);
          return () => {};
        }
        return audioService.onTimeUpdate(cb);
      },
      onEnded: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onEnded(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onEnded callback (plugin=${pluginId})`);
          return () => {};
        }
        return audioService.onEnded(cb);
      },
      onLoadProgress: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onLoadProgress(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onLoadProgress callback (plugin=${pluginId})`);
          return () => {};
        }
        if (typeof audioService.onLoadProgress !== 'function') return () => {};
        return audioService.onLoadProgress((value) => {
          try {
            cb(typeof value === 'number' && Number.isFinite(value) ? value : 0);
          } catch {
            // ignore
          }
        });
      },
      onError: (cb) => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.onError(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onError callback (plugin=${pluginId})`);
          return () => {};
        }
        if (typeof audioService.onError !== 'function') return () => {};
        return audioService.onError((error) => {
          try {
            cb(error instanceof Error ? error.message : String(error));
          } catch {
            // ignore
          }
        });
      },
      getCover,
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
        if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
          console.warn(`[${hostLabel}] Invalid seek(${String(time)}) (plugin=${pluginId})`);
          return;
        }
        audioService.seek(time);
      },
      setVolume: (volume) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.setVolume(${volume})`);
          return;
        }
        if (typeof volume !== 'number' || !Number.isFinite(volume)) {
          console.warn(`[${hostLabel}] Invalid setVolume(${String(volume)}) (plugin=${pluginId})`);
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
      playNext: async () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.playNext()');
          return;
        }
        const fn = audioService.playNext;
        if (typeof fn !== 'function') return;
        await fn.call(audioService);
      },
      playPrevious: async () => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', 'audio.playPrevious()');
          return;
        }
        const fn = audioService.playPrevious;
        if (typeof fn !== 'function') return;
        await fn.call(audioService);
      },
      playTrackAtIndex: async (index) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.playTrackAtIndex(${String(index)})`);
          return;
        }
        const int = typeof index === 'number' && Number.isFinite(index) ? Math.floor(index) : -1;
        if (int < 0) {
          console.warn(`[${hostLabel}] Invalid playTrackAtIndex(${String(index)}) (plugin=${pluginId})`);
          return;
        }
        const fn = audioService.playTrackAtIndex;
        if (typeof fn !== 'function') return;
        await fn.call(audioService, int);
      },
      getPlayMode: () => {
        if (!allowAudioState) {
          warnDenied('api:audio-state', 'audio.getPlayMode()');
          return null;
        }
        const fn = audioService.getPlayMode;
        if (typeof fn !== 'function') return null;
        try {
          const mode = fn.call(audioService);
          return typeof mode === 'string' ? mode : null;
        } catch {
          return null;
        }
      },
      setPlayMode: (mode) => {
        if (!allowAudioControl) {
          warnDenied('api:audio-control', `audio.setPlayMode(${String(mode)})`);
          return;
        }
        const normalized = typeof mode === 'string' ? mode.trim() : '';
        if (!PLAY_MODES.has(normalized)) {
          console.warn(`[${hostLabel}] Invalid play mode "${String(mode)}" (plugin=${pluginId})`);
          return;
        }
        const fn = audioService.setPlayMode;
        if (typeof fn !== 'function') return;
        try {
          fn.call(audioService, normalized as PlayMode);
        } catch {
          // ignore
        }
      },
    },
    visualizer: {
      getSpectrum: () => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.getSpectrum()');
          return null;
        }
        return audioService.getFrequencyData?.() ?? null;
      },
      onSpectrum: (cb, options) => {
        if (!allowAudioVisual) {
          warnDenied('api:audio-visual', 'visualizer.onSpectrum(cb)');
          return () => {};
        }

        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid onSpectrum callback (plugin=${pluginId})`);
          return () => {};
        }

        const intervalMs =
          typeof options?.intervalMs === 'number' && Number.isFinite(options.intervalMs)
            ? Math.max(16, Math.min(2000, Math.floor(options.intervalMs)))
            : 33;

        const handle = window.setInterval(() => {
          try {
            cb(audioService.getFrequencyData?.() ?? null);
          } catch (error) {
            console.warn(
              `[${hostLabel}] visualizer.onSpectrum callback failed (plugin=${pluginId})`,
              error
            );
          }
        }, intervalMs);

        return () => {
          window.clearInterval(handle);
        };
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
            console.warn(`[${hostLabel}] navigateTo(${page}) requires params; ignoring request.`);
            return;
          }
          navigation.navigateTo(page as PageWithoutParams);
          return;
        }

        if (!PAGES_REQUIRING_PARAMS.has(page)) {
          console.warn(`[${hostLabel}] navigateTo(${page}) ignores params; navigating without params.`);
          navigation.navigateTo(page as PageWithoutParams);
          return;
        }

        const validated = parseNavigationParams(page, params);
        if (!validated) {
          console.warn(`[${hostLabel}] navigateTo(${page}) params invalid; ignoring request.`);
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
      getSnapshot: getNavigationSnapshot,
      onChange: (cb) => {
        if (!allowNavigation) {
          warnDenied('api:navigation', 'navigation.onChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid navigation.onChange callback (plugin=${pluginId})`);
          return () => {};
        }

        const subscribe = navigation.subscribe;
        if (typeof subscribe !== 'function') return () => {};

        return subscribe((snapshot) => {
          try {
            cb(snapshot);
          } catch (error) {
            console.warn(`[${hostLabel}] navigation.onChange callback failed (plugin=${pluginId})`, error);
          }
        });
      },
      canGoBack: () => {
        const snap = getNavigationSnapshot();
        return Boolean(snap && typeof snap.currentIndex === 'number' && snap.currentIndex > 0);
      },
    },
    config: {
      get: () => {
        if (!allowPluginConfig) {
          warnDenied('storage:local', 'config.get()');
          return {};
        }
        return readPmpmPluginConfig(pluginId);
      },
      set: (next) => {
        if (!allowPluginConfig) {
          warnDenied('storage:local', 'config.set(next)');
          return;
        }
        writePmpmPluginConfig(pluginId, next as PmpmPluginConfig);
      },
      patch: (next) => {
        if (!allowPluginConfig) {
          warnDenied('storage:local', 'config.patch(next)');
          return;
        }
        patchPmpmPluginConfig(pluginId, next);
      },
      reset: () => {
        if (!allowPluginConfig) {
          warnDenied('storage:local', 'config.reset()');
          return;
        }
        clearPmpmPluginConfig(pluginId);
      },
      onChange: (cb) => {
        if (!allowPluginConfig) {
          warnDenied('storage:local', 'config.onChange(cb)');
          return () => {};
        }
        if (typeof cb !== 'function') {
          console.warn(`[${hostLabel}] Invalid config.onChange callback (plugin=${pluginId})`);
          return () => {};
        }
        return subscribePmpmPluginConfig(pluginId, cb);
      },
    },
    window: windowApi,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function resolveCurrentTrack(state: unknown): Track | null {
  if (!isRecord(state)) return null;
  const current = state.currentTrack;
  if (!isRecord(current)) return null;

  const id = readNonEmptyString(current.id) ?? readNonEmptyString(current.filePath) ?? readNonEmptyString(current.path);
  if (!id) return null;

  const title = readNonEmptyString(current.title) ?? id;

  const track: Track = {
    id,
    title,
  };

  const filePath = readNonEmptyString(current.filePath);
  if (filePath) track.filePath = filePath;

  const path = readNonEmptyString(current.path);
  if (path) track.path = path;

  const originalPath = readNonEmptyString(current.originalPath);
  if (originalPath) track.originalPath = originalPath;

  const coverKey = readNonEmptyString(current.coverKey);
  if (coverKey) track.coverKey = coverKey;

  const coverUrl = readNonEmptyString(current.coverUrl);
  if (coverUrl) track.coverUrl = coverUrl;

  const artist = readNonEmptyString(current.artist);
  if (artist) track.artist = artist;

  const album = readNonEmptyString(current.album);
  if (album) track.album = album;

  return track;
}

function buildTrackKey(track: Track): string | null {
  return (
    readNonEmptyString(track.coverKey) ||
    readNonEmptyString(track.id) ||
    readNonEmptyString(track.filePath) ||
    readNonEmptyString(track.path) ||
    readNonEmptyString(track.originalPath) ||
    readNonEmptyString(track.title) ||
    null
  );
}

async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function resolveCoverDataUrl(track: Track): Promise<string | null> {
  const existing = readNonEmptyString(track.coverUrl);
  if (existing) {
    const lower = existing.toLowerCase();
    if (lower.startsWith('data:')) return existing;
    if (lower.startsWith('http:') || lower.startsWith('https:')) return existing;
    if (lower.startsWith('blob:')) return await blobUrlToDataUrl(existing);
  }

  const resolved = await musicLibraryService.getCoverUrlForTrack(track);
  const url = readNonEmptyString(resolved);
  if (!url) return null;

  const lower = url.toLowerCase();
  if (lower.startsWith('data:')) return url;
  if (lower.startsWith('http:') || lower.startsWith('https:')) return url;
  if (lower.startsWith('blob:')) return await blobUrlToDataUrl(url);

  return null;
}
