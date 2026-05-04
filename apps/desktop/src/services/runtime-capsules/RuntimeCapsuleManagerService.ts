import type {
  RuntimeCapabilityId,
  RuntimeCapsuleManifest,
  RuntimeCapsuleMemoryTier,
  RuntimeCapsuleSnapshot,
  RuntimeCapsuleState,
  RuntimeCapsuleTransition,
  RuntimeLifecycleParticipant,
  RuntimeLease,
  RuntimeLeaseOwnerKind,
  RuntimeLeasePriority,
  RuntimeLeaseReason,
  RuntimeParticipantSnapshot,
  RuntimePressureReason,
} from '../../contracts/runtimeCapsule';
import { createServiceToken } from '../../kernel';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

export interface RuntimeCapsuleLeaseRequest {
  capsuleId?: string;
  capabilityId?: RuntimeCapabilityId;
  leaseKey?: string;
  ownerKind: RuntimeLeaseOwnerKind;
  ownerId: string;
  reason?: Partial<RuntimeLeaseReason>;
  priority?: RuntimeLeasePriority;
  ttlMs?: number;
}

export interface RuntimeCapsuleManagerSnapshot {
  capsules: RuntimeCapsuleSnapshot[];
  activeLeaseCount: number;
  registeredCapabilityCount: number;
  lastUpdatedAtMs: number | null;
}

export type RuntimeCapsuleSnapshotListener = (snapshot: RuntimeCapsuleManagerSnapshot) => void;

export type RuntimeCapsuleReclaimMode = 'hibernate' | 'teardown';

export interface RuntimeCapsuleReclaimOptions {
  reason: RuntimePressureReason;
  mode: RuntimeCapsuleReclaimMode;
  minMemoryTier?: RuntimeCapsuleMemoryTier;
  bypassWarmRetention?: boolean;
  includePinned?: boolean;
  targetCapsuleIds?: readonly string[];
}

export interface RuntimeCapsuleReclaimResult {
  capsuleId: string;
  from: RuntimeCapsuleState;
  to: RuntimeCapsuleState;
  memoryTier: RuntimeCapsuleMemoryTier;
  activeLeaseCount: number;
}

export interface RuntimeCapsuleManagerService {
  registerCapsule(manifest: RuntimeCapsuleManifest): () => void;
  registerCapsules(manifests: readonly RuntimeCapsuleManifest[]): () => void;
  registerParticipant(capsuleId: string, participant: RuntimeLifecycleParticipant): () => void;
  acquireLease(request: RuntimeCapsuleLeaseRequest): RuntimeLease | null;
  renewLease(leaseId: string, options?: RuntimeLeaseRenewOptions): RuntimeLease | null;
  releaseLease(leaseId: string, reason?: RuntimePressureReason): void;
  releaseLeasesByOwner(ownerKind: RuntimeLeaseOwnerKind, ownerId: string, reason?: RuntimePressureReason): void;
  sweepExpiredLeases(atMs?: number): string[];
  reclaimInactiveCapsules(options: RuntimeCapsuleReclaimOptions): RuntimeCapsuleReclaimResult[];
  collectSnapshot(): RuntimeCapsuleManagerSnapshot;
  subscribe(listener: RuntimeCapsuleSnapshotListener): () => void;
  dispose(): void;
}

export const RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN = createServiceToken<RuntimeCapsuleManagerService>(
  'service.runtimeCapsuleManager'
);

type RuntimeCapsuleRecord = {
  manifest: RuntimeCapsuleManifest;
  state: RuntimeCapsuleState;
  activeLeases: Map<string, RuntimeLease>;
  transitionToken: number;
  lastTransition: RuntimeCapsuleTransition | null;
  lastActiveAtMs: number | null;
  lastSuspendedAtMs: number | null;
  lastFault?: {
    message: string;
    atMs: number;
  };
};

type RuntimeLeaseLookup = {
  record: RuntimeCapsuleRecord;
  lease: RuntimeLease;
};

export type RuntimeLeaseRenewOptions = {
  ttlMs?: number;
  reason?: Partial<RuntimeLeaseReason>;
  priority?: RuntimeLeasePriority;
};

type RuntimeLifecycleHookName =
  | 'onWarm'
  | 'onSuspend'
  | 'onFreeze'
  | 'onHibernate'
  | 'onTeardown';

