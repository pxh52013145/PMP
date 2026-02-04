export type MemoryGovernanceTier = 0 | 1 | 2 | 3;

export type MemoryGovernanceReason =
  | 'interval'
  | 'visibility-hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'tauri-window-hidden'
  | 'manual';

export type MemoryGovernanceAction = 'clear-cover-runtime-caches' | 'destroy-hidden-editor-windows';

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

export const DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED = false;

export const MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES = 50;

export const MEMORY_GOVERNANCE_INTERVAL_MS = 30_000;

// Mirrors the MusicLibraryService in-memory blob URL cache budget.
export const COVER_BLOB_CACHE_MAX_BYTES = 32 * 1024 * 1024;

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

  // Heuristic tiers (best-effort): we avoid aggressive actions by default and only reclaim when
  // multiple signals indicate pressure.
  let tier: MemoryGovernanceTier = 0;

  if (heap >= 1_200_000_000 || navBytes >= 2_000_000 || coverBlobRatio >= 0.98) tier = 3;
  else if (heap >= 900_000_000 || navBytes >= 1_000_000 || coverBlobRatio >= 0.92) tier = 2;
  else if (heap >= 700_000_000 || navBytes >= 512_000 || coverBlobRatio >= 0.85) tier = 1;

  const actions: MemoryGovernanceAction[] = [];

  if (tier >= 1 && (coverBlobRatio >= 0.85 || snapshot.coverBlobUrlCacheEntries >= 256)) {
    actions.push('clear-cover-runtime-caches');
  }

  if (tier >= 2 && snapshot.isTauri) {
    actions.push('destroy-hidden-editor-windows');
  }

  return { tier, actions };
}
