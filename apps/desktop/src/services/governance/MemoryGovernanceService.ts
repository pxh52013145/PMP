import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import {
  computeJsonSizeBytes,
  decideMemoryGovernancePlan,
  type MemoryGovernanceRuntimeCapsuleBudgetViolation,
  type MemoryGovernanceRuntimeCapsuleDescriptor,
  type MemoryGovernanceRuntimeCapsulesSnapshot,
  type MemoryGovernanceWebview2Snapshot,
  type MemoryGovernanceAction,
  type MemoryGovernanceReason,
  type MemoryGovernanceRunResult,
  type MemoryGovernanceSnapshot,
} from '../../contracts/memoryGovernance';
import type { CoverRuntimeCachePolicy } from '../audio/MusicLibraryService';
import { getRegisteredMusicLibraryService } from '../audio/MusicLibraryServiceRegistry';
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
import type {
  RuntimeCapsuleSnapshot,
  RuntimeParticipantSnapshot,
} from '../../contracts/runtimeCapsule';

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

const ACTION_TO_COVER_RUNTIME_POLICY: Partial<Record<MemoryGovernanceAction, CoverRuntimeCachePolicy>> = {
  'tighten-cover-runtime-caches-watch': 'watch',
  'tighten-cover-runtime-caches-high': 'high',
  'tighten-cover-runtime-caches-critical': 'critical',
  'tighten-cover-runtime-caches-hidden': 'hidden',
};

