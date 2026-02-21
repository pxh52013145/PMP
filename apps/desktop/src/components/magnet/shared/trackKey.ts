import type { Track } from '../../../services/audio';

export function trackKey(track: Track | null): string {
  if (!track) return 'none';
  return (
    track.filePath ||
    track.path ||
    track.originalPath ||
    track.id ||
    `${track.title}::${track.artist || ''}`
  );
}

