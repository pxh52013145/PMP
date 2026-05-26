import type { Track } from './types';

const MAX_EMBEDDED_COVER_URL_LENGTH = 16 * 1024;
const MAX_RETAINED_TRACK_COMMENT_LENGTH = 512;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalStringWithMax(value: unknown, maxChars: number): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars);
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isAbsolutePath(pathValue: string): boolean {
  if (!pathValue) return false;
  if (pathValue.startsWith('/')) return true;
  return /^[a-zA-Z]:[\\/]/.test(pathValue);
}

function projectPathFields(track: Track): {
  filePath?: string;
  path?: string;
  originalPath?: string;
} {
  const filePath = normalizeOptionalString(track.filePath);
  const path = normalizeOptionalString(track.path);
  const originalPath = normalizeOptionalString(track.originalPath);
  const canonicalPath = filePath ?? path;

  if (canonicalPath && isAbsolutePath(canonicalPath)) {
    return {
      filePath: canonicalPath,
      originalPath: originalPath ?? canonicalPath,
    };
  }

  return {
    filePath,
    path,
    originalPath,
  };
}

function looksLikeSourceLocator(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return /^[a-z][a-z0-9+.-]*:\/\//.test(normalized) || normalized.includes('bvid=');
}

function sanitizeProjectedComment(
  track: Track,
  normalizedPath: string,
  originalPath: string | undefined
): string | undefined {
  const comment = normalizeOptionalStringWithMax(track.comment, MAX_RETAINED_TRACK_COMMENT_LENGTH);
  if (!comment) return undefined;

  if (originalPath && !isAbsolutePath(originalPath)) {
    return comment;
  }

  if (!normalizedPath || !isAbsolutePath(normalizedPath)) {
    return comment;
  }

  return looksLikeSourceLocator(comment) ? comment : undefined;
}

function sanitizeCoverUrl(track: Track): string | undefined {
  const coverUrl = normalizeOptionalString(track.coverUrl);
  if (!coverUrl) return undefined;

  const lowerCoverUrl = coverUrl.toLowerCase();
  if (
    lowerCoverUrl.startsWith('data:') ||
    lowerCoverUrl.startsWith('blob:') ||
    coverUrl.length > MAX_EMBEDDED_COVER_URL_LENGTH
  ) {
    return undefined;
  }

  if (
    lowerCoverUrl.startsWith('pmp://cover/') ||
    lowerCoverUrl.startsWith('http://') ||
    lowerCoverUrl.startsWith('https://')
  ) {
    return coverUrl;
  }

  return undefined;
}

const PLAYBACK_SOURCE_STRING_FIELDS = [
  'sourceLocator',
  'source_locator',
  'streamUrl',
  'stream_url',
  'cachePath',
  'cache_path',
  'connectorId',
  'connector_id',
  'sourceConnectorId',
  'source_connector_id',
  'sourceId',
  'source_id',
  'mimeType',
  'mime_type',
] as const;

const PLAYBACK_SOURCE_NUMBER_FIELDS = ['expiresAtMs', 'expires_at_ms', 'durationSeconds'] as const;
const PLAYBACK_SOURCE_BOOLEAN_FIELDS = ['seekable', 'rangeRequests', 'range_requests'] as const;

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeOptionalString(key);
    const normalizedValue = normalizeOptionalString(entryValue);
    if (!normalizedKey || !normalizedValue) continue;
    normalized[normalizedKey] = normalizedValue;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function copyPlaybackSourceFields(track: Track, compacted: Track): void {
  const source = track as unknown as Record<string, unknown>;
  const target = compacted as unknown as Record<string, unknown>;

  for (const key of PLAYBACK_SOURCE_STRING_FIELDS) {
    const value = normalizeOptionalString(source[key]);
    if (value) target[key] = value;
  }

  for (const key of PLAYBACK_SOURCE_NUMBER_FIELDS) {
    const value = normalizeOptionalNumber(source[key]);
    if (value !== undefined) target[key] = value;
  }

  for (const key of PLAYBACK_SOURCE_BOOLEAN_FIELDS) {
    const value = normalizeOptionalBoolean(source[key]);
    if (value !== undefined) target[key] = value;
  }

  const headers = normalizeStringRecord(source.headers);
  if (headers) target.headers = headers;
}

type ProjectedTrackCore = {
  id: string;
  title: string;
  filePath?: string;
  path?: string;
  originalPath?: string;
  normalizedPath: string;
  projectedComment?: string;
};

