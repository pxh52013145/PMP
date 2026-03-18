import type { Track } from '../../services/audio';
import type { MusicLibraryBaseView } from './baseQuery';

export function sliceMusicLibraryRenderedTracks(
  tracks: Track[],
  options: {
    baseView: MusicLibraryBaseView;
    renderedTrackLimit: number;
  }
): Track[] {
  if (options.baseView !== 'card') {
    return tracks;
  }

  const normalizedLimit = Number.isFinite(options.renderedTrackLimit)
    ? Math.max(0, Math.floor(options.renderedTrackLimit))
    : tracks.length;

  if (normalizedLimit >= tracks.length) {
    return tracks;
  }

  return tracks.slice(0, normalizedLimit);
}

export function shouldDeferMusicLibraryTrackChunkLoad(options: {
  baseView: MusicLibraryBaseView;
  renderedTrackLimit: number;
  availableTrackCount: number;
}): boolean {
  if (options.baseView !== 'card') {
    return false;
  }

  const availableTrackCount = Number.isFinite(options.availableTrackCount)
    ? Math.max(0, Math.floor(options.availableTrackCount))
    : 0;
  const renderedTrackLimit = Number.isFinite(options.renderedTrackLimit)
    ? Math.max(0, Math.floor(options.renderedTrackLimit))
    : availableTrackCount;

  return renderedTrackLimit < availableTrackCount;
}

export function growMusicLibraryRenderedTrackLimit(
  currentLimit: number,
  totalTracks: number,
  chunkSize: number
): number {
  const normalizedTotal = Number.isFinite(totalTracks) ? Math.max(0, Math.floor(totalTracks)) : 0;
  const normalizedCurrent = Number.isFinite(currentLimit)
    ? Math.max(0, Math.floor(currentLimit))
    : 0;
  const normalizedChunk = Number.isFinite(chunkSize) ? Math.max(1, Math.floor(chunkSize)) : 1;

  return Math.min(normalizedTotal, normalizedCurrent + normalizedChunk);
}
