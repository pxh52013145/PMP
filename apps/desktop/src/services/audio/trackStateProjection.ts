import type { Track } from './types';

const MAX_EMBEDDED_COVER_URL_LENGTH = 16 * 1024;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export function compactTrackForState(track: Track): Track {
  const id = normalizeOptionalString(track.id) ?? '';
  const filePath = normalizeOptionalString(track.filePath);
  const path = normalizeOptionalString(track.path);
  const originalPath = normalizeOptionalString(track.originalPath);
  const normalizedPath = filePath ?? path ?? '';
  const title =
    normalizeOptionalString(track.title) ??
    originalPath?.split(/[/\\]/).pop() ??
    path?.split(/[/\\]/).pop() ??
    id;

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
    comment: normalizeOptionalString(track.comment),
    mimeType: normalizeOptionalString(track.mimeType),
  };

  if (!isAbsolutePath(normalizedPath) && track.fileHandle) {
    compacted.fileHandle = track.fileHandle;
  }

  return compacted;
}