function resolveProjectedTrackCore(track: Track): ProjectedTrackCore {
  const id = normalizeOptionalString(track.id) ?? '';
  const { filePath, path, originalPath } = projectPathFields(track);
  const normalizedPath = filePath ?? path ?? '';
  const projectedComment = sanitizeProjectedComment(track, normalizedPath, originalPath);
  const title =
    normalizeOptionalString(track.title) ??
    originalPath?.split(/[/\\]/).pop() ??
    path?.split(/[/\\]/).pop() ??
    id;

  return {
    id,
    title,
    filePath,
    path,
    originalPath,
    normalizedPath,
    projectedComment,
  };
}

function attachProjectedFileHandle(track: Track, normalizedPath: string, compacted: Track): void {
  if (!isAbsolutePath(normalizedPath) && track.fileHandle) {
    compacted.fileHandle = track.fileHandle;
  }
}

export function compactTrackForState(track: Track): Track {
  const { id, title, filePath, path, originalPath, normalizedPath, projectedComment } =
    resolveProjectedTrackCore(track);

  const compacted: Track = {
    id,
    title,
    artist: normalizeOptionalString(track.artist),
    album: normalizeOptionalString(track.album),
    albumArtist: normalizeOptionalString(track.albumArtist),
    duration: normalizeOptionalNumber(track.duration),
    path,
    filePath,
    originalPath,
    libraryPathId: normalizeOptionalString(track.libraryPathId),
    mtimeMs: normalizeOptionalNumber(track.mtimeMs),
    metadataScannedAtMs: normalizeOptionalNumber(track.metadataScannedAtMs),
    quickFingerprint: normalizeOptionalString(track.quickFingerprint),
    coverKey: normalizeOptionalString(track.coverKey),
    coverUrl: sanitizeCoverUrl(track),
    year: normalizeOptionalNumber(track.year),
    genre: normalizeOptionalString(track.genre),
    trackNumber: normalizeOptionalNumber(track.trackNumber),
    discNumber: normalizeOptionalNumber(track.discNumber),
    composer: normalizeOptionalString(track.composer),
    bitrate: normalizeOptionalNumber(track.bitrate),
    sampleRate: normalizeOptionalNumber(track.sampleRate),
    replayGainTrackGainDb: normalizeOptionalNumber(track.replayGainTrackGainDb),
    replayGainAlbumGainDb: normalizeOptionalNumber(track.replayGainAlbumGainDb),
    format: normalizeOptionalString(track.format),
    codecName: normalizeOptionalString(track.codecName),
    fileSize: normalizeOptionalNumber(track.fileSize),
    dateAdded: normalizeOptionalNumber(track.dateAdded),
    lastPlayed: normalizeOptionalNumber(track.lastPlayed),
    playCount: normalizeOptionalNumber(track.playCount),
    rating: normalizeOptionalNumber(track.rating),
    favorite: normalizeOptionalBoolean(track.favorite),
    comment: projectedComment,
    mimeType: normalizeOptionalString(track.mimeType),
  };

  copyPlaybackSourceFields(track, compacted);
  attachProjectedFileHandle(track, normalizedPath, compacted);
  return compacted;
}

export function compactTrackForPlaylistState(track: Track): Track {
  const { id, title, filePath, path, originalPath, normalizedPath, projectedComment } =
    resolveProjectedTrackCore(track);

  const compacted: Track = {
    id,
    title,
    artist: normalizeOptionalString(track.artist),
    album: normalizeOptionalString(track.album),
    duration: normalizeOptionalNumber(track.duration),
    path,
    filePath,
    originalPath,
    libraryPathId: normalizeOptionalString(track.libraryPathId),
    coverKey: normalizeOptionalString(track.coverKey),
    coverUrl: sanitizeCoverUrl(track),
    replayGainTrackGainDb: normalizeOptionalNumber(track.replayGainTrackGainDb),
    replayGainAlbumGainDb: normalizeOptionalNumber(track.replayGainAlbumGainDb),
    comment: projectedComment,
  };

  copyPlaybackSourceFields(track, compacted);
  attachProjectedFileHandle(track, normalizedPath, compacted);
  return compacted;
}

export function compactTrackForQueueState(track: Track): Track {
  const { id, title, filePath, path, originalPath, normalizedPath, projectedComment } =
    resolveProjectedTrackCore(track);

  const compacted: Track = {
    id,
    title,
    artist: normalizeOptionalString(track.artist),
    album: normalizeOptionalString(track.album),
    duration: normalizeOptionalNumber(track.duration),
    path,
    filePath,
    originalPath,
    libraryPathId: normalizeOptionalString(track.libraryPathId),
    replayGainTrackGainDb: normalizeOptionalNumber(track.replayGainTrackGainDb),
    replayGainAlbumGainDb: normalizeOptionalNumber(track.replayGainAlbumGainDb),
    comment: projectedComment,
  };

  copyPlaybackSourceFields(track, compacted);
  attachProjectedFileHandle(track, normalizedPath, compacted);
  return compacted;
}
