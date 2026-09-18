import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';

vi.mock('../../utils/tauriRuntime', () => ({ isTauriRuntime: () => true }));
vi.mock('../../services/telemetry/tauriInvokeTelemetry', () => ({ invokeWithTelemetry: vi.fn() }));

import {
  buildNativeLibraryTrackQueryPayload,
  parseNativeLibraryTrackPageResult,
  queryNativeLibraryTracksPage,
  type NativeLibraryTrackQuery,
} from './nativeLibraryDb';

describe('native music library query facade', () => {
  beforeEach(() => { vi.mocked(invokeWithTelemetry).mockReset(); });

  it('preserves database errors instead of reporting a successful empty page', async () => {
    vi.mocked(invokeWithTelemetry).mockRejectedValueOnce(new Error('Failed to query tracks'));
    await expect(queryNativeLibraryTracksPage()).rejects.toThrow('Failed to query tracks');
  });

  it('rejects malformed pages and records without silently dropping tracks', async () => {
    for (const response of [null, {}, { total: 1, items: [{ id: 'incomplete' }] }]) {
      vi.mocked(invokeWithTelemetry).mockResolvedValueOnce(response);
      await expect(queryNativeLibraryTracksPage()).rejects.toThrow('Invalid native music library track page');
    }
  });

  it('accepts a genuine no-match result', async () => {
    vi.mocked(invokeWithTelemetry).mockResolvedValueOnce({ total: 0, items: [] });
    await expect(queryNativeLibraryTracksPage()).resolves.toMatchObject({ total: 0, items: [] });
  });
  it('keeps grouped row window options in the typed native payload', () => {
    const query: NativeLibraryTrackQuery = {
      projection: 'list',
      includeGroupedRows: true,
      collapsedGroupKeys: [' artist:alpha ', '', 'genre:jazz'],
      rowWindowStart: 10.8,
      rowWindowEnd: 48.2,
      baseQuery: {
        filterOperator: 'or',
        filterGroups: [
          {
            operator: 'and',
            filters: [
              {
                field: 'artist',
                operator: 'contains',
                value: '  Alice  ',
              },
            ],
          },
        ],
        groupBy: [{ field: 'artist', order: 'asc' }],
        sort: [{ field: 'year', order: 'desc' }],
      },
    };

    expect(buildNativeLibraryTrackQueryPayload(query)).toMatchObject({
      projection: 'list',
      includeGroupedRows: true,
      collapsedGroupKeys: ['artist:alpha', 'genre:jazz'],
      rowWindowStart: 10,
      rowWindowEnd: 48,
      baseQuery: {
        filterOperator: 'or',
        filterGroups: [
          {
            operator: 'and',
            filters: [
              {
                field: 'artist',
                operator: 'contains',
                value: 'Alice',
              },
            ],
          },
        ],
        groupBy: [{ field: 'artist', order: 'asc' }],
        sort: [{ field: 'year', order: 'desc' }],
      },
    });
  });

  it('parses Rust grouped rows without requiring React display labels', () => {
    const parsed = parseNativeLibraryTrackPageResult({
      total: 2,
      items: [
        {
          id: 'track-1',
          sourceId: 'source-a',
          filePath: 'C:/Music/a.flac',
          status: 'available',
          updatedAtMs: 100,
          playCount: 0,
        },
      ],
      groupedRows: [
        {
          kind: 'group-header',
          id: 'group-header:artist:alice',
          groupKey: 'artist:alice',
          field: 'artist',
          title: 'Alice',
          count: 2,
          depth: 0,
          startIndex: 0,
          collapsed: false,
        },
        {
          kind: 'track',
          id: 'track-1',
          trackId: 'track-1',
          trackIndex: 0,
          groupKey: 'artist:alice',
          parentGroupKeys: ['artist:alice'],
        },
      ],
      groupedRowTotal: 3,
      topSpacerRowCount: 0,
      bottomSpacerRowCount: 1,
    });

    expect(parsed?.groupedRows).toHaveLength(2);
    expect(parsed?.groupedRows?.[0]).toMatchObject({
      kind: 'group-header',
      field: 'artist',
      title: 'Alice',
      count: 2,
    });
    expect(parsed?.groupedRowTotal).toBe(3);
    expect(parsed?.bottomSpacerRowCount).toBe(1);
  });
});
