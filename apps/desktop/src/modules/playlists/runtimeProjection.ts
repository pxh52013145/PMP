import type { Playlist, Track } from '../../services/audio';

export type PlaylistTrackSortField = 'default' | 'title' | 'artist' | 'album' | 'duration';

export type PlaylistTrackSortDirection = 'asc' | 'desc';

const PLAYLIST_COVER_HEAD_SCAN_LIMIT = 5;

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolvePlaylistTrackIndexes(options: {
  tracks: Track[];
  searchQuery: string;
  sortField: PlaylistTrackSortField;
  sortDirection: PlaylistTrackSortDirection;
  collator?: Intl.Collator;
}): number[] {
  const tracks = Array.isArray(options.tracks) ? options.tracks : [];
  if (tracks.length === 0) return [];

  const normalizedQuery = options.searchQuery.trim().toLocaleLowerCase();
  const filteredIndexes: number[] = [];

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (!track) continue;

    if (!normalizedQuery) {
      filteredIndexes.push(index);
      continue;
    }

    const title = String(track.title || '').toLocaleLowerCase();
    const artist = String(track.artist || '').toLocaleLowerCase();
    const album = String(track.album || '').toLocaleLowerCase();
    if (
      title.includes(normalizedQuery) ||
      artist.includes(normalizedQuery) ||
      album.includes(normalizedQuery)
    ) {
      filteredIndexes.push(index);
    }
  }

  if (options.sortField === 'default' || filteredIndexes.length <= 1) {
    return filteredIndexes;
  }

  const collator =
    options.collator ?? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const sortedIndexes = [...filteredIndexes];
  sortedIndexes.sort((leftIndex, rightIndex) => {
    const left = tracks[leftIndex];
    const right = tracks[rightIndex];
    if (!left || !right) {
      return leftIndex - rightIndex;
    }

    let result = 0;
    if (options.sortField === 'title') {
      result = collator.compare(left.title || '', right.title || '');
    } else if (options.sortField === 'artist') {
      result = collator.compare(left.artist || '', right.artist || '');
    } else if (options.sortField === 'album') {
      result = collator.compare(left.album || '', right.album || '');
    } else if (options.sortField === 'duration') {
      result = (left.duration ?? 0) - (right.duration ?? 0);
    }

    if (result === 0) {
      result = leftIndex - rightIndex;
    }

    return options.sortDirection === 'desc' ? -result : result;
  });

  return sortedIndexes;
}

export function resolvePlaylistCoverUrl(
  playlist: Playlist | null,
  resolvedCoverUrl?: string
): string {
  if (!playlist || playlist.kind === 'smart') {
    return '';
  }

  const explicitCoverUrl = normalizeText(playlist.coverUrl);
  if (explicitCoverUrl) {
    return explicitCoverUrl;
  }

  const runtimeCoverUrl = normalizeText(resolvedCoverUrl);
  if (runtimeCoverUrl) {
    return runtimeCoverUrl;
  }

  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const scanLimit = Math.min(tracks.length, PLAYLIST_COVER_HEAD_SCAN_LIMIT);
  for (let index = 0; index < scanLimit; index += 1) {
    const trackCoverUrl = normalizeText(tracks[index]?.coverUrl);
    if (trackCoverUrl) {
      return trackCoverUrl;
    }
  }

  return '';
}

export function partitionPlaylistCoverUrlsForRelease(urls: Iterable<string>): {
  trackedUrls: string[];
  pageOwnedUrls: string[];
} {
  const trackedUrls: string[] = [];
  const pageOwnedUrls: string[] = [];
  const seenUrls = new Set<string>();

  for (const rawUrl of urls) {
    const normalizedUrl = normalizeText(rawUrl);
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    trackedUrls.push(normalizedUrl);
    if (normalizedUrl.startsWith('blob:')) {
      pageOwnedUrls.push(normalizedUrl);
    }
  }

  return {
    trackedUrls,
    pageOwnedUrls,
  };
}

export function pruneResolvedPlaylistCoverMap(
  resolvedCoverMap: Record<string, string>,
  targetIds: Iterable<string>
): {
  changed: boolean;
  nextMap: Record<string, string>;
  releasedUrls: string[];
} {
  const targetIdSet = new Set<string>();
  for (const targetId of targetIds) {
    if (typeof targetId !== 'string') continue;
    const normalizedTargetId = targetId.trim();
    if (!normalizedTargetId) continue;
    targetIdSet.add(normalizedTargetId);
  }

  const nextMap: Record<string, string> = {};
  const keptUrlSet = new Set<string>();
  const removedUrlSet = new Set<string>();
  let changed = false;

  for (const [playlistId, rawUrl] of Object.entries(resolvedCoverMap)) {
    const normalizedPlaylistId = playlistId.trim();
    const normalizedUrl = normalizeText(rawUrl);

    if (targetIdSet.has(normalizedPlaylistId) && normalizedUrl) {
      nextMap[normalizedPlaylistId] = normalizedUrl;
      keptUrlSet.add(normalizedUrl);
      continue;
    }

    changed = true;
    if (normalizedUrl) {
      removedUrlSet.add(normalizedUrl);
    }
  }

  const releasedUrls: string[] = [];
  for (const removedUrl of removedUrlSet) {
    if (!keptUrlSet.has(removedUrl)) {
      releasedUrls.push(removedUrl);
    }
  }

  return {
    changed,
    nextMap: changed ? nextMap : resolvedCoverMap,
    releasedUrls,
  };
}
