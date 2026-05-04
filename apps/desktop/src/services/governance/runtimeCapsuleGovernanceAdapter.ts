import type {
  MemoryGovernanceRuntimeCapsuleBudgetViolation,
  MemoryGovernanceRuntimeCapsuleDescriptor,
  MemoryGovernanceRuntimeCapsulesSnapshot,
} from '../../contracts/memoryGovernance';
import type {
  RuntimeCapsuleSnapshot,
  RuntimeParticipantSnapshot,
} from '../../contracts/runtimeCapsule';
import { resolveRuntimeCapsuleIdleReclaimPolicy } from '../../contracts/runtimeCapsule';
import type { RuntimeCapsuleManagerService } from '../runtime-capsules';

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
  if (descriptor.idleReclaimPolicy === 'protected') return false;
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
  if (descriptor.idleReclaimPolicy === 'budget-pressure-only') return false;
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

export function buildRuntimeCapsulesMemoryGovernanceSnapshot(
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
      idleReclaimPolicy: resolveRuntimeCapsuleIdleReclaimPolicy(capsule.manifest),
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
    pressureReclaimableCapsuleIds: descriptors
      .filter(
        (descriptor) =>
          descriptor.idleReclaimPolicy === 'budget-pressure-only' &&
          descriptor.activeLeaseCount === 0 &&
          descriptor.startup !== 'core' &&
          runtimeCapsuleMemoryTierScore(descriptor.memoryTier) >= 1 &&
          descriptor.state !== 'cold' &&
          descriptor.state !== 'active' &&
          descriptor.state !== 'resolving' &&
          descriptor.state !== 'warming' &&
          descriptor.state !== 'tearing_down' &&
          descriptor.state !== 'faulted'
      )
      .map((descriptor) => descriptor.id),
    heavyReclaimableCapsuleIds: reclaimable
      .filter((descriptor) => descriptor.memoryTier === 'heavy')
      .map((descriptor) => descriptor.id),
    budgetViolationCapsuleIds: [...budgetViolationCounts.keys()],
    budgetViolations,
    descriptors,
  };
}
