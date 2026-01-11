import type { Track } from '../../../services/audio';

export function trackKey(track: Track | null): string {
  if (!track) return 'none';
  return (
    track.id ||
    track.filePath ||
    track.path ||
    track.originalPath ||
    `${track.title}::${track.artist || ''}`
  );
}

