import { describe, expect, it } from 'vitest';

import {
  buildBilibiliPreparedResourceKey,
  buildBilibiliResourceIdentity,
  buildBilibiliSearchSourceId,
  createDefaultBilibiliPlaybackQualityOptions,
  extractBilibiliBvid,
  isBilibiliVideoSourceLocator,
  mergeBilibiliPlaybackQualityOptions,
  normalizeBilibiliPlaybackQualityKey,
  normalizeBilibiliLookupInput,
  parseBilibiliSearchSourceId,
  resolveBilibiliQualityBadges,
  resolveBilibiliWebUrl,
} from './bilibiliFacade';

describe('bilibiliFacade helpers', () => {
  it('builds stable resource identity across supported source shapes', () => {
    expect(
      buildBilibiliResourceIdentity({
        resourceId: '123',
        bvid: undefined,
        cid: undefined,
        sourceLocator: '',
        title: 'Song',
        ownerName: 'Uploader',
        durationSeconds: 180,
      })
    ).toBe('rid:123');

    expect(
      buildBilibiliResourceIdentity({
        resourceId: '',
        bvid: 'bv1xx411c7mD',
        cid: '456',
        sourceLocator: '',
        title: 'Song',
        ownerName: 'Uploader',
        durationSeconds: 180,
      })
    ).toBe('bvid:BV1XX411C7MD::cid:456');

    expect(
      buildBilibiliResourceIdentity({
        resourceId: '',
        bvid: '',
        cid: '',
        sourceLocator: 'bilibili://video/BV1xx411c7mD',
        title: 'Song',
        ownerName: 'Uploader',
        durationSeconds: 180,
      })
    ).toBe('locator:bilibili://video/BV1xx411c7mD');
  });

  it('normalizes search source ids and playback quality keys', () => {
    expect(normalizeBilibiliPlaybackQualityKey('  HiRes ')).toBe('hires');
    expect(normalizeBilibiliPlaybackQualityKey('unknown')).toBe('auto');
    expect(
      buildBilibiliPreparedResourceKey(
        {
          resourceId: 'abc',
          bvid: undefined,
          cid: undefined,
          sourceLocator: '',
          title: 'Song',
          ownerName: 'Uploader',
          durationSeconds: 200,
        },
        '  Dolby '
      )
    ).toBe('rid:abc::dolby');

    const sourceId = buildBilibiliSearchSourceId(' lo-fi ');
    expect(sourceId).toBe('bilibili:search:lo-fi');
    expect(parseBilibiliSearchSourceId(sourceId)).toBe('lo-fi');
    expect(parseBilibiliSearchSourceId('playlist-1')).toBeNull();
  });

  it('normalizes lookup input and bilibili web urls from messy provider values', () => {
    expect(normalizeBilibiliLookupInput(' https://www.bilibili.com/video/BV1xx411c7mD ')).toBe(
      'BV1XX411C7MD'
    );
    expect(normalizeBilibiliLookupInput('https://example.test/?foo=1&bvid=bv1xx411c7mD')).toBe(
      'BV1XX411C7MD'
    );
    expect(normalizeBilibiliLookupInput('plain text BV1xx411c7mD')).toBe('BV1XX411C7MD');
    expect(normalizeBilibiliLookupInput('not-a-bvid')).toBeNull();
    expect(extractBilibiliBvid('cid=100 BV1xx411c7mD')).toBe('BV1XX411C7MD');
    expect(
      resolveBilibiliWebUrl({
        bvid: 'bv1xx411c7mD',
        sourceLocator: 'bilibili://video/BV1xx411c7mD',
      })
    ).toBe('https://www.bilibili.com/video/BV1XX411C7MD');
    expect(
      resolveBilibiliWebUrl({
        bvid: '',
        sourceLocator: 'https://www.bilibili.com/video/BV1xx411c7mD',
      })
    ).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });

  it('merges playback qualities into stable host order and derives badges', () => {
    expect(createDefaultBilibiliPlaybackQualityOptions()).toEqual([
      { key: 'auto', label: 'auto', available: true },
      { key: '64k', label: '64k', available: false },
      { key: '132k', label: '132k', available: false },
      { key: '192k', label: '192k', available: false },
      { key: 'dolby', label: 'dolby', available: false },
      { key: 'hires', label: 'hires', available: false },
    ]);

    const merged = mergeBilibiliPlaybackQualityOptions([
      { key: 'Dolby', label: 'Dolby Atmos', available: true },
      { key: '192k', label: '192K', available: true },
      { key: 'unknown', label: 'ignored', available: true },
    ]);

    expect(merged).toEqual([
      { key: 'auto', label: 'auto', available: true },
      { key: '64k', label: '64k', available: false },
      { key: '132k', label: '132k', available: false },
      { key: '192k', label: '192K', available: true },
      { key: 'dolby', label: 'Dolby Atmos', available: true },
      { key: 'hires', label: 'hires', available: false },
    ]);
    expect(resolveBilibiliQualityBadges(merged)).toEqual(['dolby']);
    expect(
      resolveBilibiliQualityBadges([
        { key: 'hires', available: true },
        { key: 'dolby', available: true },
      ])
    ).toEqual(['hires', 'dolby']);
  });

  it('detects bilibili video locators', () => {
    expect(isBilibiliVideoSourceLocator('bilibili://video/BV1xx411c7mD')).toBe(true);
    expect(isBilibiliVideoSourceLocator('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isBilibiliVideoSourceLocator('https://example.test/?bvid=BV1xx411c7mD')).toBe(true);
    expect(isBilibiliVideoSourceLocator('netease://song/1')).toBe(false);
  });
});
