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
import type { RuntimeCapsuleManagerService } from '../runtime-capsules';
import { buildRuntimeCapsulesMemoryGovernanceSnapshot } from './runtimeCapsuleGovernanceAdapter';

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

export type MemoryGovernanceCoverRuntimeCachePolicy =
  | 'default'
  | 'watch'
  | 'high'
  | 'critical'
  | 'hidden';

export type MemoryGovernanceCoverRuntimeCacheStats = {
  coverUrlCacheEntries: number;
  coverBlobUrlCacheEntries: number;
  coverBlobUrlTotalBytes: number;
  coverDecodedEstimateEntries: number;
  coverDecodedEstimateTotalBytes: number;
  coverUrlInflight: number;
  albumCoverUrlCacheEntries: number;
  albumCoverUrlInflight: number;
};

export interface MemoryGovernanceCoverRuntimeCacheHost {
  getCoverRuntimeCacheStats(): MemoryGovernanceCoverRuntimeCacheStats;
  clearCoverRuntimeCaches(): void;
  applyCoverRuntimeCachePolicy(policy: MemoryGovernanceCoverRuntimeCachePolicy): void;
}

export type MemoryGovernanceCoverRuntimeCacheHostProvider =
  () => MemoryGovernanceCoverRuntimeCacheHost | null;

const HIDDEN_PHASE_REASONS: ReadonlySet<MemoryGovernanceReason> = new Set([
  'visibility-hidden',
  'pagehide',
  'beforeunload',
  'tauri-main-window-hidden',
  'tauri-window-hidden',
]);

const TERMINAL_PHASE_REASONS: ReadonlySet<MemoryGovernanceReason> = new Set([
  'pagehide',
  'beforeunload',
]);

const HIDDEN_PHASE_BASE_ACTIONS: readonly MemoryGovernanceAction[] = [
  'tighten-cover-runtime-caches-hidden',
  'hibernate-idle-runtime-capsules',
];

const HIDDEN_PHASE_TAURI_ACTIONS: readonly MemoryGovernanceAction[] = [
  'trim-webview2-working-set',
  'trim-tree-working-set',
  'destroy-hidden-editor-windows',
  'destroy-hidden-plugin-windows',
  'destroy-hidden-vst-manager-windows',
];

const EDITOR_EXIT_TAURI_ACTIONS: readonly MemoryGovernanceAction[] = [
  'destroy-hidden-editor-windows',
  'trim-webview2-working-set',
  'trim-tree-working-set',
];

const ACTION_TO_COVER_RUNTIME_POLICY: Partial<
  Record<MemoryGovernanceAction, MemoryGovernanceCoverRuntimeCachePolicy>
> = {
  'tighten-cover-runtime-caches-watch': 'watch',
  'tighten-cover-runtime-caches-high': 'high',
  'tighten-cover-runtime-caches-critical': 'critical',
  'tighten-cover-runtime-caches-hidden': 'hidden',
};

const EMPTY_COVER_RUNTIME_CACHE_STATS: MemoryGovernanceCoverRuntimeCacheStats = {
  coverUrlCacheEntries: 0,
  coverBlobUrlCacheEntries: 0,
  coverBlobUrlTotalBytes: 0,
  coverDecodedEstimateEntries: 0,
  coverDecodedEstimateTotalBytes: 0,
  coverUrlInflight: 0,
  albumCoverUrlCacheEntries: 0,
  albumCoverUrlInflight: 0,
};

const MEMORY_GOVERNANCE_REASON_PRIORITY: Record<MemoryGovernanceReason, number> = {
  interval: 0,
  'playback-active': 1,
  'editor-window-hidden': 1,
  'plugin-window-hidden': 1,
  'vst-manager-window-hidden': 1,
  'runtime-release': 2,
  'space-switch': 2,
  manual: 2,
  'editor-exit': 3,
  'visibility-hidden': 3,
  'tauri-main-window-hidden': 3,
  'tauri-window-hidden': 3,
  pagehide: 4,
  beforeunload: 4,
};

type QueuedMemoryGovernanceRun = {
  reason: MemoryGovernanceReason;
  resolve: (result: MemoryGovernanceRunResult) => void;
  reject: (error: unknown) => void;
  promise: Promise<MemoryGovernanceRunResult>;
};

type MemoryGovernanceRunOptions = {
  skipWebview2Snapshot?: boolean;
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
  if (reason === 'editor-exit' && isTauri) {
    appendUniqueActions(plannedActions, EDITOR_EXIT_TAURI_ACTIONS);
  }
  if (!HIDDEN_PHASE_REASONS.has(reason)) {
    return plannedActions;
  }

  appendUniqueActions(plannedActions, HIDDEN_PHASE_BASE_ACTIONS);

  if (isTauri) {
    appendUniqueActions(plannedActions, HIDDEN_PHASE_TAURI_ACTIONS);
  }

  return plannedActions;
}

