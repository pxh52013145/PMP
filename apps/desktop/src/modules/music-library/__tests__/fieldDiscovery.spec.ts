import { afterEach, describe, expect, it } from 'vitest';
import type { Track } from '../../../services/audio';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  getMusicLibraryBaseFieldCapability,
} from '../fieldCapabilities';
import {
  discoverMusicLibraryFieldCapabilitiesFromTracks,
  registerMusicLibraryDiscoveredFieldCapabilitiesFromTracks,
} from '../fieldDiscovery';

function createTrackWithDynamicFields(fields: Record<string, unknown>): Track {
  return fields as unknown as Track;
}

describe('fieldDiscovery', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
  });

  it('discovers custom fields from real track rows', () => {
    const definitions = discoverMusicLibraryFieldCapabilitiesFromTracks([
      createTrackWithDynamicFields({
        id: 'track-1',
        title: 'A',
        albumArtist: 'Various Artists',
        customRank: 42,
        customFlag: true,
        tags: ['rock', 'alt'],
        ingestedAt: new Date('2024-03-04T05:06:00Z'),
      }),
    ]);

    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'albumArtist', label: 'Album Artist', kind: 'text' }),
        expect.objectContaining({ id: 'customRank', label: 'Custom Rank', kind: 'number' }),
        expect.objectContaining({ id: 'customFlag', label: 'Custom Flag', kind: 'text' }),
        expect.objectContaining({ id: 'tags', label: 'Tags', kind: 'text' }),
        expect.objectContaining({ id: 'ingestedAt', label: 'Ingested At', kind: 'number' }),
      ])
    );
  });

  it('registers discovered fields into the registry and skips builtin ids', () => {
    const definitions = registerMusicLibraryDiscoveredFieldCapabilitiesFromTracks([
      createTrackWithDynamicFields({
        id: 'track-1',
        title: 'A',
        artist: 'Muse',
        albumArtist: 'Various Artists',
      }),
    ]);

    expect(definitions.some((field) => field.id === 'title')).toBe(false);
    expect(getMusicLibraryBaseFieldCapability('albumArtist')).toMatchObject({
      id: 'albumArtist',
      label: 'Album Artist',
      trackKey: 'albumArtist',
    });
  });
});
