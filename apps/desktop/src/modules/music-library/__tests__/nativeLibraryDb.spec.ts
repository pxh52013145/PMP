import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupNativeLibrarySourceTracks,
  clearNativeLibraryTracks,
  deleteNativeLibraryUserEntry,
  deleteNativeLibraryTracks,
  getNativeLibrarySelectedLyrics,
  listNativeBilibiliRecommendedResources,
  listNativeBilibiliSearchResources,
  listNativeLibraryCloudHashJobs,
  listNativeLibraryFallbackTasks,
  listNativeLibraryUserEntries,
  listNativeLibrarySourceHealth,
  listNativeLibrarySources,
  markNativeLibraryUserEntryPlayed,
  markNativeLibraryTrackPlayed,
  queryNativeLibraryTracks,
  resolveNativeLibraryLyrics,
  updateNativeLibraryCloudHashJobStatus,
  updateNativeLibraryFallbackTaskStatus,
  upsertNativeLibraryCloudHashJob,
  upsertNativeLibraryFallbackTask,
  upsertNativeLibraryUserEntry,
  writeBackNativeLibraryLyrics,
} from '../nativeLibraryDb';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/tauri', () => tauriMocks);

describe('nativeLibraryDb', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
  });

  it('normalizes extended track query payload fields', async () => {
    tauriMocks.invoke.mockResolvedValue([]);

    await queryNativeLibraryTracks({
      limit: 99999,
      offset: -10,
      includeMissing: true,
      visibleOnly: false,
      searchQuery: '  hello  ',
      artist: '  Artist A  ',
      album: '  Album A  ',
      trackId: '  track-1  ',
      sourceId: '  source-1  ',
      quickFingerprint: '  qf2:ABCDEF1234567890  ',
      filePath: '  C:\\Music\\a.mp3  ',
      groupBy: [{ field: 'artist', order: 'asc' }],
      filters: [
        { field: 'artist', operator: 'contains', value: '  artist-x  ' },
        { field: 'playCount', operator: 'gte', value: ' 10 ' },
        { field: 'genre', operator: 'is_not_empty' },
        { field: 'genre', operator: 'contains', value: '   ' },
      ],
      sort: [
        { field: 'playCount', order: 'desc' },
        { field: 'title', order: 'asc' },
      ],
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_query_tracks', {
      query: {
        limit: 2000,
        offset: 0,
        includeMissing: true,
        visibleOnly: false,
        searchQuery: 'hello',
        artist: 'Artist A',
        album: 'Album A',
        trackId: 'track-1',
        sourceId: 'source-1',
        quickFingerprint: 'qf2:abcdef1234567890',
        filePath: 'C:\\Music\\a.mp3',
        baseQuery: {
          filterOperator: 'and',
          filterGroups: [
            {
              operator: 'and',
              filters: [
                { field: 'artist', operator: 'contains', value: 'artist-x' },
                { field: 'playCount', operator: 'gte', value: '10' },
                { field: 'genre', operator: 'is_not_empty', value: undefined },
              ],
            },
          ],
          filters: [
            { field: 'artist', operator: 'contains', value: 'artist-x' },
            { field: 'playCount', operator: 'gte', value: '10' },
            { field: 'genre', operator: 'is_not_empty', value: undefined },
          ],
          groupBy: [{ field: 'artist', order: 'asc' }],
          sort: [
            { field: 'playCount', order: 'desc' },
            { field: 'title', order: 'asc' },
          ],
        },
        filters: [
          { field: 'artist', operator: 'contains', value: 'artist-x' },
          { field: 'playCount', operator: 'gte', value: '10' },
          { field: 'genre', operator: 'is_not_empty', value: undefined },
        ],
        sort: [
          { field: 'playCount', order: 'desc' },
          { field: 'title', order: 'asc' },
        ],
        groupBy: [{ field: 'artist', order: 'asc' }],
      },
    });
  });

  it('parses snake_case track payload fields for compatibility', async () => {
    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'track-1',
        source_id: 'source-1',
        file_path: 'D:/Music/a.mp3',
        quick_fingerprint: 'qf2:abcdef1234567890',
        duration_seconds: 267.4,
        sample_rate: 44100,
        bit_depth: 16,
        file_size: 1234567,
        mtime_ms: 1700000000123,
        replay_gain_track_db: -6.2,
        replay_gain_album_db: -5.7,
        play_count: 2,
        last_played_at_ms: 1700000100000,
        status: 'available',
        updated_at_ms: 1700000200000,
      },
    ]);

    const rows = await queryNativeLibraryTracks({ includeMissing: true, visibleOnly: false });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'track-1',
      sourceId: 'source-1',
      filePath: 'D:/Music/a.mp3',
      sampleRate: 44100,
      durationSeconds: 267.4,
      fileSize: 1234567,
      playCount: 2,
      status: 'available',
    });
  });

  it('parses native source records with trackCount', async () => {
    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'source-1',
        path: 'D:/Music',
        displayName: 'Music',
        category: 'music',
        trackCount: 128,
        isVisible: true,
        isScanned: true,
        addedAtMs: 100,
        updatedAtMs: 200,
      },
      {
        id: 'source-2',
        path: 'E:/BGM',
        category: 'music',
        isVisible: true,
        isScanned: false,
        addedAtMs: 300,
        updatedAtMs: 400,
      },
    ]);

    const sources = await listNativeLibrarySources();
    expect(sources).toHaveLength(2);
    expect(sources[0].trackCount).toBe(128);
    expect(sources[1].trackCount).toBe(0);
  });

  it('clears native tracks and parses affected count', async () => {
    tauriMocks.invoke.mockResolvedValue(12);

    const affected = await clearNativeLibraryTracks();

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_clear_tracks');
    expect(affected).toBe(12);
  });

  it('normalizes delete track ids before invoking native command', async () => {
    tauriMocks.invoke.mockResolvedValue(2);

    const affected = await deleteNativeLibraryTracks(['  t-1  ', '   ', 't-2']);

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_delete_tracks', {
      trackIds: ['t-1', 't-2'],
    });
    expect(affected).toBe(2);
  });

  it('skips native delete call when ids are empty', async () => {
    const affected = await deleteNativeLibraryTracks(['', '   ']);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(affected).toBe(0);
  });

  it('normalizes source health query payload and parses rows', async () => {
    tauriMocks.invoke.mockResolvedValue([
      {
        sourceId: 'source-1',
        sourcePath: 'D:/Music',
        sourceDisplayName: 'Music',
        totalTracks: 120,
        availableTracks: 118,
        missingTracks: 2,
        totalArtists: 35,
        totalAlbums: 28,
        totalSize: 1024,
        sourceUpdatedAtMs: 1700000000,
        lastTrackUpdatedAtMs: 1700000123,
      },
    ]);

    const rows = await listNativeLibrarySourceHealth({ sourceId: '  source-1  ' });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_list_source_health', {
      query: { sourceId: 'source-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].missingTracks).toBe(2);
  });

  it('normalizes source cleanup payload and parses affected count', async () => {
    tauriMocks.invoke.mockResolvedValue(7);

    const affected = await cleanupNativeLibrarySourceTracks('  source-2  ', {
      missingOnly: false,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_cleanup_source_tracks', {
      sourceId: 'source-2',
      missingOnly: false,
    });
    expect(affected).toBe(7);
  });

  it('normalizes mark played payload and parses boolean result', async () => {
    tauriMocks.invoke.mockResolvedValue(true);

    const updated = await markNativeLibraryTrackPlayed('  t-123  ', {
      playedAtMs: 1700000100.9,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_mark_track_played', {
      trackId: 't-123',
      playedAtMs: 1700000100,
    });
    expect(updated).toBe(true);
  });

  it('normalizes user entry payloads and parses user entry records', async () => {
    tauriMocks.invoke.mockResolvedValue({
      id: 'entry-1',
      ownerUid: 'u_10086',
      trackId: 'track-1',
      quickFingerprint: 'qf2:abcdef1234567890',
      cloudContentId: 'cloud_hash_1',
      displayTitle: 'Song A',
      displayArtist: 'Artist A',
      rating: 88,
      tagsJson: '["fav"]',
      inCloud: true,
      isMissing: false,
      playCount: 3,
      lastPlayedAtMs: 1700000200,
      createdAtMs: 1700000000,
      updatedAtMs: 1700000200,
    });

    const upserted = await upsertNativeLibraryUserEntry({
      id: '  entry-1  ',
      ownerUid: '  u_10086  ',
      trackId: '  track-1  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      cloudContentId: '  cloud_hash_1  ',
      displayTitle: '  Song A  ',
      displayArtist: '  Artist A  ',
      rating: 88.9,
      tagsJson: '  ["fav"]  ',
      inCloud: true,
      isMissing: false,
      createdAtMs: 1700000000.4,
      updatedAtMs: 1700000200.9,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_upsert_user_entry', {
      entry: expect.objectContaining({
        id: 'entry-1',
        ownerUid: 'u_10086',
        trackId: 'track-1',
        quickFingerprint: 'qf2:abcdef1234567890',
        cloudContentId: 'cloud_hash_1',
        displayTitle: 'Song A',
        displayArtist: 'Artist A',
        rating: 88,
        tagsJson: '["fav"]',
        inCloud: true,
        isMissing: false,
        createdAtMs: 1700000000,
        updatedAtMs: 1700000200,
      }),
    });
    expect(upserted?.ownerUid).toBe('u_10086');

    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'entry-1',
        ownerUid: 'u_10086',
        inCloud: true,
        isMissing: false,
        playCount: 3,
        createdAtMs: 1700000000,
        updatedAtMs: 1700000200,
      },
    ]);

    const listed = await listNativeLibraryUserEntries({
      ownerUid: '  u_10086  ',
      limit: 9999,
      offset: -10,
      inCloudOnly: true,
      includeMissing: false,
      searchQuery: '  song  ',
    });

    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_db_list_user_entries', {
      query: {
        ownerUid: 'u_10086',
        limit: 2000,
        offset: 0,
        inCloudOnly: true,
        includeMissing: false,
        searchQuery: 'song',
      },
    });
    expect(listed).toHaveLength(1);

    tauriMocks.invoke.mockResolvedValue(true);
    const deleted = await deleteNativeLibraryUserEntry('  entry-1  ');
    expect(deleted).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_db_delete_user_entry', {
      entryId: 'entry-1',
    });

    tauriMocks.invoke.mockResolvedValue(true);
    const marked = await markNativeLibraryUserEntryPlayed('  entry-1  ', { playedAtMs: 1700000300.7 });
    expect(marked).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_db_mark_user_entry_played', {
      entryId: 'entry-1',
      playedAtMs: 1700000300,
    });
  });

  it('normalizes fallback task and cloud hash job payloads', async () => {
    tauriMocks.invoke.mockResolvedValue({
      id: 'task-1',
      ownerUid: 'u_42',
      entryId: 'entry-42',
      reason: 'local-miss',
      status: 'queued',
      enqueueCount: 1,
      requestedAtMs: 1700000400,
      lastRequestedAtMs: 1700000400,
      updatedAtMs: 1700000401,
    });

    const task = await upsertNativeLibraryFallbackTask({
      ownerUid: '  u_42  ',
      entryId: '  entry-42  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      reason: '  local-miss  ',
      requestedAtMs: 1700000400.9,
    });

    expect(task?.status).toBe('queued');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_upsert_fallback_task', {
      task: expect.objectContaining({
        ownerUid: 'u_42',
        entryId: 'entry-42',
        quickFingerprint: 'qf2:abcdef1234567890',
        reason: 'local-miss',
        requestedAtMs: 1700000400,
      }),
    });

    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'task-1',
        ownerUid: 'u_42',
        entryId: 'entry-42',
        reason: 'local-miss',
        status: 'queued',
        enqueueCount: 2,
        requestedAtMs: 1700000400,
        lastRequestedAtMs: 1700000402,
        updatedAtMs: 1700000403,
      },
    ]);

    const tasks = await listNativeLibraryFallbackTasks({ ownerUid: '  u_42  ', status: '  queued  ' });
    expect(tasks).toHaveLength(1);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_db_list_fallback_tasks', {
      query: {
        ownerUid: 'u_42',
        status: 'queued',
        limit: undefined,
        offset: undefined,
      },
    });

    tauriMocks.invoke.mockResolvedValue(true);
    const taskUpdated = await updateNativeLibraryFallbackTaskStatus('  task-1  ', '  resolved  ', {
      lastError: '  ',
    });
    expect(taskUpdated).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith(
      'music_library_db_update_fallback_task_status',
      {
        taskId: 'task-1',
        status: 'resolved',
        lastError: undefined,
      }
    );

    tauriMocks.invoke.mockResolvedValue({
      id: 'job-1',
      ownerUid: 'u_42',
      entryId: 'entry-42',
      status: 'pending',
      attemptCount: 1,
      requestedAtMs: 1700000500,
      updatedAtMs: 1700000501,
    });

    const job = await upsertNativeLibraryCloudHashJob({
      ownerUid: '  u_42  ',
      entryId: '  entry-42  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      status: '  pending  ',
      requestedAtMs: 1700000500.4,
    });
    expect(job?.status).toBe('pending');
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_db_upsert_cloud_hash_job', {
      job: expect.objectContaining({
        ownerUid: 'u_42',
        entryId: 'entry-42',
        quickFingerprint: 'qf2:abcdef1234567890',
        status: 'pending',
        requestedAtMs: 1700000500,
      }),
    });

    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'job-1',
        ownerUid: 'u_42',
        entryId: 'entry-42',
        status: 'pending',
        attemptCount: 1,
        requestedAtMs: 1700000500,
        updatedAtMs: 1700000501,
      },
    ]);
    const jobs = await listNativeLibraryCloudHashJobs({ ownerUid: '  u_42  ', status: ' pending ' });
    expect(jobs).toHaveLength(1);

    tauriMocks.invoke.mockResolvedValue(true);
    const jobUpdated = await updateNativeLibraryCloudHashJobStatus('  job-1  ', '  completed  ', {
      cloudFullHash: '  full_hash_abc  ',
    });
    expect(jobUpdated).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith(
      'music_library_db_update_cloud_hash_job_status',
      {
        jobId: 'job-1',
        status: 'completed',
        cloudFullHash: 'full_hash_abc',
        lastError: undefined,
      }
    );
  });

  it('normalizes lyrics resolve payload and parses selected document', async () => {
    tauriMocks.invoke.mockResolvedValue({
      selectionKey: 'track::track-1',
      selectedSource: 'sidecar',
      triedSources: ['embedded', 'sidecar'],
      diagnostics: [],
      selected: {
        id: 'lydoc-1',
        sourceKind: 'sidecar',
        format: 'lrc',
        isDynamic: true,
        hasWordTiming: false,
        confidence: 0.92,
        lines: [{ startMs: 0, text: 'hello', tokens: [] }],
        updatedAtMs: 1700000600,
      },
    });

    const result = await resolveNativeLibraryLyrics({
      trackId: '  track-1  ',
      trackFilePath: '  D:/Music/hello.mp3  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      title: '  Hello  ',
      artist: '  Artist  ',
      durationSeconds: 245.6,
      embeddedLyrics: '  [00:01.00]hello  ',
      cacheKey: '  cache-1  ',
      forceWebLookup: true,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_lyrics_resolve', {
      request: {
        trackId: 'track-1',
        trackFilePath: 'D:/Music/hello.mp3',
        quickFingerprint: 'qf2:abcdef1234567890',
        title: 'Hello',
        artist: 'Artist',
        durationSeconds: 245.6,
        embeddedLyrics: '[00:01.00]hello',
        cacheKey: 'cache-1',
        forceWebLookup: true,
        entryId: undefined,
        lyricLocator: undefined,
        language: undefined,
      },
    });
    expect(result?.selectionKey).toBe('track::track-1');
    expect(result?.selected?.sourceKind).toBe('sidecar');
    expect(result?.selected?.lines[0]?.text).toBe('hello');
  });

  it('loads bilibili homepage recommendations through native command', async () => {
    tauriMocks.invoke.mockResolvedValue({
      folderId: 'bilibili:recommended',
      pageNum: 1,
      pageSize: 2,
      total: 2,
      hasMore: false,
      items: [
        {
          resourceId: '123',
          title: 'Video 1',
          sourceLocator: 'bilibili://video/BV1xx411c7mD',
          contentKind: 'video',
        },
      ],
    });

    const page = await listNativeBilibiliRecommendedResources();

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_bilibili_list_recommended_resources');
    expect(page?.folderId).toBe('bilibili:recommended');
    expect(page?.items[0]?.resourceId).toBe('123');
  });

  it('loads bilibili homepage search results through native command', async () => {
    tauriMocks.invoke.mockResolvedValue({
      folderId: 'bilibili:search:music',
      pageNum: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          resourceId: '456',
          title: 'Music Video',
          sourceLocator: 'bilibili://video/BV1xx411c7mD',
          contentKind: 'video',
        },
      ],
    });

    const page = await listNativeBilibiliSearchResources({
      keyword: '  music  ',
      pageNum: 1,
      pageSize: 20,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_bilibili_search_resources', {
      keyword: 'music',
      pageNum: 1,
      pageSize: 20,
    });
    expect(page?.folderId).toBe('bilibili:search:music');
    expect(page?.items[0]?.resourceId).toBe('456');
  });

  it('parses transient lyric document without persisted id', async () => {
    tauriMocks.invoke.mockResolvedValue({
      selectionKey: 'track::track-2',
      selectedSource: 'embedded',
      triedSources: ['embedded'],
      diagnostics: ['persist-selected-document-failed: db unavailable'],
      selected: {
        trackId: 'track-2',
        sourceKind: 'embedded',
        format: 'lrc',
        isDynamic: true,
        hasWordTiming: true,
        confidence: 0.96,
        lines: [
          {
            startMs: 1000,
            text: '',
            tokens: [
              { startMs: 1000, endMs: 1300, text: '你' },
              { startMs: 1300, endMs: 1600, text: '好' },
            ],
          },
        ],
        updatedAtMs: 1700000800,
      },
    });

    const result = await resolveNativeLibraryLyrics({
      trackId: 'track-2',
    });

    expect(result?.selected?.id).toContain('transient:embedded:1700000800:track-2');
    expect(result?.selected?.lines[0]?.text).toBe('你好');
  });

  it('reads selected lyrics and normalizes write-back payload', async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce({
        id: 'lydoc-1',
        source_kind: 'cache',
        format: 'lrc',
        is_dynamic: true,
        has_word_timing: false,
        confidence: 0.8,
        lines: [{ start_ms: 0, text: 'line-a', tokens: [] }],
        updated_at_ms: 1700000700,
      })
      .mockResolvedValueOnce({
        applied: true,
        policy: 'sidecar',
        output_path: 'D:/Music/hello.lrc',
        updated_at_ms: 1700000701,
      });

    const selected = await getNativeLibrarySelectedLyrics({
      trackId: '  track-1  ',
      quickFingerprint: '  qf2:abcdef1234567890  ',
      cacheKey: '  cache-1  ',
    });
    expect(selected?.sourceKind).toBe('cache');
    expect(selected?.lines[0]?.text).toBe('line-a');

    const writeBack = await writeBackNativeLibraryLyrics({
      query: {
        trackId: '  track-1  ',
        quickFingerprint: '  ABCDEF1234567890  ',
      },
      trackFilePath: '  D:/Music/hello.mp3  ',
      policy: 'sidecar',
      formatHint: '  LRC  ',
    });

    expect(tauriMocks.invoke).toHaveBeenLastCalledWith('music_library_lyrics_write_back', {
      request: {
        query: {
          entryId: undefined,
          trackId: 'track-1',
          trackFilePath: undefined,
          quickFingerprint: 'qf2:abcdef1234567890',
          cacheKey: undefined,
        },
        trackFilePath: 'D:/Music/hello.mp3',
        policy: 'sidecar',
        formatHint: 'lrc',
      },
    });
    expect(writeBack?.applied).toBe(true);
    expect(writeBack?.outputPath).toBe('D:/Music/hello.lrc');
  });
});
