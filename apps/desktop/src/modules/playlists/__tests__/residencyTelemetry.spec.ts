import { describe, expect, it } from 'vitest';

import {
  getPlaylistsOverlayResidencySnapshot,
  recordPlaylistsOverlayResidencySample,
  resetPlaylistsOverlayResidencyTelemetryForTests,
  subscribePlaylistsOverlayResidencyTelemetry,
} from '../residencyTelemetry';

describe('playlists residency telemetry', () => {
  it('records samples in reverse chronological order', () => {
    resetPlaylistsOverlayResidencyTelemetryForTests();

    recordPlaylistsOverlayResidencySample({
      timestampMs: 100,
      reason: 'overlay-open',
      delayMs: 0,
      overlayOpen: true,
      selectedPlaylistId: null,
      selectedPlaylistTrackCount: 0,
      totalPlaylistCount: 10,
      hydratedPlaylistCount: 0,
      loadedPlaylistTrackCount: 0,
      visibleSidebarPlaylistCount: 6,
      filteredTrackCount: 0,
      selectedTrackCount: 0,
      resolvedCoverCount: 0,
      resolvedCoverBlobCount: 0,
      resolvedCoverUrlChars: 0,
      activeBlobCoverUrlCount: 0,
      decodedCoverEntryCount: 0,
      decodedCoverEstimateBytes: 0,
      selectedCoverUrlKind: 'none',
      selectedCoverDecodedBytes: 0,
      pageApproxJsonBytes: 0,
      webview2PrivateBytes: 1000,
      webview2WorkingSetBytes: 2000,
      treePrivateBytes: 3000,
      treeWorkingSetBytes: 4000,
      webview2CpuPercent: 2,
    });

    recordPlaylistsOverlayResidencySample({
      timestampMs: 200,
      reason: 'playlist-switch',
      delayMs: 600,
      overlayOpen: true,
      selectedPlaylistId: 'recent',
      selectedPlaylistTrackCount: 208,
      totalPlaylistCount: 10,
      hydratedPlaylistCount: 1,
      loadedPlaylistTrackCount: 208,
      visibleSidebarPlaylistCount: 6,
      filteredTrackCount: 208,
      selectedTrackCount: 0,
      resolvedCoverCount: 6,
      resolvedCoverBlobCount: 1,
      resolvedCoverUrlChars: 256,
      activeBlobCoverUrlCount: 1,
      decodedCoverEntryCount: 3,
      decodedCoverEstimateBytes: 196608,
      selectedCoverUrlKind: 'pmp',
      selectedCoverDecodedBytes: 65536,
      pageApproxJsonBytes: 4096,
      webview2PrivateBytes: 5000,
      webview2WorkingSetBytes: 6000,
      treePrivateBytes: 7000,
      treeWorkingSetBytes: 8000,
      webview2CpuPercent: 4,
    });

    const snapshot = getPlaylistsOverlayResidencySnapshot();
    expect(snapshot.latestSample?.seq).toBe(2);
    expect(snapshot.latestSample?.selectedPlaylistId).toBe('recent');
    expect(snapshot.samples.map((sample) => sample.seq)).toEqual([2, 1]);
  });

  it('notifies subscribers with updated snapshots', () => {
    resetPlaylistsOverlayResidencyTelemetryForTests();
    const versions: number[] = [];

    const unsubscribe = subscribePlaylistsOverlayResidencyTelemetry((snapshot) => {
      versions.push(snapshot.version);
    });

    recordPlaylistsOverlayResidencySample({
      timestampMs: 100,
      reason: 'overlay-close',
      delayMs: 700,
      overlayOpen: false,
      selectedPlaylistId: null,
      selectedPlaylistTrackCount: 0,
      totalPlaylistCount: 12,
      hydratedPlaylistCount: 0,
      loadedPlaylistTrackCount: 0,
      visibleSidebarPlaylistCount: 0,
      filteredTrackCount: 0,
      selectedTrackCount: 0,
      resolvedCoverCount: 0,
      resolvedCoverBlobCount: 0,
      resolvedCoverUrlChars: 0,
      activeBlobCoverUrlCount: 0,
      decodedCoverEntryCount: 0,
      decodedCoverEstimateBytes: 0,
      selectedCoverUrlKind: 'none',
      selectedCoverDecodedBytes: 0,
      pageApproxJsonBytes: 0,
      webview2PrivateBytes: 1234,
      webview2WorkingSetBytes: 2345,
      treePrivateBytes: 3456,
      treeWorkingSetBytes: 4567,
      webview2CpuPercent: 1,
    });

    unsubscribe();

    expect(versions).toEqual([0, 1]);
  });
});
