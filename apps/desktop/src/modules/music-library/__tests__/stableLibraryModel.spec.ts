import { describe, expect, it, vi } from 'vitest';
import {
  buildStableFallbackAuditSnapshot,
  buildTagsJsonFromText,
  collectStableFallbackAuditEntries,
  deriveStableLibraryStats,
  normalizeStableFallbackAuditEntry,
  parseTagsJsonAsText,
} from '../stableLibraryModel';

describe('stableLibraryModel', () => {
  it('normalizes valid fallback audit entries and rejects invalid payloads', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const normalized = normalizeStableFallbackAuditEntry({
      request: {
        entryId: ' entry-1 ',
        ownerUid: ' owner-a ',
        requestedAtMs: 5.7,
        cloudContentId: ' cloud-1 ',
        reason: '  migrated  ',
      },
      dispatch: {
        accepted: 1,
        deduped: 0,
        queueSize: 3.2,
      },
    });

    expect(normalized).toEqual({
      atMs: 123_456,
      request: {
        entryId: 'entry-1',
        ownerUid: 'owner-a',
        cloudContentId: 'cloud-1',
        requestedAtMs: 5,
        reason: 'migrated',
      },
      dispatch: {
        accepted: true,
        deduped: false,
        queueSize: 3,
      },
    });

    expect(normalizeStableFallbackAuditEntry(null)).toBeNull();
    expect(normalizeStableFallbackAuditEntry({})).toBeNull();
    expect(
      normalizeStableFallbackAuditEntry({
        request: { entryId: 'entry-1', ownerUid: 'owner-a' },
      })
    ).toBeNull();
    expect(
      normalizeStableFallbackAuditEntry({
        request: { entryId: '  ', ownerUid: 'owner-a' },
        dispatch: {},
      })
    ).toBeNull();

    nowSpy.mockRestore();
  });

  it('collects fallback audit entries with owner filtering', () => {
    const entries = collectStableFallbackAuditEntries(
      [
        {
          atMs: 10,
          request: { entryId: 'a', ownerUid: 'owner-a', requestedAtMs: 10 },
          dispatch: { accepted: true, deduped: false, queueSize: 1 },
        },
        {
          atMs: 11,
          request: { entryId: 'b', ownerUid: 'owner-b', requestedAtMs: 11 },
          dispatch: { accepted: false, deduped: false, queueSize: 0 },
        },
        { invalid: true },
      ],
      ' owner-a '
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].request.ownerUid).toBe('owner-a');
    expect(entries[0].request.entryId).toBe('a');
  });

  it('builds audit snapshot stats and recent ordering', () => {
    const snapshot = buildStableFallbackAuditSnapshot([
      {
        atMs: 20,
        request: { entryId: 'a', ownerUid: 'owner-a', requestedAtMs: 20 },
        dispatch: { accepted: true, deduped: false, queueSize: 2 },
      },
      {
        atMs: 40,
        request: { entryId: 'b', ownerUid: 'owner-a', requestedAtMs: 40 },
        dispatch: { accepted: false, deduped: true, queueSize: 1 },
      },
      {
        atMs: 30,
        request: { entryId: 'c', ownerUid: 'owner-a', requestedAtMs: 30 },
        dispatch: { accepted: true, deduped: true, queueSize: 3 },
      },
    ]);

    expect(snapshot.recent.map((item) => item.request.entryId)).toEqual(['b', 'c', 'a']);
    expect(snapshot.stats).toEqual({
      totalEvents: 3,
      acceptedEvents: 2,
      dedupedEvents: 2,
      rejectedEvents: 1,
      lastQueuedAtMs: 30,
    });
  });

  it('parses and builds tags json consistently', () => {
    expect(parseTagsJsonAsText(' ["rock", "", "jazz"] ')).toBe('rock, jazz');
    expect(parseTagsJsonAsText('"single"')).toBe('"single"');
    expect(parseTagsJsonAsText(' raw-text ')).toBe('raw-text');

    expect(buildTagsJsonFromText(' rock, jazz\nrock ')).toBe('["rock","jazz"]');
    expect(buildTagsJsonFromText('   ')).toBeUndefined();
  });

  it('derives stable library stats', () => {
    const stats = deriveStableLibraryStats([
      { inCloud: true, isMissing: true },
      { inCloud: false, isMissing: false },
      { inCloud: true, isMissing: false },
    ]);

    expect(stats).toEqual({
      totalEntries: 3,
      inCloud: 2,
      missing: 1,
      localReady: 2,
    });
  });
});
