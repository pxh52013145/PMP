import { Track } from '../../services/audio';

const MUSIC_LIBRARY_TRACK_TEXT_MAX_CHARS = 120;
const MUSIC_LIBRARY_TRACK_TEXT_INTERN_POOL_MAX = 4096;
const MUSIC_LIBRARY_DYNAMIC_ARRAY_ITEM_LIMIT = 12;

const DYNAMIC_TRACK_FIELD_EXCLUDED_KEYS = new Set<string>([
  'id',
  'path',
  'filePath',
  'originalPath',
  'libraryPathId',
  'mtimeMs',
  'quickFingerprint',
  'metadataScannedAtMs',
  'coverKey',
  'coverUrl',
  'comment',
  'mimeType',
  'addedAt',
  'fileHandle',
  'file',
  'fileContent',
  'lyrics',
]);

const trackTextInternPool = new Map<string, string>();

function trimTrackText(value: unknown, maxChars: number = MUSIC_LIBRARY_TRACK_TEXT_MAX_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function internTrackText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const existing = trackTextInternPool.get(value);
  if (existing) return existing;
  trackTextInternPool.set(value, value);
  if (trackTextInternPool.size > MUSIC_LIBRARY_TRACK_TEXT_INTERN_POOL_MAX) {
    const oldestKey = trackTextInternPool.keys().next().value as string | undefined;
    if (oldestKey) trackTextInternPool.delete(oldestKey);
  }
  return value;
}

function compactDynamicTrackFieldValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return internTrackText(trimTrackText(value));
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : undefined;
  }

  if (Array.isArray(value)) {
    const compacted = value
      .slice(0, MUSIC_LIBRARY_DYNAMIC_ARRAY_ITEM_LIMIT)
      .map((item) => {
        if (typeof item === 'string') {
          return internTrackText(trimTrackText(item));
        }
        if (typeof item === 'number') {
          return Number.isFinite(item) ? item : undefined;
        }
        if (typeof item === 'boolean') {
          return item;
        }
        return undefined;
      })
      .filter((item): item is string | number | boolean => item !== undefined);

    return compacted.length > 0 ? compacted : undefined;
  }

  return undefined;
}

export function isMusicLibraryDynamicTrackFieldExcluded(key: string): boolean {
  return DYNAMIC_TRACK_FIELD_EXCLUDED_KEYS.has(key);
}

export function compactTrackForMusicLibrary(track: Track): Track {
  const safePath = typeof track.filePath === 'string' && track.filePath ? track.filePath : track.path;
  const normalizedCoverUrl = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
  const normalizedCoverLower = normalizedCoverUrl.toLowerCase();
  const safeCoverUrl =
    normalizedCoverLower.startsWith('blob:') ||
    normalizedCoverLower.startsWith('http://') ||
    normalizedCoverLower.startsWith('https://') ||
    normalizedCoverLower.startsWith('pmp://cover/')
      ? normalizedCoverUrl
      : undefined;
  const safeTitle = internTrackText(trimTrackText(track.title) || track.id) || track.id;
  const safeArtist = internTrackText(trimTrackText(track.artist));
  const safeAlbum = internTrackText(trimTrackText(track.album));
  const safeGenre = internTrackText(trimTrackText(track.genre));
  const safeCoverKey = internTrackText(trimTrackText(track.coverKey, 256));
  const safeOriginalPath = internTrackText(trimTrackText(track.originalPath, 512));
  const safeQuickFingerprint = internTrackText(trimTrackText(track.quickFingerprint, 80));
  const safeComposer = internTrackText(trimTrackText(track.composer));
  const safeFormat = internTrackText(trimTrackText(track.format, 32));
  const safeCodecName = internTrackText(trimTrackText(track.codecName, 48));

  const compactedTrack: Track & Record<string, unknown> = {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    album: safeAlbum,
    genre: safeGenre,
    duration: typeof track.duration === 'number' ? track.duration : undefined,
    year: typeof track.year === 'number' ? track.year : undefined,
    trackNumber: typeof track.trackNumber === 'number' ? track.trackNumber : undefined,
    discNumber: typeof track.discNumber === 'number' ? track.discNumber : undefined,
    composer: safeComposer,
    bitrate: typeof track.bitrate === 'number' ? track.bitrate : undefined,
    sampleRate: typeof track.sampleRate === 'number' ? track.sampleRate : undefined,
    format: safeFormat,
    codecName: safeCodecName,
    fileSize: typeof track.fileSize === 'number' ? track.fileSize : undefined,
    dateAdded: typeof track.dateAdded === 'number' ? track.dateAdded : undefined,
    lastPlayed: typeof track.lastPlayed === 'number' ? track.lastPlayed : undefined,
    playCount: typeof track.playCount === 'number' ? track.playCount : undefined,
    rating: typeof track.rating === 'number' ? track.rating : undefined,
    favorite: typeof track.favorite === 'boolean' ? track.favorite : undefined,
    filePath: typeof safePath === 'string' && safePath ? safePath : track.filePath,
    path: safePath,
    originalPath: safeOriginalPath,
    fileHandle: safePath ? undefined : track.fileHandle,
    coverKey: safeCoverKey,
    coverUrl: safeCoverUrl,
    quickFingerprint: safeQuickFingerprint,
    replayGainTrackGainDb:
      typeof track.replayGainTrackGainDb === 'number' ? track.replayGainTrackGainDb : undefined,
    replayGainAlbumGainDb:
      typeof track.replayGainAlbumGainDb === 'number' ? track.replayGainAlbumGainDb : undefined,
  };

  for (const [key, value] of Object.entries(track as unknown as Record<string, unknown>)) {
    if (key in compactedTrack || isMusicLibraryDynamicTrackFieldExcluded(key)) {
      continue;
    }

    const compactedValue = compactDynamicTrackFieldValue(value);
    if (compactedValue !== undefined) {
      compactedTrack[key] = compactedValue;
    }
  }

  return compactedTrack;
}

export function compactTracksForMusicLibrary(tracks: Track[]): Track[] {
  if (tracks.length === 0) return tracks;
  return tracks.map(compactTrackForMusicLibrary);
}
