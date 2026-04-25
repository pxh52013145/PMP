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
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import { scheduleProcessWorkingSetTrim } from '../../utils/processWorkingSetTrim';
import type { ProcessPerfService } from '../performance-control';
import type { SpaceRuntimeGovernanceService } from './SpaceRuntimeGovernanceService';

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
  'trim-webview2-working-set',
  'trim-tree-working-set',
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
  private readonly telemetry = getTelemetryLogger('memory-governance', 'MemoryGovernanceService');

  constructor(
    private readonly navigation: NavigationService,
    private readonly events: ScopedEventBus<AppEvents>,
    private readonly processPerfService: ProcessPerfService,
    private readonly spaceRuntimeGovernance: SpaceRuntimeGovernanceService | null = null
  ) {}

  getLastResult(): MemoryGovernanceRunResult | null {
    return this.lastResult;
  }

  async runOnce(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult> {
    const snapshot = await this.collectSnapshot();
    const plan = decideMemoryGovernancePlan(snapshot);
    const plannedActions = buildPlannedActions(plan.actions, reason, snapshot.isTauri);

    this.telemetry.info('memory-governance.run.start', {
      fields: {
        reason,
        tier: plan.tier,
        plannedActions,
      },
    });

    const executed: MemoryGovernanceAction[] = [];

    for (const action of plannedActions) {
      if (action === 'teardown-reclaimable-spaces') {
        const reclaimed = this.spaceRuntimeGovernance?.reclaim({
          reason: `memory-governance:${reason}`,
          minTier: Math.max(1, plan.tier),
        }) ?? [];
        if (reclaimed.length > 0) {
          executed.push(action);
          this.telemetry.info('memory-governance.space.cleanup', {
            fields: {
              reason,
              tier: plan.tier,
              reclaimedSpaceIds: reclaimed,
            },
          });
        }
        continue;
      }

      if (action === 'clear-cover-runtime-caches') {
        try {
          MusicLibraryService.getInstance().clearCoverRuntimeCaches();
          executed.push(action);
        } catch (error) {
          this.telemetry.warn('memory-governance.cover-cache.clear.failed', {
            message: error instanceof Error ? error.message : String(error),
            fields: { action, reason },
          });
        }
        continue;
      }

      const policy = ACTION_TO_COVER_RUNTIME_POLICY[action];
      if (policy) {
        try {
          const service = MusicLibraryService.getInstance();
          service.applyCoverRuntimeCachePolicy(policy);
          if (policy === 'hidden') {
            service.clearCoverRuntimeCaches();
          }
          executed.push(action);
        } catch (error) {
          this.telemetry.warn('memory-governance.cover-cache.policy.failed', {
            message: error instanceof Error ? error.message : String(error),
            fields: { action, policy, reason },
          });
        }
        continue;
      }

      if (action === 'trim-webview2-working-set') {
        if (snapshot.isTauri) {
          scheduleProcessWorkingSetTrim('webview2', {
            delaysMs: [0, 700, 2200],
            reason: `memory-governance:${reason}`,
          });
          executed.push(action);
        }
        continue;
      }

      if (action === 'trim-tree-working-set') {
        if (snapshot.isTauri) {
          scheduleProcessWorkingSetTrim('tree', {
            delaysMs: [0, 900, 2800],
            reason: `memory-governance:${reason}`,
          });
          executed.push(action);
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

    const result: MemoryGovernanceRunResult = { reason, snapshot, plan, executed };
    this.lastResult = result;

    this.appendAuditEntry({
      atMs: snapshot.atMs,
      reason,
      tier: plan.tier,
      actions: executed,
      snapshot,
    });

    this.events.emit('memory-governance/ran', result);
    this.telemetry.info('memory-governance.run.completed', {
      fields: {
        reason,
        tier: plan.tier,
        executed,
      },
    });
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
    const spaceRuntimeSnapshot = this.spaceRuntimeGovernance?.collectSnapshot();

    return {
      atMs,
      isTauri,
      jsHeapUsedBytes,
      navigationHistoryBytes,
      coverBlobUrlTotalBytes: coverStats.coverBlobUrlTotalBytes,
      coverBlobUrlCacheEntries: coverStats.coverBlobUrlCacheEntries,
      coverDecodedEstimateEntries: coverStats.coverDecodedEstimateEntries,
      coverDecodedEstimateTotalBytes: coverStats.coverDecodedEstimateTotalBytes,
      coverUrlCacheEntries: coverStats.coverUrlCacheEntries,
      coverUrlInflight: coverStats.coverUrlInflight,
      albumCoverUrlCacheEntries: coverStats.albumCoverUrlCacheEntries,
      spaceRuntime: spaceRuntimeSnapshot
        ? {
            activeSpaceId: spaceRuntimeSnapshot.activeSpaceId,
            frozenSpaceIds: spaceRuntimeSnapshot.frozenSpaceIds,
            heavySpaceIds: spaceRuntimeSnapshot.heavySpaceIds,
            zeroAssociationSpaceIds: spaceRuntimeSnapshot.zeroAssociationSpaceIds,
            reclaimableSpaceIds: spaceRuntimeSnapshot.reclaimableSpaceIds,
            lastSwitchAt: spaceRuntimeSnapshot.lastSwitchAt,
          }
        : undefined,
      webview2,
    };
  }

  private async collectWebview2Snapshot(
    isTauri: boolean
  ): Promise<MemoryGovernanceWebview2Snapshot | undefined> {
    if (!isTauri) return undefined;

    const totals = await this.processPerfService.refreshTotalsSnapshot();
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
  }

  private appendAuditEntry(entry: MemoryGovernanceAuditEntry): void {
    try {
      const existing = readJson<MemoryGovernanceAuditEntry[]>(STORAGE_KEYS.MEMORY_GOVERNANCE_AUDIT_V1, []);
      const next = [...existing, entry].slice(-MEMORY_GOVERNANCE_AUDIT_MAX_ENTRIES);
      writeJson(STORAGE_KEYS.MEMORY_GOVERNANCE_AUDIT_V1, next, { mode: 'idle', debounceMs: 300 });
    } catch (error) {
      this.telemetry.warn('memory-governance.audit.append.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async invokeTauriGovernanceCommand(
    isTauri: boolean,
    command: string,
    warningPrefix: string
  ): Promise<boolean> {
    if (!isTauri) return false;

    try {
      await invokeWithTelemetry(command, undefined, {
        moduleId: 'memory-governance',
        component: 'MemoryGovernanceService',
        event: 'memory-governance.command.invoke',
        successLevel: 'info',
      });
      return true;
    } catch (error) {
      this.telemetry.warn('memory-governance.command.invoke.failed', {
        message: error instanceof Error ? error.message : String(error),
        fields: {
          command,
          warningPrefix,
        },
      });
      return false;
    }
  }
}