function chooseHigherPriorityReason(
  current: MemoryGovernanceReason,
  next: MemoryGovernanceReason
): MemoryGovernanceReason {
  return MEMORY_GOVERNANCE_REASON_PRIORITY[next] > MEMORY_GOVERNANCE_REASON_PRIORITY[current]
    ? next
    : current;
}

function createQueuedRun(reason: MemoryGovernanceReason): QueuedMemoryGovernanceRun {
  let resolve!: (result: MemoryGovernanceRunResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<MemoryGovernanceRunResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { reason, resolve, reject, promise };
}

export class DefaultMemoryGovernanceService implements MemoryGovernanceService {
  private lastResult: MemoryGovernanceRunResult | null = null;
  private activeRun: Promise<MemoryGovernanceRunResult> | null = null;
  private queuedRun: QueuedMemoryGovernanceRun | null = null;
  private readonly telemetry = getTelemetryLogger('memory-governance', 'MemoryGovernanceService');

  constructor(
    private readonly navigation: NavigationService,
    private readonly events: ScopedEventBus<AppEvents>,
    private readonly processPerfService: ProcessPerfService,
    private readonly spaceRuntimeGovernance: SpaceRuntimeGovernanceService | null = null,
    private readonly runtimeCapsuleManager: RuntimeCapsuleManagerService | null = null,
    private readonly coverRuntimeCacheHostProvider: MemoryGovernanceCoverRuntimeCacheHostProvider =
      () => null
  ) {}

  getLastResult(): MemoryGovernanceRunResult | null {
    return this.lastResult;
  }

  runOnce(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult> {
    if (TERMINAL_PHASE_REASONS.has(reason)) {
      return this.runOnceInternal(reason, { skipWebview2Snapshot: true });
    }

    if (this.activeRun) {
      if (this.queuedRun) {
        this.queuedRun.reason = chooseHigherPriorityReason(this.queuedRun.reason, reason);
        return this.queuedRun.promise;
      }

      this.queuedRun = createQueuedRun(reason);
      return this.queuedRun.promise;
    }

    return this.startRun(reason);
  }

  private startRun(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult> {
    const run = this.runOnceInternal(reason);
    this.activeRun = run;

    const finish = () => {
      if (this.activeRun !== run) return;
      this.activeRun = null;

      const queued = this.queuedRun;
      this.queuedRun = null;
      if (!queued) return;

      this.startRun(queued.reason).then(queued.resolve, queued.reject);
    };
    void run.then(finish, finish);

    return run;
  }

  private async runOnceInternal(
    reason: MemoryGovernanceReason,
    options: MemoryGovernanceRunOptions = {}
  ): Promise<MemoryGovernanceRunResult> {
    const snapshot = await this.collectSnapshot(options);
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

      if (action === 'hibernate-idle-runtime-capsules') {
        const targetCapsuleIds = snapshot.runtimeCapsules?.reclaimableCapsuleIds ?? [];
        const budgetViolationCapsuleIds =
          snapshot.runtimeCapsules?.budgetViolationCapsuleIds ?? [];
        const reclaimed = this.runtimeCapsuleManager?.reclaimInactiveCapsules({
          mode: 'hibernate',
          minMemoryTier: 'medium',
          bypassWarmRetention: budgetViolationCapsuleIds.length > 0,
          targetCapsuleIds: targetCapsuleIds.length > 0 ? targetCapsuleIds : undefined,
          reason: {
            kind: 'memory-pressure',
            sourceId: 'memory-governance',
            detail: `memory-governance:${reason}`,
            pressureLevel: plan.tier >= 2 ? 'high' : plan.tier >= 1 ? 'watch' : 'normal',
          },
        }) ?? [];
        if (reclaimed.length > 0) {
          executed.push(action);
          this.telemetry.info('memory-governance.runtime-capsule.hibernate', {
            fields: {
              reason,
              tier: plan.tier,
              capsuleIds: reclaimed.map((item) => item.capsuleId),
            },
          });
        }
        continue;
      }

      if (action === 'teardown-idle-runtime-capsules') {
        const targetCapsuleIds = [
          ...(snapshot.runtimeCapsules?.reclaimableCapsuleIds ?? []),
          ...(snapshot.runtimeCapsules?.pressureReclaimableCapsuleIds ?? []),
          ...(snapshot.runtimeCapsules?.hibernatedCapsuleIds ?? []),
        ];
        const reclaimed = this.runtimeCapsuleManager?.reclaimInactiveCapsules({
          mode: 'teardown',
          minMemoryTier: 'medium',
          bypassWarmRetention: plan.tier >= 2,
          targetCapsuleIds: targetCapsuleIds.length > 0 ? targetCapsuleIds : undefined,
          reason: {
            kind: 'memory-pressure',
            sourceId: 'memory-governance',
            detail: `memory-governance:${reason}`,
            pressureLevel: 'high',
          },
        }) ?? [];
        if (reclaimed.length > 0) {
          executed.push(action);
          this.telemetry.info('memory-governance.runtime-capsule.teardown', {
            fields: {
              reason,
              tier: plan.tier,
              capsuleIds: reclaimed.map((item) => item.capsuleId),
            },
          });
        }
        continue;
      }

      if (action === 'clear-cover-runtime-caches') {
        try {
          const coverRuntimeCacheHost = this.getCoverRuntimeCacheHost();
          if (coverRuntimeCacheHost) {
            coverRuntimeCacheHost.clearCoverRuntimeCaches();
            executed.push(action);
          }
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
          const coverRuntimeCacheHost = this.getCoverRuntimeCacheHost();
          if (coverRuntimeCacheHost) {
            coverRuntimeCacheHost.applyCoverRuntimeCachePolicy(policy);
            if (policy === 'hidden') {
              coverRuntimeCacheHost.clearCoverRuntimeCaches();
            }
            executed.push(action);
          }
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

  private async collectSnapshot(
    options: MemoryGovernanceRunOptions = {}
  ): Promise<MemoryGovernanceSnapshot> {
    const atMs = Date.now();
    const isTauri = isTauriRuntime();

    const navSnapshot = this.navigation.getSnapshot();
    const navigationHistoryBytes = computeJsonSizeBytes(navSnapshot.history);

    const coverStats = this.collectCoverRuntimeCacheStats();

    const jsHeapUsedBytes = (() => {
      try {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
        const value = memory?.usedJSHeapSize;
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      } catch {
        return undefined;
      }
    })();

    const webview2 =
      options.skipWebview2Snapshot === true
        ? undefined
        : await this.collectWebview2Snapshot(isTauri);
    const spaceRuntimeSnapshot = this.spaceRuntimeGovernance?.collectSnapshot();
    const runtimeCapsules = buildRuntimeCapsulesMemoryGovernanceSnapshot(
      this.runtimeCapsuleManager,
      atMs
    );

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
            hibernatedSpaceIds: spaceRuntimeSnapshot.hibernatedSpaceIds,
            heavySpaceIds: spaceRuntimeSnapshot.heavySpaceIds,
            zeroAssociationSpaceIds: spaceRuntimeSnapshot.zeroAssociationSpaceIds,
            reclaimableSpaceIds: spaceRuntimeSnapshot.reclaimableSpaceIds,
            lastSwitchAt: spaceRuntimeSnapshot.lastSwitchAt,
            descriptors: spaceRuntimeSnapshot.descriptors.map((descriptor) => ({
              spaceId: descriptor.spaceId,
              state: descriptor.state,
              kind: descriptor.kind,
              memoryTier: descriptor.memoryTier,
              activeAssociationCount: descriptor.activeAssociationCount,
              participants: descriptor.participants,
            })),
          }
        : undefined,
      runtimeCapsules,
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
      webview2PrivateWorkingSetBytes: totals.totals.webview2PrivateWorkingSetBytes,
      webview2WorkingSetBytes: totals.totals.webview2WorkingSetBytes,
      webview2PrivateBytes: totals.totals.webview2PrivateBytes,
      webview2CpuPercent: totals.totals.webview2CpuPercent,
      treePrivateWorkingSetBytes: totals.totals.privateWorkingSetBytes,
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

  private getCoverRuntimeCacheHost(): MemoryGovernanceCoverRuntimeCacheHost | null {
    try {
      return this.coverRuntimeCacheHostProvider();
    } catch (error) {
      this.telemetry.warn('memory-governance.cover-cache.host.resolve.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private collectCoverRuntimeCacheStats(): MemoryGovernanceCoverRuntimeCacheStats {
    try {
      return (
        this.getCoverRuntimeCacheHost()?.getCoverRuntimeCacheStats() ??
        EMPTY_COVER_RUNTIME_CACHE_STATS
      );
    } catch (error) {
      this.telemetry.warn('memory-governance.cover-cache.stats.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return EMPTY_COVER_RUNTIME_CACHE_STATS;
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
