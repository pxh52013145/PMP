import type { Track } from '../services/audio';
import type { NavigationPageType, NavigationParamsFor } from './navigation';

export type TrackPageParams = { track: Track };
export type AlbumPageParams = { albumName: string; artist?: string; tracks?: Track[] };
export type ArtistPageParams = { artist: string };
export type PluginPageParams = { pluginId: string; pageId: string };
export type PluginVisualizerParams = { pluginId: string; visualizerId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeId(value: string): boolean {
  return /^[a-z0-9-]{1,48}$/.test(value);
}

export function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.title === 'string';
}

export function parseNavigationParams<K extends NavigationPageType>(
  type: K,
  params: unknown
): NavigationParamsFor<K> | undefined {
  switch (type) {
    case 'track': {
      if (!isRecord(params)) return undefined;
      const track = params.track;
      if (!isTrack(track)) return undefined;
      return { track } as NavigationParamsFor<K>;
    }
    case 'album': {
      if (!isRecord(params)) return undefined;
      const albumName = typeof params.albumName === 'string' ? params.albumName : undefined;
      if (!albumName) return undefined;
      const artist = typeof params.artist === 'string' ? params.artist : undefined;
      const tracks = Array.isArray(params.tracks) ? params.tracks.filter(isTrack) : undefined;
      return { albumName, artist, tracks } as NavigationParamsFor<K>;
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
