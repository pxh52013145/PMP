import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupNativeLibrarySourceTracks,
  clearNativeLibraryTracks,
  deleteNativeLibraryUserEntry,
  deleteNativeLibraryTracks,
  listNativeLibraryCloudHashJobs,
  listNativeLibraryFallbackTasks,
  listNativeLibraryUserEntries,
  listNativeLibrarySourceHealth,
  listNativeLibrarySources,
  markNativeLibraryUserEntryPlayed,
  markNativeLibraryTrackPlayed,
  queryNativeLibraryTracks,
  updateNativeLibraryCloudHashJobStatus,
  updateNativeLibraryFallbackTaskStatus,
  upsertNativeLibraryCloudHashJob,
  upsertNativeLibraryFallbackTask,
  upsertNativeLibraryUserEntry,
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
      },
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
});