const EMPTY_COVER_RUNTIME_CACHE_STATS = {
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
  manual: 2,
  'visibility-hidden': 3,
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

function runtimeCapsuleMemoryTierScore(
  tier: MemoryGovernanceRuntimeCapsuleDescriptor['memoryTier']
): number {
  if (tier === 'heavy') return 2;
  if (tier === 'medium') return 1;
  return 0;
}

function isRuntimeCapsuleReclaimable(
  descriptor: MemoryGovernanceRuntimeCapsuleDescriptor,
  atMs: number
): boolean {
  if (descriptor.activeLeaseCount > 0) return false;
  if (descriptor.startup === 'core') return false;
  if (runtimeCapsuleMemoryTierScore(descriptor.memoryTier) < 1) return false;
  if (
    descriptor.backgroundPolicy === 'pinned'
  ) {
    return false;
  }
  if (
    descriptor.state !== 'idle-warm' &&
    descriptor.state !== 'suspended' &&
    descriptor.state !== 'frozen'
  ) {
    return false;
  }

  const inactiveSince = descriptor.lastSuspendedAtMs ?? descriptor.lastActiveAtMs;
  if (inactiveSince === null) return false;
  if ((descriptor.budgetViolationCount ?? 0) > 0) return true;
  return Math.max(0, atMs - inactiveSince) >= descriptor.warmRetentionMs;
}

function sumParticipantMetric(
  participants: readonly RuntimeParticipantSnapshot[] | undefined,
  key: keyof Pick<
    RuntimeParticipantSnapshot,
    'timers' | 'listeners' | 'blobUrls' | 'decodedImageBytes' | 'estimatedJsHeapBytes'
  >
): number | null {
  if (!participants || participants.length === 0) return null;

  let total = 0;
  let seen = false;
  for (const participant of participants) {
    const value = participant[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += Math.max(0, Math.floor(value));
    seen = true;
  }
  return seen ? total : null;
}

function collectRuntimeCapsuleBudgetViolations(
  capsule: RuntimeCapsuleSnapshot
): MemoryGovernanceRuntimeCapsuleBudgetViolation[] {
  const budget = capsule.manifest.budget;
  if (!budget) return [];

  const checks: Array<{
    budgetKey: MemoryGovernanceRuntimeCapsuleBudgetViolation['budgetKey'];
    actual: number | null;
    limit: number | undefined;
  }> = [
    {
      budgetKey: 'maxTimers',
      actual: sumParticipantMetric(capsule.participants, 'timers'),
      limit: budget.maxTimers,
    },
    {
      budgetKey: 'maxListeners',
      actual: sumParticipantMetric(capsule.participants, 'listeners'),
      limit: budget.maxListeners,
    },
    {
      budgetKey: 'maxBlobUrls',
      actual: sumParticipantMetric(capsule.participants, 'blobUrls'),
      limit: budget.maxBlobUrls,
    },
    {
      budgetKey: 'maxDecodedImageBytes',
      actual: sumParticipantMetric(capsule.participants, 'decodedImageBytes'),
      limit: budget.maxDecodedImageBytes,
    },
    {
      budgetKey: 'jsHeapSoftBytes',
      actual: sumParticipantMetric(capsule.participants, 'estimatedJsHeapBytes'),
      limit: budget.jsHeapSoftBytes,
    },
    {
      budgetKey: 'jsHeapHardBytes',
      actual: sumParticipantMetric(capsule.participants, 'estimatedJsHeapBytes'),
      limit: budget.jsHeapHardBytes,
    },
  ];

  return checks.flatMap(({ budgetKey, actual, limit }) => {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return [];
    if (actual === null || actual <= limit) return [];
    return [
      {
        capsuleId: capsule.manifest.id,
        budgetKey,
        actual,
        limit: Math.max(0, Math.floor(limit)),
      },
    ];
  });
}

function buildRuntimeCapsulesSnapshot(
  runtimeCapsuleManager: RuntimeCapsuleManagerService | null,
  atMs: number
): MemoryGovernanceRuntimeCapsulesSnapshot | undefined {
  const managerSnapshot = runtimeCapsuleManager?.collectSnapshot();
  if (!managerSnapshot) return undefined;

  const budgetViolations = managerSnapshot.capsules.flatMap((capsule) =>
    collectRuntimeCapsuleBudgetViolations(capsule)
  );
  const budgetViolationCounts = new Map<string, number>();
  for (const violation of budgetViolations) {
    budgetViolationCounts.set(
      violation.capsuleId,
      (budgetViolationCounts.get(violation.capsuleId) ?? 0) + 1
    );
  }

  const descriptors: MemoryGovernanceRuntimeCapsuleDescriptor[] = managerSnapshot.capsules.map(
    (capsule) => ({
      id: capsule.manifest.id,
      state: capsule.state,
      kind: capsule.manifest.kind,
      memoryTier: capsule.manifest.memoryTier,
      startup: capsule.manifest.startup,
      backgroundPolicy: capsule.manifest.backgroundPolicy,
      activeLeaseCount: capsule.activeLeases.length,
      lastActiveAtMs: capsule.lastActiveAtMs,
      lastSuspendedAtMs: capsule.lastSuspendedAtMs,
      warmRetentionMs: capsule.manifest.warmRetentionMs,
      hibernateAfterMs: capsule.manifest.hibernateAfterMs,
      budgetViolationCount: budgetViolationCounts.get(capsule.manifest.id) ?? 0,
    })
  );
  const reclaimable = descriptors.filter((descriptor) =>
    isRuntimeCapsuleReclaimable(descriptor, atMs)
  );

  return {
    activeLeaseCount: managerSnapshot.activeLeaseCount,
    activeCapsuleIds: descriptors
      .filter((descriptor) => descriptor.activeLeaseCount > 0 || descriptor.state === 'active')
      .map((descriptor) => descriptor.id),
    idleWarmCapsuleIds: descriptors
      .filter((descriptor) => descriptor.state === 'idle-warm')
      .map((descriptor) => descriptor.id),
    hibernatedCapsuleIds: descriptors
      .filter((descriptor) => descriptor.state === 'hibernated')
      .map((descriptor) => descriptor.id),
    reclaimableCapsuleIds: reclaimable.map((descriptor) => descriptor.id),
    heavyReclaimableCapsuleIds: reclaimable
      .filter((descriptor) => descriptor.memoryTier === 'heavy')
      .map((descriptor) => descriptor.id),
    budgetViolationCapsuleIds: [...budgetViolationCounts.keys()],
    budgetViolations,
    descriptors,
  };
}

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
    private readonly runtimeCapsuleManager: RuntimeCapsuleManagerService | null = null
  ) {}

  getLastResult(): MemoryGovernanceRunResult | null {
    return this.lastResult;
  }

  runOnce(reason: MemoryGovernanceReason): Promise<MemoryGovernanceRunResult> {
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
    reason: MemoryGovernanceReason
  ): Promise<MemoryGovernanceRunResult> {
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
          const service = getRegisteredMusicLibraryService();
          if (service) {
            service.clearCoverRuntimeCaches();
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
          const service = getRegisteredMusicLibraryService();
          if (service) {
            service.applyCoverRuntimeCachePolicy(policy);
            if (policy === 'hidden') {
              service.clearCoverRuntimeCaches();
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

  private async collectSnapshot(): Promise<MemoryGovernanceSnapshot> {
    const atMs = Date.now();
    const isTauri = isTauriRuntime();

    const navSnapshot = this.navigation.getSnapshot();
    const navigationHistoryBytes = computeJsonSizeBytes(navSnapshot.history);

    const coverStats =
      getRegisteredMusicLibraryService()?.getCoverRuntimeCacheStats() ??
      EMPTY_COVER_RUNTIME_CACHE_STATS;

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
    const runtimeCapsules = buildRuntimeCapsulesSnapshot(this.runtimeCapsuleManager, atMs);

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