const DEFAULT_LEASE_PRIORITY: RuntimeLeasePriority = 'normal';
const DEFAULT_RECLAIM_MIN_TIER: RuntimeCapsuleMemoryTier = 'medium';
const DEFAULT_TRANSITION_TIMEOUT_MS = 2_500;
const DEPENDENCY_LEASE_OWNER_KIND: RuntimeLeaseOwnerKind = 'system';
const DEPENDENCY_LEASE_OWNER_ID = 'runtime-capsule-manager:dependency';

function createPressureReason(kind: RuntimePressureReason['kind'], detail?: string): RuntimePressureReason {
  return { kind, detail };
}

function memoryTierScore(tier: RuntimeCapsuleMemoryTier): number {
  if (tier === 'heavy') return 2;
  if (tier === 'medium') return 1;
  return 0;
}

export class DefaultRuntimeCapsuleManagerService implements RuntimeCapsuleManagerService {
  private readonly capsules = new Map<string, RuntimeCapsuleRecord>();
  private readonly capabilityToCapsuleId = new Map<RuntimeCapabilityId, string>();
  private readonly participantsByCapsuleId = new Map<string, Map<string, RuntimeLifecycleParticipant>>();
  private readonly listeners = new Set<RuntimeCapsuleSnapshotListener>();
  private readonly leaseKeyToLeaseId = new Map<string, string>();
  private readonly dependencyLeaseIdsByLeaseId = new Map<string, string[]>();
  private readonly pendingTransitionTimers = new Set<ReturnType<typeof setTimeout>>();
  private leaseSequence = 0;
  private lastUpdatedAtMs: number | null = null;
  private disposed = false;
  private readonly telemetry = getTelemetryLogger('runtime-capsules', 'RuntimeCapsuleManagerService');

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly transitionTimeoutMs: number = DEFAULT_TRANSITION_TIMEOUT_MS
  ) {}

  registerCapsule(manifest: RuntimeCapsuleManifest): () => void {
    if (this.disposed) return () => undefined;
    const normalizedId = manifest.id.trim();
    if (!normalizedId) {
      throw new Error('[RuntimeCapsuleManagerService] Capsule id is required');
    }

    const nextManifest = { ...manifest, id: normalizedId };
    const existing = this.capsules.get(normalizedId);
    const record: RuntimeCapsuleRecord = existing ?? {
      manifest: nextManifest,
      state: 'cold',
      activeLeases: new Map(),
      transitionToken: 0,
      lastTransition: null,
      lastActiveAtMs: null,
      lastSuspendedAtMs: null,
    };

    for (const capabilityId of existing?.manifest.provides ?? []) {
      if (
        !nextManifest.provides?.includes(capabilityId) &&
        this.capabilityToCapsuleId.get(capabilityId) === normalizedId
      ) {
        this.capabilityToCapsuleId.delete(capabilityId);
      }
    }

    record.manifest = nextManifest;
    this.capsules.set(normalizedId, record);
    for (const capabilityId of nextManifest.provides ?? []) {
      this.capabilityToCapsuleId.set(capabilityId, normalizedId);
    }

    this.lastUpdatedAtMs = this.now();
    this.emitSnapshot();
    this.telemetry.debug('runtime-capsules.manifest.registered', {
      fields: {
        capsuleId: normalizedId,
        kind: nextManifest.kind,
        memoryTier: nextManifest.memoryTier,
        startup: nextManifest.startup,
      },
    });

    return () => this.unregisterCapsule(normalizedId, nextManifest.provides ?? []);
  }

  registerCapsules(manifests: readonly RuntimeCapsuleManifest[]): () => void {
    const unregisters = manifests.map((manifest) => this.registerCapsule(manifest));
    return () => {
      for (const unregister of unregisters.reverse()) {
        unregister();
      }
    };
  }

  registerParticipant(capsuleId: string, participant: RuntimeLifecycleParticipant): () => void {
    if (this.disposed) return () => undefined;
    const normalizedCapsuleId = capsuleId.trim();
    const normalizedParticipantId = participant.id.trim();
    if (!normalizedCapsuleId || !normalizedParticipantId) return () => undefined;

    if (participant.capsuleId !== normalizedCapsuleId) {
      this.telemetry.warn('runtime-capsules.participant.capsule-mismatch', {
        fields: {
          capsuleId: normalizedCapsuleId,
          participantCapsuleId: participant.capsuleId,
          participantId: normalizedParticipantId,
        },
      });
    }

    if (!this.capsules.has(normalizedCapsuleId)) {
      this.telemetry.warn('runtime-capsules.participant.register.unregistered-capsule', {
        fields: {
          capsuleId: normalizedCapsuleId,
          participantId: normalizedParticipantId,
        },
      });
    }

    let participants = this.participantsByCapsuleId.get(normalizedCapsuleId);
    if (!participants) {
      participants = new Map();
      this.participantsByCapsuleId.set(normalizedCapsuleId, participants);
    }
    participants.set(normalizedParticipantId, participant);

    this.lastUpdatedAtMs = this.now();
    this.emitSnapshot();
    this.telemetry.debug('runtime-capsules.participant.registered', {
      fields: {
        capsuleId: normalizedCapsuleId,
        participantId: normalizedParticipantId,
        participantCount: participants.size,
      },
    });

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const current = this.participantsByCapsuleId.get(normalizedCapsuleId);
      if (!current) return;
      const registered = current.get(normalizedParticipantId);
      if (registered !== participant) return;
      current.delete(normalizedParticipantId);
      if (current.size === 0) {
        this.participantsByCapsuleId.delete(normalizedCapsuleId);
      }
      this.lastUpdatedAtMs = this.now();
      this.emitSnapshot();
    };
  }

  acquireLease(request: RuntimeCapsuleLeaseRequest): RuntimeLease | null {
    return this.acquireLeaseInternal(request, new Set());
  }

  renewLease(
    leaseId: string,
    options: RuntimeLeaseRenewOptions = {}
  ): RuntimeLease | null {
    const normalizedLeaseId = leaseId.trim();
    if (!normalizedLeaseId) return null;

    const lookup = this.findLeaseById(normalizedLeaseId);
    if (!lookup) return null;

    const renewed = this.renewLeaseRecord(lookup.record, lookup.lease, options);
    this.renewDependencyLeases(lookup.lease, options.ttlMs);
    return renewed;
  }

  releaseLease(leaseId: string, reason: RuntimePressureReason = createPressureReason('lease-expired')): void {
    if (this.disposed) return;
    const normalizedLeaseId = leaseId.trim();
    if (!normalizedLeaseId) return;

    for (const record of this.capsules.values()) {
      if (!record.activeLeases.has(normalizedLeaseId)) continue;

      const lease = record.activeLeases.get(normalizedLeaseId);
      record.activeLeases.delete(normalizedLeaseId);
      if (lease?.key) {
        this.leaseKeyToLeaseId.delete(lease.key);
      }
      const dependencyLeaseIds = this.dependencyLeaseIdsByLeaseId.get(normalizedLeaseId) ?? [];
      this.dependencyLeaseIdsByLeaseId.delete(normalizedLeaseId);
      for (const dependencyLeaseId of dependencyLeaseIds) {
        this.releaseLease(dependencyLeaseId, {
          kind: reason.kind,
          sourceId: reason.sourceId,
          spaceId: reason.spaceId,
          detail: `dependency released for ${normalizedLeaseId}: ${reason.detail ?? reason.kind}`,
          pressureLevel: reason.pressureLevel,
        });
      }

      const now = this.now();
      if (record.activeLeases.size === 0) {
        this.transition(record, 'idle-warm', reason, now);
      }
      this.lastUpdatedAtMs = now;
      this.emitSnapshot();
      this.telemetry.debug('runtime-capsules.lease.released', {
        fields: {
          capsuleId: record.manifest.id,
          leaseId: normalizedLeaseId,
          activeLeaseCount: record.activeLeases.size,
          reason: reason.kind,
        },
      });
      return;
    }
  }

  releaseLeasesByOwner(
    ownerKind: RuntimeLeaseOwnerKind,
    ownerId: string,
    reason: RuntimePressureReason = createPressureReason('lease-expired')
  ): void {
    if (this.disposed) return;
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return;

    const leaseIds: string[] = [];
    for (const record of this.capsules.values()) {
      for (const lease of record.activeLeases.values()) {
        if (lease.ownerKind === ownerKind && lease.ownerId === normalizedOwnerId) {
          leaseIds.push(lease.id);
        }
      }
    }

    for (const leaseId of leaseIds) {
      this.releaseLease(leaseId, reason);
    }
  }

  sweepExpiredLeases(atMs: number = this.now()): string[] {
    if (this.disposed) return [];
    const expiredLeaseIds: string[] = [];
    for (const record of this.capsules.values()) {
      for (const lease of record.activeLeases.values()) {
        if (typeof lease.expiresAtMs !== 'number') continue;
        if (lease.expiresAtMs > atMs) continue;
        expiredLeaseIds.push(lease.id);
      }
    }

    for (const leaseId of expiredLeaseIds) {
      this.releaseLease(leaseId, {
        kind: 'lease-expired',
        sourceId: 'runtime-capsule-manager',
        detail: 'lease ttl expired',
      });
    }

    return expiredLeaseIds;
  }

  reclaimInactiveCapsules(options: RuntimeCapsuleReclaimOptions): RuntimeCapsuleReclaimResult[] {
    if (this.disposed) return [];
    const now = this.now();
    const minMemoryTier = options.minMemoryTier ?? DEFAULT_RECLAIM_MIN_TIER;
    const nextState: RuntimeCapsuleState = options.mode === 'teardown' ? 'cold' : 'hibernated';
    const reclaimed: RuntimeCapsuleReclaimResult[] = [];
    const targetCapsuleIds = options.targetCapsuleIds
      ? new Set(options.targetCapsuleIds.map((id) => id.trim()).filter(Boolean))
      : null;

    const records = [...this.capsules.values()].sort((a, b) => {
      const tierDelta =
        memoryTierScore(b.manifest.memoryTier) - memoryTierScore(a.manifest.memoryTier);
      return tierDelta !== 0 ? tierDelta : a.manifest.id.localeCompare(b.manifest.id);
    });

    for (const record of records) {
      if (targetCapsuleIds && !targetCapsuleIds.has(record.manifest.id)) continue;
      if (!this.canReclaimRecord(record, options, minMemoryTier, now)) continue;

      const from = record.state;
      this.transition(record, nextState, options.reason, now);
      reclaimed.push({
        capsuleId: record.manifest.id,
        from,
        to: nextState,
        memoryTier: record.manifest.memoryTier,
        activeLeaseCount: record.activeLeases.size,
      });
    }

    if (reclaimed.length > 0) {
      this.lastUpdatedAtMs = now;
      this.emitSnapshot();
      this.telemetry.info('runtime-capsules.reclaimed', {
        fields: {
          mode: options.mode,
          reasonKind: options.reason.kind,
          minMemoryTier,
          capsuleIds: reclaimed.map((item) => item.capsuleId),
        },
      });
    }

    return reclaimed;
  }

  collectSnapshot(): RuntimeCapsuleManagerSnapshot {
    const capsules = [...this.capsules.values()]
      .map((record) => this.snapshotRecord(record))
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

    return {
      capsules,
      activeLeaseCount: capsules.reduce((total, capsule) => total + capsule.activeLeases.length, 0),
      registeredCapabilityCount: this.capabilityToCapsuleId.size,
      lastUpdatedAtMs: this.lastUpdatedAtMs,
    };
  }

  subscribe(listener: RuntimeCapsuleSnapshotListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.collectSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.capsules.values()) {
      record.transitionToken += 1;
    }
    this.listeners.clear();
    this.capsules.clear();
    this.capabilityToCapsuleId.clear();
    this.participantsByCapsuleId.clear();
    this.leaseKeyToLeaseId.clear();
    this.dependencyLeaseIdsByLeaseId.clear();
    for (const timer of this.pendingTransitionTimers) {
      clearTimeout(timer);
    }
    this.pendingTransitionTimers.clear();
    this.lastUpdatedAtMs = this.now();
  }

  private unregisterCapsule(capsuleId: string, capabilityIds: readonly RuntimeCapabilityId[]): void {
    if (this.disposed) return;
    const record = this.capsules.get(capsuleId);
    if (!record) return;

    const activeLeaseIds = [...record.activeLeases.keys()];
    for (const leaseId of activeLeaseIds) {
      this.releaseLease(leaseId, {
        kind: 'shutdown',
        sourceId: 'runtime-capsule-manager',
        detail: `capsule unregistered: ${capsuleId}`,
      });
    }

    for (const capabilityId of capabilityIds) {
      if (this.capabilityToCapsuleId.get(capabilityId) === capsuleId) {
        this.capabilityToCapsuleId.delete(capabilityId);
      }
    }
    for (const lease of record.activeLeases.values()) {
      if (lease.key) {
        this.leaseKeyToLeaseId.delete(lease.key);
      }
      this.dependencyLeaseIdsByLeaseId.delete(lease.id);
    }
    this.capsules.delete(capsuleId);
    this.participantsByCapsuleId.delete(capsuleId);
    this.lastUpdatedAtMs = this.now();
    this.emitSnapshot();
  }

  private resolveCapsuleId(request: RuntimeCapsuleLeaseRequest): string | null {
    const explicit = request.capsuleId?.trim();
    if (explicit) return explicit;
    if (!request.capabilityId) return null;
    return this.capabilityToCapsuleId.get(request.capabilityId) ?? null;
  }

  private resolveDependencyCapsuleId(dependencyId: string): string | null {
    const normalized = dependencyId.trim();
    if (!normalized) return null;
    if (this.capsules.has(normalized)) return normalized;
    return this.capabilityToCapsuleId.get(normalized) ?? null;
  }

  private acquireLeaseInternal(
    request: RuntimeCapsuleLeaseRequest,
    dependencyStack: Set<string>
  ): RuntimeLease | null {
    if (this.disposed) return null;

    const capsuleId = this.resolveCapsuleId(request);
    const ownerId = request.ownerId.trim();
    if (!capsuleId || !ownerId) return null;

    const record = this.capsules.get(capsuleId);
    if (!record) {
      this.telemetry.warn('runtime-capsules.lease.acquire.unregistered-capsule', {
        fields: {
          capsuleId,
          capabilityId: request.capabilityId,
          ownerKind: request.ownerKind,
          ownerId,
        },
      });
      return null;
    }

    if (dependencyStack.has(capsuleId)) {
      this.telemetry.warn('runtime-capsules.lease.acquire.dependency-cycle', {
        fields: {
          capsuleId,
          dependencyStack: [...dependencyStack],
        },
      });
      return null;
    }

    const leaseKey = this.buildLeaseKey(request, capsuleId, ownerId);
    const existingLeaseId = this.leaseKeyToLeaseId.get(leaseKey);
    if (existingLeaseId) {
      const existing = this.findLeaseById(existingLeaseId);
      if (existing && existing.record === record) {
        const renewed = this.renewLeaseRecord(existing.record, existing.lease, {
          ttlMs: request.ttlMs,
          priority: request.priority,
          reason: {
            ...request.reason,
            capabilityId: request.capabilityId ?? request.reason?.capabilityId,
          },
        });
        this.renewDependencyLeases(existing.lease, request.ttlMs);
        return renewed;
      }
      this.leaseKeyToLeaseId.delete(leaseKey);
    }

    const dependencyLeaseIds: string[] = [];
    dependencyStack.add(capsuleId);
    try {
      for (const dependencyId of record.manifest.dependencies ?? []) {
        const dependencyCapsuleId = this.resolveDependencyCapsuleId(dependencyId);
        if (!dependencyCapsuleId) {
          this.telemetry.warn('runtime-capsules.lease.acquire.missing-dependency', {
            fields: {
              capsuleId,
              dependencyId,
            },
          });
          this.releaseDependencyLeases(
            dependencyLeaseIds,
            `dependency acquisition failed for ${capsuleId}`
          );
          return null;
        }

        const dependencyLease = this.acquireLeaseInternal(
          {
            capsuleId: dependencyCapsuleId,
            leaseKey: this.buildDependencyLeaseKey(leaseKey, dependencyCapsuleId),
            ownerKind: DEPENDENCY_LEASE_OWNER_KIND,
            ownerId: DEPENDENCY_LEASE_OWNER_ID,
            priority: 'background',
            ttlMs: request.ttlMs,
            reason: {
              spaceId: request.reason?.spaceId,
              routeId: request.reason?.routeId,
              detail: `dependency for ${capsuleId}`,
            },
          },
          dependencyStack
        );
        if (!dependencyLease) {
          this.releaseDependencyLeases(
            dependencyLeaseIds,
            `dependency acquisition failed for ${capsuleId}`
          );
          return null;
        }
        dependencyLeaseIds.push(dependencyLease.id);
      }
    } finally {
      dependencyStack.delete(capsuleId);
    }

    const now = this.now();
    const lease: RuntimeLease = {
      id: `runtime-lease-${++this.leaseSequence}`,
      key: leaseKey,
      capsuleId,
      capabilityId: request.capabilityId,
      ownerKind: request.ownerKind,
      ownerId,
      priority: request.priority ?? DEFAULT_LEASE_PRIORITY,
      acquiredAtMs: now,
      expiresAtMs:
        typeof request.ttlMs === 'number' && request.ttlMs > 0 ? now + request.ttlMs : undefined,
      reason: {
        kind: request.ownerKind,
        ownerId,
        capabilityId: request.capabilityId ?? request.reason?.capabilityId,
        spaceId: request.reason?.spaceId,
        routeId: request.reason?.routeId,
        detail: request.reason?.detail,
      },
    };

    record.activeLeases.set(lease.id, lease);
    this.leaseKeyToLeaseId.set(leaseKey, lease.id);
    if (dependencyLeaseIds.length > 0) {
      this.dependencyLeaseIdsByLeaseId.set(lease.id, dependencyLeaseIds);
    }

    this.transition(record, 'active', lease.reason, now);
    this.lastUpdatedAtMs = now;
    this.emitSnapshot();
    this.telemetry.debug('runtime-capsules.lease.acquired', {
      fields: {
        capsuleId,
        leaseId: lease.id,
        leaseKey,
        ownerKind: request.ownerKind,
        ownerId,
        dependencyLeaseCount: dependencyLeaseIds.length,
        activeLeaseCount: record.activeLeases.size,
      },
    });

    return lease;
  }

  private buildLeaseKey(
    request: RuntimeCapsuleLeaseRequest,
    capsuleId: string,
    ownerId: string
  ): string {
    const explicit = request.leaseKey?.trim();
    if (explicit) return explicit;

    return [
      'runtime',
      request.ownerKind,
      ownerId,
      capsuleId,
      request.capabilityId ?? request.reason?.capabilityId ?? '',
      request.reason?.spaceId ?? '',
      request.reason?.routeId ?? '',
    ].join(':');
  }

  private buildDependencyLeaseKey(parentLeaseKey: string, dependencyCapsuleId: string): string {
    return ['dependency', parentLeaseKey, dependencyCapsuleId].join(':');
  }

  private findLeaseById(leaseId: string): RuntimeLeaseLookup | null {
    for (const record of this.capsules.values()) {
      const lease = record.activeLeases.get(leaseId);
      if (!lease) continue;
      return { record, lease };
    }
    return null;
  }

  private renewLeaseRecord(
    record: RuntimeCapsuleRecord,
    lease: RuntimeLease,
    options: RuntimeLeaseRenewOptions
  ): RuntimeLease {
    const now = this.now();
    lease.lastRenewedAtMs = now;
    if (typeof options.ttlMs === 'number') {
      lease.expiresAtMs = options.ttlMs > 0 ? now + options.ttlMs : undefined;
    }
    if (options.priority) {
      lease.priority = options.priority;
    }
    if (options.reason) {
      lease.reason = {
        ...lease.reason,
        ...options.reason,
        kind: lease.ownerKind,
        ownerId: lease.ownerId,
      };
    }

    this.lastUpdatedAtMs = now;
    this.emitSnapshot();
    this.telemetry.debug('runtime-capsules.lease.renewed', {
      fields: {
        capsuleId: record.manifest.id,
        leaseId: lease.id,
        leaseKey: lease.key,
        expiresAtMs: lease.expiresAtMs,
      },
    });

    return lease;
  }

  private renewDependencyLeases(parentLease: RuntimeLease, ttlMs: number | undefined): void {
    for (const dependencyLeaseId of this.dependencyLeaseIdsByLeaseId.get(parentLease.id) ?? []) {
      const lookup = this.findLeaseById(dependencyLeaseId);
      if (!lookup) continue;
      this.renewLeaseRecord(lookup.record, lookup.lease, {
        ttlMs,
        reason: {
          detail: `dependency renewed for ${parentLease.id}`,
        },
      });
    }
  }

  private releaseDependencyLeases(leaseIds: readonly string[], detail: string): void {
    for (const leaseId of leaseIds) {
      this.releaseLease(leaseId, {
        kind: 'lease-expired',
        sourceId: DEPENDENCY_LEASE_OWNER_ID,
        detail,
      });
    }
  }

  private canReclaimRecord(
    record: RuntimeCapsuleRecord,
    options: RuntimeCapsuleReclaimOptions,
    minMemoryTier: RuntimeCapsuleMemoryTier,
    now: number
  ): boolean {
    if (record.activeLeases.size > 0) return false;
    if (record.manifest.startup === 'core') return false;
    if (memoryTierScore(record.manifest.memoryTier) < memoryTierScore(minMemoryTier)) return false;
    if (
      options.includePinned !== true &&
      (record.manifest.backgroundPolicy === 'pinned' ||
        (record.manifest.backgroundPolicy === 'realtime-critical' &&
          record.manifest.reclaimableWhenIdle !== true))
    ) {
      return false;
    }

    if (
      record.state === 'cold' ||
      record.state === 'active' ||
      record.state === 'resolving' ||
      record.state === 'warming' ||
      record.state === 'tearing_down' ||
      record.state === 'faulted'
    ) {
      return false;
    }

    if (options.mode === 'hibernate' && record.state === 'hibernated') return false;
    if (options.bypassWarmRetention === true) return true;

    const inactiveSince = record.lastSuspendedAtMs ?? record.lastActiveAtMs;
    if (inactiveSince === null) return false;
    const inactiveMs = Math.max(0, now - inactiveSince);

    if (record.state === 'hibernated') {
      return options.mode === 'teardown' && inactiveMs >= record.manifest.hibernateAfterMs;
    }

    if (options.mode === 'teardown') {
      return inactiveMs >= record.manifest.hibernateAfterMs;
    }

    return inactiveMs >= record.manifest.warmRetentionMs;
  }

  private transition(
    record: RuntimeCapsuleRecord,
    to: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason,
    atMs: number
  ): void {
    if (to === 'active') {
      this.transitionWithSettledHooks(
        record,
        'warming',
        'active',
        'onWarm',
        reason,
        atMs
      );
      return;
    }

    if (to === 'cold') {
      this.transitionWithSettledHooks(
        record,
        'tearing_down',
        'cold',
        'onTeardown',
        reason,
        atMs
      );
      return;
    }

    const changed = this.applyState(record, to, reason, atMs);
    if (!changed) return;

    const hookName = this.resolveHookName(to);
    if (hookName) {
      this.invokeParticipantHook(record, hookName, to, reason);
    }
  }

  private transitionWithSettledHooks(
    record: RuntimeCapsuleRecord,
    pendingState: RuntimeCapsuleState,
    finalState: RuntimeCapsuleState,
    hookName: RuntimeLifecycleHookName,
    reason: RuntimeLeaseReason | RuntimePressureReason,
    atMs: number
  ): void {
    if (record.state === finalState || record.state === pendingState) return;

    const participants = this.participantsByCapsuleId.get(record.manifest.id);
    if (!participants || participants.size === 0) {
      this.applyState(record, finalState, reason, atMs);
      return;
    }

    const token = record.transitionToken + 1;
    record.transitionToken = token;
    const pendingChanged = this.applyState(record, pendingState, reason, atMs, {
      preserveTransitionToken: true,
    });
    if (!pendingChanged) return;

    const hookPromises = this.invokeParticipantHook(record, hookName, pendingState, reason);
    if (hookPromises.length === 0) {
      this.finalizeSettledTransition(record, token, pendingState, finalState, reason);
      return;
    }

    this.waitForSettledHooks(record, token, pendingState, finalState, reason, hookPromises);
  }

  private waitForSettledHooks(
    record: RuntimeCapsuleRecord,
    token: number,
    pendingState: RuntimeCapsuleState,
    finalState: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason,
    hookPromises: Array<Promise<void>>
  ): void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = Math.max(0, this.transitionTimeoutMs);
    const hooksSettled = Promise.allSettled(hookPromises).then(() => 'settled' as const);
    const timeoutSettled = new Promise<'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTransitionTimers.delete(timer);
        if (timeoutId === timer) {
          timeoutId = null;
        }
        resolve('timeout');
      }, timeoutMs);
      timeoutId = timer;
      this.pendingTransitionTimers.add(timer);
    });

    void Promise.race([hooksSettled, timeoutSettled]).then((result) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        this.pendingTransitionTimers.delete(timeoutId);
        timeoutId = null;
      }
      if (this.disposed) return;
      if (result === 'timeout') {
        this.telemetry.warn('runtime-capsules.participant.hook.timeout', {
          fields: {
            capsuleId: record.manifest.id,
            pendingState,
            finalState,
            timeoutMs,
            reasonKind: reason.kind,
          },
        });
      }
      this.finalizeSettledTransition(record, token, pendingState, finalState, reason);
    });
  }

  private finalizeSettledTransition(
    record: RuntimeCapsuleRecord,
    token: number,
    pendingState: RuntimeCapsuleState,
    finalState: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason
  ): void {
    if (this.disposed) return;
    if (record.transitionToken !== token || record.state !== pendingState) return;
    this.applyState(record, finalState, reason, this.now());
  }

  private applyState(
    record: RuntimeCapsuleRecord,
    to: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason,
    atMs: number,
    options: { preserveTransitionToken?: boolean } = {}
  ): boolean {
    const from = record.state;
    if (from === to) return false;

    record.state = to;
    if (options.preserveTransitionToken !== true) {
      record.transitionToken += 1;
    }
    record.lastTransition = { from, to, reason, atMs };
    if (to === 'active') {
      record.lastActiveAtMs = atMs;
      record.lastFault = undefined;
    }
    if (to === 'suspended' || to === 'frozen' || to === 'hibernated' || to === 'idle-warm') {
      record.lastSuspendedAtMs = atMs;
    }
    if (to === 'cold') {
      record.lastSuspendedAtMs = null;
    }

    this.lastUpdatedAtMs = atMs;
    this.emitSnapshot();
    this.telemetry.info('runtime-capsules.state.changed', {
      fields: {
        capsuleId: record.manifest.id,
        from,
        to,
        reasonKind: reason.kind,
      },
    });
    return true;
  }

  private resolveHookName(to: RuntimeCapsuleState): RuntimeLifecycleHookName | null {
    if (to === 'active') return 'onWarm';
    if (to === 'idle-warm' || to === 'suspended') return 'onSuspend';
    if (to === 'frozen') return 'onFreeze';
    if (to === 'hibernated') return 'onHibernate';
    if (to === 'cold') return 'onTeardown';
    return null;
  }

  private invokeParticipantHook(
    record: RuntimeCapsuleRecord,
    hookName: RuntimeLifecycleHookName,
    to: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason
  ): Array<Promise<void>> {
    const participants = this.participantsByCapsuleId.get(record.manifest.id);
    if (!participants || participants.size === 0) return [];

    const promises: Array<Promise<void>> = [];
    for (const participant of participants.values()) {
      const hook = participant[hookName];
      if (typeof hook !== 'function') continue;

      try {
        const result = hook.call(participant, reason as never);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          promises.push(
            (result as Promise<void>).catch((error) => {
              this.telemetry.warn('runtime-capsules.participant.hook.failed', {
                message: error instanceof Error ? error.message : String(error),
                fields: {
                  capsuleId: record.manifest.id,
                  participantId: participant.id,
                  hookName,
                  to,
                  reasonKind: reason.kind,
                },
              });
            })
          );
        }
      } catch (error) {
        this.telemetry.warn('runtime-capsules.participant.hook.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            capsuleId: record.manifest.id,
            participantId: participant.id,
            hookName,
            to,
            reasonKind: reason.kind,
          },
        });
      }
    }
    return promises;
  }

  private snapshotRecord(record: RuntimeCapsuleRecord): RuntimeCapsuleSnapshot {
    return {
      manifest: { ...record.manifest },
      state: record.state,
      activeLeases: [...record.activeLeases.values()].map((lease) => ({
        ...lease,
        reason: { ...lease.reason },
      })),
      participants: this.collectParticipantSnapshots(record),
      lastTransition: record.lastTransition
        ? {
            ...record.lastTransition,
            reason: { ...record.lastTransition.reason },
          }
        : null,
      lastActiveAtMs: record.lastActiveAtMs,
      lastSuspendedAtMs: record.lastSuspendedAtMs,
      lastFault: record.lastFault ? { ...record.lastFault } : undefined,
    };
  }

  private collectParticipantSnapshots(record: RuntimeCapsuleRecord): RuntimeParticipantSnapshot[] {
    const participants = this.participantsByCapsuleId.get(record.manifest.id);
    if (!participants || participants.size === 0) return [];

    return [...participants.values()]
      .map((participant) => this.readParticipantSnapshot(record, participant))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private readParticipantSnapshot(
    record: RuntimeCapsuleRecord,
    participant: RuntimeLifecycleParticipant
  ): RuntimeParticipantSnapshot {
    try {
      return (
        participant.collectSnapshot?.() ?? {
          id: participant.id,
          capsuleId: participant.capsuleId,
          state: record.state,
        }
      );
    } catch (error) {
      this.telemetry.warn('runtime-capsules.participant.snapshot.failed', {
        message: error instanceof Error ? error.message : String(error),
        fields: {
          capsuleId: record.manifest.id,
          participantId: participant.id,
        },
      });
      return {
        id: participant.id,
        capsuleId: participant.capsuleId,
        state: record.state,
        detail: {
          snapshotError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private emitSnapshot(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.collectSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
