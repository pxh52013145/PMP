import type { NavigationPageType, NavigationParamsFor } from './navigation';

export type TrackPageParams = { trackId: string };
export type AlbumPageParams = { albumName: string; artist?: string };
export type ArtistPageParams = { artist: string };
export type PluginPageParams = { pluginId: string; pageId: string };
export type PluginVisualizerParams = { pluginId: string; visualizerId: string };
export type DebugPageParams = { tab?: 'debug-center' | 'perf-monitor' | 'native-debug' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeId(value: string): boolean {
  return /^[a-z0-9-]{1,48}$/.test(value);
}

export function parseNavigationParams<K extends NavigationPageType>(
  type: K,
  params: unknown
): NavigationParamsFor<K> | undefined {
  switch (type) {
    case 'debug': {
      if (params === undefined || params === null) return undefined;
      if (!isRecord(params)) return undefined;
      const tab = typeof params.tab === 'string' ? params.tab : undefined;
      if (tab === 'debug-center' || tab === 'perf-monitor' || tab === 'native-debug') {
        return { tab } as NavigationParamsFor<K>;
      }
      return undefined;
    }
    case 'track': {
      if (!isRecord(params)) return undefined;

      const trackId = typeof params.trackId === 'string' ? params.trackId : undefined;
      if (trackId && isSafeId(trackId)) {
        return { trackId } as NavigationParamsFor<K>;
      }

      // Backward compatible: allow passing a Track-like payload but keep only the id to avoid retaining large objects.
      const track = params.track;
      if (isRecord(track)) {
        const legacyId = typeof track.id === 'string' ? track.id : undefined;
        if (legacyId && isSafeId(legacyId)) {
          return { trackId: legacyId } as NavigationParamsFor<K>;
        }
      }

      return undefined;
    }
    case 'album': {
      if (!isRecord(params)) return undefined;
      const albumName = typeof params.albumName === 'string' ? params.albumName : undefined;
      if (!albumName) return undefined;
      const artist = typeof params.artist === 'string' ? params.artist : undefined;
      return { albumName, artist } as NavigationParamsFor<K>;
    }
    case 'artist': {
      if (!isRecord(params)) return undefined;
      const artist = typeof params.artist === 'string' ? params.artist : undefined;
      if (!artist) return undefined;
      return { artist } as NavigationParamsFor<K>;
    }
    case 'plugin-page': {
      if (!isRecord(params)) return undefined;
      const pluginId = typeof params.pluginId === 'string' ? params.pluginId : undefined;
      const pageId = typeof params.pageId === 'string' ? params.pageId : undefined;
      if (!pluginId || !pageId) return undefined;
      if (!isSafeId(pluginId) || !isSafeId(pageId)) return undefined;
      return { pluginId, pageId } as NavigationParamsFor<K>;
    }
    case 'plugin-visualizer': {
      if (!isRecord(params)) return undefined;
      const pluginId = typeof params.pluginId === 'string' ? params.pluginId : undefined;
      const visualizerId =
        typeof params.visualizerId === 'string' ? params.visualizerId : undefined;
      if (!pluginId || !visualizerId) return undefined;
      if (!isSafeId(pluginId) || !isSafeId(visualizerId)) return undefined;
      return { pluginId, visualizerId } as NavigationParamsFor<K>;
    }
    default:
      return undefined;
  }
}
