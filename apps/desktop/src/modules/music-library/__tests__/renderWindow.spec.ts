import { describe, expect, it } from 'vitest';

import {
  growMusicLibraryRenderedTrackLimit,
  shouldDeferMusicLibraryTrackChunkLoad,
  sliceMusicLibraryRenderedTracks,
} from '../renderWindow';
import type { Track } from '../../../services/audio';

function createTracks(count: number): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    path: `C:\\Music\\track-${index + 1}.mp3`,
  }));
}

describe('renderWindow', () => {
  it('keeps table view bound to the full filtered track source', () => {
    const tracks = createTracks(6);

    const result = sliceMusicLibraryRenderedTracks(tracks, {
      baseView: 'table',
      renderedTrackLimit: 2,
    });

    expect(result).toBe(tracks);
  });

  it('caps card view to the rendered track window size', () => {
    const tracks = createTracks(6);

    const result = sliceMusicLibraryRenderedTracks(tracks, {
      baseView: 'card',
      renderedTrackLimit: 3,
    });

    expect(result).toHaveLength(3);
    expect(result.map((track) => track.id)).toEqual(['track-1', 'track-2', 'track-3']);
  });

  it('defers chunk loading while card view still has unrendered local tracks', () => {
    expect(
      shouldDeferMusicLibraryTrackChunkLoad({
        baseView: 'card',
        renderedTrackLimit: 48,
        availableTrackCount: 120,
      })
    ).toBe(true);

    expect(
      shouldDeferMusicLibraryTrackChunkLoad({
        baseView: 'table',
        renderedTrackLimit: 48,
        availableTrackCount: 120,
      })
    ).toBe(false);
  });

  it('grows rendered track limit without exceeding the available track count', () => {
    expect(growMusicLibraryRenderedTrackLimit(48, 120, 48)).toBe(96);
    expect(growMusicLibraryRenderedTrackLimit(96, 120, 48)).toBe(120);
    expect(growMusicLibraryRenderedTrackLimit(120, 120, 48)).toBe(120);
  });
});
