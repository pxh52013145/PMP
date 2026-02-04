import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  computeJsonSizeBytes,
  decideMemoryGovernancePlan,
  type MemoryGovernanceAction,
  type MemoryGovernanceReason,
  type MemoryGovernanceRunResult,
  type MemoryGovernanceSnapshot,
} from '../../contracts/memoryGovernance';
import { MusicLibraryService } from '../audio/MusicLibraryService';
import type { NavigationService } from '../navigation/NavigationService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES } from '../../contracts/memoryGovernance';

export type MemoryGovernanceAuditEntry = {
  atMs: number;
  reason: MemoryGovernanceReason;
  tier: number;
  actions: MemoryGovernanceAction[];
  snapshot: MemoryGovernanceSnapshot;
};

export interface MemoryGovernanceService {
  runOnce(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult>;
  getLastResult(): MemoryGovernanceRunResult | null;
}

export const MEMORY_GOVERNANCE_SERVICE_TOKEN = createServiceToken<MemoryGovernanceService>(
  'service.memoryGovernance'
);

export class DefaultMemoryGovernanceService implements MemoryGovernanceService {
  private lastResult: MemoryGovernanceRunResult | null = null;

  constructor(
    private readonly navigation: NavigationService,
    private readonly events: ScopedEventBus<AppEvents>
  ) {}

  getLastResult(): MemoryGovernanceRunResult | null {
    return this.lastResult;
  }

  async runOnce(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult> {
    const snapshot = this.collectSnapshot();
    const plan = decideMemoryGovernancePlan(snapshot);

    const executed: MemoryGovernanceAction[] = [];

    for (const action of plan.actions) {
      if (action === 'clear-cover-runtime-caches') {
        try {
          MusicLibraryService.getInstance().clearCoverRuntimeCaches();
          executed.push(action);
        } catch (error) {
          console.warn('[memory-governance] failed to clear cover caches', error);
        }
        continue;
      }

      if (action === 'destroy-hidden-editor-windows') {
        if (!snapshot.isTauri) continue;
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          await invoke('governance_destroy_hidden_editor_windows');
          executed.push(action);
        } catch (error) {
          console.warn('[memory-governance] failed to destroy hidden editor windows', error);
        }
        continue;
      }
    }

    const result: MemoryGovernanceRunResult = { snapshot, plan, executed };
    this.lastResult = result;

    this.appendAuditEntry({
      atMs: snapshot.atMs,
      reason,
      tier: plan.tier,
      actions: executed,
      snapshot,
    });

    this.events.emit('memory-governance/ran', result);
    return result;
  }

  private collectSnapshot(): MemoryGovernanceSnapshot {
    const atMs = Date.now();
    const isTauri = isTauriRuntime();

    const navSnapshot = this.navigation.getSnapshot();
    const navigationHistoryBytes = computeJsonSizeBytes(navSnapshot.history);

    const coverStats = MusicLibraryService.getInstance().getCoverRuntimeCacheStats();

    const jsHeapUsedBytes = (() => {
      try {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
        const value = memory?.usedJSHeapSize;
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      } catch {
        return undefined;
      }
    })();

    return {
      atMs,
      isTauri,
      jsHeapUsedBytes,
      navigationHistoryBytes,
      coverBlobUrlTotalBytes: coverStats.coverBlobUrlTotalBytes,
      coverBlobUrlCacheEntries: coverStats.coverBlobUrlCacheEntries,
      coverUrlCacheEntries: coverStats.coverUrlCacheEntries,
      coverUrlInflight: coverStats.coverUrlInflight,
      albumCoverUrlCacheEntries: coverStats.albumCoverUrlCacheEntries,
    };
  }

  private appendAuditEntry(entry: MemoryGovernanceAuditEntry): void {
    try {
      const existing = readJson<MemoryGovernanceAuditEntry[]>(STORAGE_KEYS.MEMORY_GOVERNANCE_AUDIT_V1, []);
      const next = [...existing, entry].slice(-MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES);
      writeJson(STORAGE_KEYS.MEMORY_GOVERNANCE_AUDIT_V1, next, { mode: 'idle', debounceMs: 300 });
    } catch (error) {
      console.warn('[memory-governance] failed to append audit entry', error);
    }
  }
}
