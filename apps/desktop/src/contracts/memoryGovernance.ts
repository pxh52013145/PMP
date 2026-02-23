export type MemoryGovernanceTier = 0 | 1 | 2 | 3;

export type MemoryGovernanceReason =
  | 'interval'
  | 'playback-active'
  | 'visibility-hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'tauri-window-hidden'
  | 'manual';

export type MemoryGovernanceAction =
  | 'clear-cover-runtime-caches'
  | 'tighten-cover-runtime-caches-watch'
  | 'tighten-cover-runtime-caches-high'
  | 'tighten-cover-runtime-caches-critical'
  | 'tighten-cover-runtime-caches-hidden'
  | 'destroy-hidden-editor-windows'
  | 'destroy-hidden-plugin-windows'
  | 'destroy-hidden-vst-manager-windows';

export type MemoryGovernanceWebview2Snapshot = {
  processSampleAtMs: number;
  sampleIntervalMs: number | null;
  cpuCount: number;
  webview2WorkingSetBytes: number;
  webview2PrivateBytes: number;
  webview2CpuPercent: number | null;
  treeWorkingSetBytes: number;
  treePrivateBytes: number;
  treeCpuPercent: number | null;
};

export type MemoryGovernanceSnapshot = {
  atMs: number;
  isTauri: boolean;
  jsHeapUsedBytes?: number;
  navigationHistoryBytes: number;
  coverBlobUrlTotalBytes: number;
  coverBlobUrlCacheEntries: number;
  coverUrlCacheEntries: number;
  coverUrlInflight: number;
  albumCoverUrlCacheEntries: number;
  webview2?: MemoryGovernanceWebview2Snapshot;
};

export type MemoryGovernancePlan = {
  tier: MemoryGovernanceTier;
  actions: MemoryGovernanceAction[];
};

export type MemoryGovernanceRunResult = {
  snapshot: MemoryGovernanceSnapshot;
  plan: MemoryGovernancePlan;
  executed: MemoryGovernanceAction[];
};

export const DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED = true;

export const MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES = 50;

export const MEMORY_GOVERNANCE_INTERVAL_MS = 30_000;
export const MEMORY_GOVERNANCE_PLAYBACK_INTERVAL_MS = 10_000;

// Mirrors the MusicLibraryService in-memory blob URL cache budget.
export const COVER_BLOB_CACHE_MAX_BYTES = 12 * 1024 * 1024;

export function computeJsonSizeBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length * 2;
  } catch {
    return 0;
  }
}

export function decideMemoryGovernancePlan(snapshot: MemoryGovernanceSnapshot): MemoryGovernancePlan {
  const coverBlobRatio =
    COVER_BLOB_CACHE_MAX_BYTES > 0 ? snapshot.coverBlobUrlTotalBytes / COVER_BLOB_CACHE_MAX_BYTES : 0;

  const heap = snapshot.jsHeapUsedBytes ?? 0;
  const navBytes = snapshot.navigationHistoryBytes;
  const webview2Private = snapshot.webview2?.webview2PrivateBytes ?? 0;
  const webview2WorkingSet = snapshot.webview2?.webview2WorkingSetBytes ?? 0;
  const webview2Cpu = snapshot.webview2?.webview2CpuPercent ?? 0;
  const treePrivate = snapshot.webview2?.treePrivateBytes ?? 0;

  // Heuristic tiers (best-effort): we avoid aggressive actions by default and only reclaim when
  // multiple signals indicate pressure.
  let tier: MemoryGovernanceTier = 0;

  if (
    heap >= 950_000_000 ||
    navBytes >= 1_600_000 ||
    coverBlobRatio >= 0.98 ||
    webview2Private >= 700_000_000 ||
    webview2WorkingSet >= 950_000_000 ||
    treePrivate >= 1_200_000_000
  ) {
    tier = 3;
  } else if (
    heap >= 650_000_000 ||
    navBytes >= 800_000 ||
    coverBlobRatio >= 0.92 ||
    webview2Private >= 500_000_000 ||
    webview2WorkingSet >= 700_000_000 ||
    treePrivate >= 900_000_000 ||
    webview2Cpu >= 50
  ) {
    tier = 2;
  } else if (
    heap >= 450_000_000 ||
    navBytes >= 400_000 ||
    coverBlobRatio >= 0.85 ||
    webview2Private >= 350_000_000 ||
    webview2WorkingSet >= 500_000_000 ||
    treePrivate >= 650_000_000 ||
    webview2Cpu >= 30
  ) {
    tier = 1;
  }

  const actions: MemoryGovernanceAction[] = [];

  if (
    tier >= 1 &&
    (coverBlobRatio >= 0.80 ||
      snapshot.coverBlobUrlCacheEntries >= 128 ||
      snapshot.coverUrlCacheEntries >= 320)
  ) {
    actions.push('tighten-cover-runtime-caches-watch');

    if (
      tier >= 2 &&
      (coverBlobRatio >= 0.90 || snapshot.coverBlobUrlCacheEntries >= 192 || snapshot.coverUrlCacheEntries >= 480)
    ) {
      actions.push('tighten-cover-runtime-caches-high');
    }

    if (
      tier >= 3 &&
      (coverBlobRatio >= 0.96 || snapshot.coverBlobUrlCacheEntries >= 256 || snapshot.coverUrlCacheEntries >= 640)
    ) {
      actions.push('tighten-cover-runtime-caches-critical');
    }
  }

  if (!snapshot.isTauri && (coverBlobRatio >= 0.96 || snapshot.coverBlobUrlCacheEntries >= 256)) {
    actions.push('clear-cover-runtime-caches');
  }

  if (tier >= 2 && snapshot.isTauri) {
    actions.push('destroy-hidden-editor-windows');
    actions.push('destroy-hidden-plugin-windows');
    actions.push('destroy-hidden-vst-manager-windows');
  }

  return { tier, actions };
}
