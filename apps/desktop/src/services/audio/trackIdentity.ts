import type { Track } from './types';

export function getTrackPathForIdentity(track: Track | null | undefined): string | null {
  if (!track) return null;
  const candidates = [track.filePath, track.path, track.originalPath];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export function normalizeTrackPathForCompare(path: string | null | undefined): string {
  if (!path) return '';

  let normalized = path.trim();
  if (!normalized) return '';

  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\/(localhost)?/i, '');
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // keep raw value when URI decode fails
    }
  }

  normalized = normalized.replace(/^[\\/]{2}[?.][\\/]/, '');

  if (/^\/[a-zA-Z]:[\\/]/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/$/, '');

  return normalized.toLowerCase();
}

export function normalizeTrackIdentityForCompare(track: Track | null | undefined): string {
  if (!track) return '';

  const normalize = (value: string | null | undefined): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

  const trackId = normalize(track.id);
  if (trackId) return `id:${trackId}`;

  const originalPath = normalize(track.originalPath);
  if (originalPath) return `origin:${originalPath}`;

  const filePath = normalize(track.filePath);
  if (filePath) return `file:${filePath}`;

  const path = normalize(track.path);
  if (path) return `path:${path}`;

  const title = normalize(track.title);
  const artist = normalize(track.artist);
  return title ? `meta:${title}|${artist}` : '';
}

export function isSameTrackByIdentityOrPath(a: Track, b: Track): boolean {
  const identityA = normalizeTrackIdentityForCompare(a);
  const identityB = normalizeTrackIdentityForCompare(b);
  if (identityA && identityB) {
    if (identityA === identityB) return true;
  }

  const pathA = normalizeTrackPathForCompare(getTrackPathForIdentity(a));
  const pathB = normalizeTrackPathForCompare(getTrackPathForIdentity(b));
  if (pathA && pathB) {
    return pathA === pathB;
  }

  return false;
}

export function prependTrackWithDedup(tracks: Track[], incoming: Track): Track[] {
  const incomingIdentity = normalizeTrackIdentityForCompare(incoming);
  const incomingPath = normalizeTrackPathForCompare(getTrackPathForIdentity(incoming));

  const dedupedTracks = tracks.filter((candidate) => {
    const sameIdentity =
      incomingIdentity.length > 0 &&
      normalizeTrackIdentityForCompare(candidate) === incomingIdentity;
    if (sameIdentity) return false;

    if (!incomingPath) return true;
    const candidatePath = normalizeTrackPathForCompare(getTrackPathForIdentity(candidate));
    return candidatePath !== incomingPath;
  });

  return [incoming, ...dedupedTracks];
}
