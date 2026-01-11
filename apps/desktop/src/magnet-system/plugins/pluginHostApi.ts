import type { NavigationPageType, NavigationParamsFor } from '../../contexts/NavigationContext';
import { closePluginWindow, openPluginWindow } from '../../utils/pluginWindows';
import { parseNavigationParams } from '../../contracts/navigationParams';
import type { Track } from '../../services/audio';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { getDynamicColorsForImageUrl, type DynamicColors } from '../../utils/dynamicColors';
import {
  patchPmpmPluginConfig,
  readPmpmPluginConfig,
  subscribePmpmPluginConfig,
  clearPmpmPluginConfig,
  writePmpmPluginConfig,
  type PmpmPluginConfig,
} from './pluginConfig';
import { recordPmpmPermissionDenied } from './pmpm';

export type PluginAudioApi = {
  getState: () => unknown;
  onStateChange: (cb: (state: unknown) => void) => () => void;
  onTimeUpdate: (cb: (time: number) => void) => () => void;
  onEnded: (cb: () => void) => () => void;
  getCover: () => Promise<PluginCoverSnapshot | null>;
  play: () => Promise<void>;
  pause: () => Promise<void> | void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
};

export type PluginVisualizerApi = {
  getSpectrum: () => Uint8Array | null;
  onSpectrum: (
    cb: (bins: Uint8Array | null) => void,
    options?: { intervalMs?: number }
  ) => () => void;
};

export type PluginCoverSnapshot = {
  url: string;
  colors: DynamicColors;
};

export type PluginNavigationApi = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

export type PluginConfigApi = {
  get: () => PmpmPluginConfig;
  set: (next: PmpmPluginConfig) => void;
  patch: (next: Record<string, unknown>) => void;
  reset: () => void;
  onChange: (cb: (config: PmpmPluginConfig) => void) => () => void;
};

export type PluginWindowApi = {
  open: (
    windowId: string,
    options?: {
      title?: string;
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    }
  ) => Promise<void>;
  close: (windowId: string) => Promise<void>;
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
  visualizer: PluginVisualizerApi;
  navigation: PluginNavigationApi;
  config: PluginConfigApi;
  window: PluginWindowApi;
};

export type HostAudioService = {
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
  getFrequencyData?: () => Uint8Array | null;
};

export type HostNavigation = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

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
  const allowAudioState = permissions.has('api:audio-state');
  const allowAudioControl = permissions.has('api:audio-control');
  const allowAudioVisual = permissions.has('api:audio-visual');
  const allowAudioCover = permissions.has('api:audio-cover');
  const allowNavigation = permissions.has('api:navigation');
  const allowPluginConfig = permissions.has('storage:local');
  const allowWindows = permissions.has('api:window');

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

  const windowApi: PluginWindowApi = {
    open: async (windowId, options) => {
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
    close: async (windowId) => {
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
            console.warn(`[${hostLabel}] visualizer.onSpectrum callback failed (plugin=${pluginId})`, error);
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
        writePmpmPluginConfig(pluginId, next);
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
