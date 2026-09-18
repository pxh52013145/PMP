import { describe, expect, it, vi } from 'vitest';
import { MusicLibraryService } from './MusicLibraryService';
import { createMusicLibraryReadGateway, type MusicLibraryReadGatewayContext } from './musicLibraryReadGateway';
import type { NativeLibraryTrackRecord } from '../../modules/music-library/nativeLibraryDb';

describe('native album reads', () => {
  it('sends track and disc numbers through the scan persistence boundary', () => {
    const service = Object.create(MusicLibraryService.prototype) as MusicLibraryService;
    expect(service['toNativeTrackUpsertInput']({
      id: 'seventh', title: 'Song', filePath: 'C:/Music/song.flac',
      trackNumber: 7, discNumber: 2,
    })).toMatchObject({ trackNumber: 7, discNumber: 2 });
  });
  it('preserves sequence metadata through native mapping and returns playback order', async () => {
    // Avoid database startup; exercise the same mapping used by native album and list reads.
    const service = Object.create(MusicLibraryService.prototype) as MusicLibraryService;
    const records: NativeLibraryTrackRecord[] = [
      {
        id: 'second', sourceId: 'local', filePath: 'D:/Music/01.flac', title: 'A',
        trackNumber: 2, discNumber: 1, updatedAtMs: 1, status: 'available', playCount: 0,
      },
      {
        id: 'first', sourceId: 'local', filePath: 'D:/Music/02.flac', title: 'Z',
        trackNumber: 1, discNumber: 1, updatedAtMs: 1, status: 'available', playCount: 0,
      },
    ];
    const mapped = records.map((record) => service['mapNativeTrackRecordToListTrack'](record));
    expect(mapped[0]).toMatchObject({ trackNumber: 2, discNumber: 1 });
    const nativeRead = vi.fn().mockResolvedValue({ status: 'ok', value: mapped });
    const gateway = createMusicLibraryReadGateway({
      isDesktopRuntime: () => true,
      tryGetTracksByAlbumFromNativeDb: nativeRead,
    } as unknown as MusicLibraryReadGatewayContext);

    const result = await gateway.getTracksByAlbum('Album');
    expect(nativeRead).toHaveBeenCalledWith('Album');
    expect(result.map((track) => track.id)).toEqual(['first', 'second']);
    expect(result[0].title).toBe('Z');
  });
});
