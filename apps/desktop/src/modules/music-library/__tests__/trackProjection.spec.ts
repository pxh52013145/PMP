import { describe, expect, it } from 'vitest';
import type { Track } from '../../../services/audio';
import { compactTrackForMusicLibrary } from '../trackProjection';

function createTrackWithDynamicFields(fields: Record<string, unknown>): Track {
  return fields as unknown as Track;
}

describe('trackProjection', () => {
  it('keeps discoverable dynamic primitive fields during compaction', () => {
    const compacted = compactTrackForMusicLibrary(createTrackWithDynamicFields({
      id: 'track-1',
      title: '  Hello  ',
      artist: '  Muse  ',
      albumArtist: '  Various Artists  ',
      customRank: 42,
      customFlag: true,
      tags: [' rock ', 'alt'],
      nested: { ignored: true },
    }));

    const dynamic = compacted as unknown as Record<string, unknown>;
    expect(compacted.title).toBe('Hello');
    expect(compacted.artist).toBe('Muse');
    expect(dynamic.albumArtist).toBe('Various Artists');
    expect(dynamic.customRank).toBe(42);
    expect(dynamic.customFlag).toBe(true);
    expect(dynamic.tags).toEqual(['rock', 'alt']);
    expect(dynamic.nested).toBeUndefined();
  });

  it('still excludes heavy operational fields from dynamic preservation', () => {
    const compacted = compactTrackForMusicLibrary(createTrackWithDynamicFields({
      id: 'track-1',
      title: 'A',
      lyrics: 'Long lyrics',
      fileContent: new ArrayBuffer(8),
    }));

    const dynamic = compacted as unknown as Record<string, unknown>;
    expect(dynamic.lyrics).toBeUndefined();
    expect(dynamic.fileContent).toBeUndefined();
  });
});
