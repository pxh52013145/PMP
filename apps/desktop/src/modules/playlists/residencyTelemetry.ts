export type PlaylistCoverUrlKind = 'none' | 'blob' | 'pmp' | 'http' | 'other';

export type PlaylistsOverlayResidencySample = {
  seq: number;
  timestampMs: number;
  reason: 'overlay-open' | 'overlay-close' | 'playlist-switch';
  delayMs: number;
  overlayOpen: boolean;
  selectedPlaylistId: string | null;
  selectedPlaylistTrackCount: number;
  totalPlaylistCount: number;
  hydratedPlaylistCount: number;
  loadedPlaylistTrackCount: number;
  visibleSidebarPlaylistCount: number;
  filteredTrackCount: number;
  selectedTrackCount: number;
  resolvedCoverCount: number;
  resolvedCoverBlobCount: number;
  resolvedCoverUrlChars: number;
  activeBlobCoverUrlCount: number;
  decodedCoverEntryCount: number;
  decodedCoverEstimateBytes: number;
  selectedCoverUrlKind: PlaylistCoverUrlKind;
  selectedCoverDecodedBytes: number;
  pageApproxJsonBytes: number;
  webview2PrivateBytes: number | null;
  webview2WorkingSetBytes: number | null;
  treePrivateBytes: number | null;
  treeWorkingSetBytes: number | null;
  webview2CpuPercent: number | null;
};

export type PlaylistsOverlayResidencySnapshot = {
  version: number;
  samples: PlaylistsOverlayResidencySample[];
  latestSample: PlaylistsOverlayResidencySample | null;
};

type PlaylistsOverlayResidencyMutable = {
  seq: number;
  version: number;
  samples: PlaylistsOverlayResidencySample[];
};

const MAX_RESIDENCY_SAMPLES = 24;

const telemetryState: PlaylistsOverlayResidencyMutable = {
  seq: 0,
  version: 0,
  samples: [],
};

const listeners = new Set<(snapshot: PlaylistsOverlayResidencySnapshot) => void>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listeners.clear();
    telemetryState.samples = [];
    telemetryState.seq = 0;
    telemetryState.version = 0;
  });
}

function emitSnapshot(): void {
  const snapshot = getPlaylistsOverlayResidencySnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // best-effort telemetry listener
    }
  }
}

export function recordPlaylistsOverlayResidencySample(
  sample: Omit<PlaylistsOverlayResidencySample, 'seq'>
): PlaylistsOverlayResidencySample {
  telemetryState.seq += 1;
  telemetryState.version += 1;

  const nextSample: PlaylistsOverlayResidencySample = {
    ...sample,
    seq: telemetryState.seq,
  };

  telemetryState.samples = [nextSample, ...telemetryState.samples].slice(0, MAX_RESIDENCY_SAMPLES);
  emitSnapshot();
  return nextSample;
}

export function getPlaylistsOverlayResidencySnapshot(): PlaylistsOverlayResidencySnapshot {
  return {
    version: telemetryState.version,
    samples: telemetryState.samples,
    latestSample: telemetryState.samples[0] ?? null,
  };
}

export function subscribePlaylistsOverlayResidencyTelemetry(
  listener: (snapshot: PlaylistsOverlayResidencySnapshot) => void
): () => void {
  listeners.add(listener);
  listener(getPlaylistsOverlayResidencySnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function resetPlaylistsOverlayResidencyTelemetryForTests(): void {
  telemetryState.seq = 0;
  telemetryState.version = 0;
  telemetryState.samples = [];
  emitSnapshot();
}
