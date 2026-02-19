import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  computeJsonSizeBytes,
  decideMemoryGovernancePlan,
  type MemoryGovernanceWebview2Snapshot,
  type MemoryGovernanceAction,
  type MemoryGovernanceReason,
  type MemoryGovernanceRunResult,
  type MemoryGovernanceSnapshot,
} from '../../contracts/memoryGovernance';
import { MusicLibraryService, type CoverRuntimeCachePolicy } from '../audio/MusicLibraryService';
import type { NavigationService } from '../navigation/NavigationService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES } from '../../contracts/memoryGovernance';
import { getProcessPerfTotalsSnapshot } from '../../modules/debug';

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

const HIDDEN_PHASE_REASONS: ReadonlySet<MemoryGovernanceReason> = new Set([
  'visibility-hidden',
  'pagehide',
  'beforeunload',
  'tauri-window-hidden',
]);

const HIDDEN_PHASE_BASE_ACTION: MemoryGovernanceAction = 'tighten-cover-runtime-caches-hidden';

const HIDDEN_PHASE_TAURI_ACTIONS: readonly MemoryGovernanceAction[] = [
  'destroy-hidden-editor-windows',
  'destroy-hidden-plugin-windows',
  'destroy-hidden-vst-manager-windows',
];

const ACTION_TO_COVER_RUNTIME_POLICY: Partial<Record<MemoryGovernanceAction, CoverRuntimeCachePolicy>> = {
  'tighten-cover-runtime-caches-watch': 'watch',
  'tighten-cover-runtime-caches-high': 'high',
  'tighten-cover-runtime-caches-critical': 'critical',
  'tighten-cover-runtime-caches-hidden': 'hidden',
};

function appendUniqueActions(
  target: MemoryGovernanceAction[],
  actions: readonly MemoryGovernanceAction[]
): void {
  for (const action of actions) {
    if (!target.includes(action)) {
      target.push(action);
    }
  }
}

function buildPlannedActions(
  baseActions: readonly MemoryGovernanceAction[],
  reason: MemoryGovernanceReason,
  isTauri: boolean
): MemoryGovernanceAction[] {
  const plannedActions: MemoryGovernanceAction[] = [...baseActions];
  if (!HIDDEN_PHASE_REASONS.has(reason)) {
    return plannedActions;
  }

  if (!plannedActions.includes(HIDDEN_PHASE_BASE_ACTION)) {
    plannedActions.unshift(HIDDEN_PHASE_BASE_ACTION);
  }

  if (isTauri) {
    appendUniqueActions(plannedActions, HIDDEN_PHASE_TAURI_ACTIONS);
  }

  return plannedActions;
}

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
    const snapshot = await this.collectSnapshot();
    const plan = decideMemoryGovernancePlan(snapshot);
    const plannedActions = buildPlannedActions(plan.actions, reason, snapshot.isTauri);

    const executed: MemoryGovernanceAction[] = [];

    for (const action of plannedActions) {
      if (action === 'clear-cover-runtime-caches') {
        try {
          MusicLibraryService.getInstance().clearCoverRuntimeCaches();
          executed.push(action);
        } catch (error) {
          console.warn('[memory-governance] failed to clear cover caches', error);
        }
        continue;
      }

      const policy = ACTION_TO_COVER_RUNTIME_POLICY[action];
      if (policy) {
        try {
          MusicLibraryService.getInstance().applyCoverRuntimeCachePolicy(policy);
          executed.push(action);
        } catch (error) {
          console.warn('[memory-governance] failed to tighten cover cache policy', error);
        }
        continue;
      }

      if (action === 'destroy-hidden-editor-windows') {
        if (
          await this.invokeTauriGovernanceCommand(
            snapshot.isTauri,
            'governance_destroy_hidden_editor_windows',
            '[memory-governance] failed to destroy hidden editor windows'
          )
        ) {
          executed.push(action);
        }
        continue;
      }

      if (action === 'destroy-hidden-plugin-windows') {
        if (
          await this.invokeTauriGovernanceCommand(
            snapshot.isTauri,
            'governance_destroy_hidden_plugin_windows',
            '[memory-governance] failed to destroy hidden plugin windows'
          )
        ) {
          executed.push(action);
        }
        continue;
      }

      if (action === 'destroy-hidden-vst-manager-windows') {
        if (
          await this.invokeTauriGovernanceCommand(
            snapshot.isTauri,
            'governance_destroy_hidden_vst_manager_windows',
            '[memory-governance] failed to destroy hidden vst-manager windows'
          )
        ) {
          executed.push(action);
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

  private async collectSnapshot(): Promise<MemoryGovernanceSnapshot> {
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

    const webview2 = await this.collectWebview2Snapshot(isTauri);

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
      webview2,
    };
  }

  private async collectWebview2Snapshot(
    isTauri: boolean
  ): Promise<MemoryGovernanceWebview2Snapshot | undefined> {
    if (!isTauri) return undefined;

    try {
      const totals = await getProcessPerfTotalsSnapshot();
      if (!totals) return undefined;

      return {
        processSampleAtMs: totals.timestampMs,
        sampleIntervalMs: totals.sampleIntervalMs,
        cpuCount: totals.cpuCount,
        webview2WorkingSetBytes: totals.totals.webview2WorkingSetBytes,
        webview2PrivateBytes: totals.totals.webview2PrivateBytes,
        webview2CpuPercent: totals.totals.webview2CpuPercent,
        treeWorkingSetBytes: totals.totals.workingSetBytes,
        treePrivateBytes: totals.totals.privateBytes,
        treeCpuPercent: totals.totals.cpuPercent,
      };
    } catch (error) {
      console.warn('[memory-governance] failed to collect webview2 snapshot', error);
      return undefined;
    }
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

  private async invokeTauriGovernanceCommand(
    isTauri: boolean,
    command: string,
    warningPrefix: string
  ): Promise<boolean> {
    if (!isTauri) return false;

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke(command);
      return true;
    } catch (error) {
      console.warn(warningPrefix, error);
      return false;
    }
  }
}
