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
  releaseLease(leaseId: string, reason?: RuntimePressureReason): void;
  releaseLeasesByOwner(ownerKind: RuntimeLeaseOwnerKind, ownerId: string, reason?: RuntimePressureReason): void;
  reclaimInactiveCapsules(options: RuntimeCapsuleReclaimOptions): RuntimeCapsuleReclaimResult[];
  collectSnapshot(): RuntimeCapsuleManagerSnapshot;
  subscribe(listener: RuntimeCapsuleSnapshotListener): () => void;
}

export const RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN = createServiceToken<RuntimeCapsuleManagerService>(
  'service.runtimeCapsuleManager'
);

type RuntimeCapsuleRecord = {
  manifest: RuntimeCapsuleManifest;
  state: RuntimeCapsuleState;
  activeLeases: Map<string, RuntimeLease>;
  lastTransition: RuntimeCapsuleTransition | null;
  lastActiveAtMs: number | null;
  lastSuspendedAtMs: number | null;
  lastFault?: {
    message: string;
    atMs: number;
  };
};

const DEFAULT_LEASE_PRIORITY: RuntimeLeasePriority = 'normal';
const DEFAULT_RECLAIM_MIN_TIER: RuntimeCapsuleMemoryTier = 'medium';

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
  private leaseSequence = 0;
  private lastUpdatedAtMs: number | null = null;
  private readonly telemetry = getTelemetryLogger('runtime-capsules', 'RuntimeCapsuleManagerService');

  constructor(private readonly now: () => number = () => Date.now()) {}

  registerCapsule(manifest: RuntimeCapsuleManifest): () => void {
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
      lastTransition: null,
      lastActiveAtMs: null,
      lastSuspendedAtMs: null,
    };

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
    const capsuleId = this.resolveCapsuleId(request);
    if (!capsuleId) {
      this.telemetry.warn('runtime-capsules.lease.acquire.missing-capsule', {
        fields: {
          requestedCapsuleId: request.capsuleId,
          capabilityId: request.capabilityId,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
        },
      });
      return null;
    }

    const record = this.capsules.get(capsuleId);
    if (!record) {
      this.telemetry.warn('runtime-capsules.lease.acquire.unregistered-capsule', {
        fields: {
          capsuleId,
          capabilityId: request.capabilityId,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
        },
      });
      return null;
    }

    const now = this.now();
    const lease: RuntimeLease = {
      id: `lease:${capsuleId}:${++this.leaseSequence}`,
      capsuleId,
      capabilityId: request.capabilityId,
      ownerKind: request.ownerKind,
      ownerId: request.ownerId,
      priority: request.priority ?? DEFAULT_LEASE_PRIORITY,
      acquiredAtMs: now,
      lastRenewedAtMs: now,
      expiresAtMs: request.ttlMs && request.ttlMs > 0 ? now + request.ttlMs : undefined,
      reason: {
        kind: request.ownerKind,
        ownerId: request.ownerId,
        capabilityId: request.capabilityId,
        ...request.reason,
      },
    };

    record.activeLeases.set(lease.id, lease);
    if (record.state !== 'active') {
      this.transition(record, 'active', lease.reason, now);
    } else {
      record.lastActiveAtMs = now;
    }

    this.lastUpdatedAtMs = now;
    this.emitSnapshot();
    this.telemetry.debug('runtime-capsules.lease.acquired', {
      fields: {
        capsuleId,
        capabilityId: request.capabilityId,
        ownerKind: request.ownerKind,
        ownerId: request.ownerId,
        activeLeaseCount: record.activeLeases.size,
      },
    });

    return lease;
  }

  releaseLease(leaseId: string, reason: RuntimePressureReason = createPressureReason('lease-expired')): void {
    const normalizedLeaseId = leaseId.trim();
    if (!normalizedLeaseId) return;

    for (const record of this.capsules.values()) {
      if (!record.activeLeases.has(normalizedLeaseId)) continue;

      record.activeLeases.delete(normalizedLeaseId);
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

  reclaimInactiveCapsules(options: RuntimeCapsuleReclaimOptions): RuntimeCapsuleReclaimResult[] {
    const now = this.now();
    const minMemoryTier = options.minMemoryTier ?? DEFAULT_RECLAIM_MIN_TIER;
    const nextState: RuntimeCapsuleState = options.mode === 'teardown' ? 'cold' : 'hibernated';
    const reclaimed: RuntimeCapsuleReclaimResult[] = [];

    const records = [...this.capsules.values()].sort((a, b) => {
      const tierDelta =
        memoryTierScore(b.manifest.memoryTier) - memoryTierScore(a.manifest.memoryTier);
      return tierDelta !== 0 ? tierDelta : a.manifest.id.localeCompare(b.manifest.id);
    });

    for (const record of records) {
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
    this.listeners.add(listener);
    listener(this.collectSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private unregisterCapsule(capsuleId: string, capabilityIds: readonly RuntimeCapabilityId[]): void {
    const record = this.capsules.get(capsuleId);
    if (!record) return;

    for (const capabilityId of capabilityIds) {
      if (this.capabilityToCapsuleId.get(capabilityId) === capsuleId) {
        this.capabilityToCapsuleId.delete(capabilityId);
      }
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
        record.manifest.backgroundPolicy === 'realtime-critical')
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
    const from = record.state;
    if (from === to) return;

    record.state = to;
    record.lastTransition = { from, to, reason, atMs };
    if (to === 'active') {
      record.lastActiveAtMs = atMs;
    }
    if (to === 'suspended' || to === 'frozen' || to === 'hibernated' || to === 'idle-warm') {
      record.lastSuspendedAtMs = atMs;
    }

    this.invokeParticipantHook(record, to, reason);

    this.telemetry.info('runtime-capsules.state.changed', {
      fields: {
        capsuleId: record.manifest.id,
        from,
        to,
        reasonKind: reason.kind,
      },
    });
  }

  private invokeParticipantHook(
    record: RuntimeCapsuleRecord,
    to: RuntimeCapsuleState,
    reason: RuntimeLeaseReason | RuntimePressureReason
  ): void {
    const participants = this.participantsByCapsuleId.get(record.manifest.id);
    if (!participants || participants.size === 0) return;

    for (const participant of participants.values()) {
      const hook =
        to === 'active'
          ? participant.onWarm
          : to === 'idle-warm' || to === 'suspended'
            ? participant.onSuspend
            : to === 'frozen'
              ? participant.onFreeze
              : to === 'hibernated'
                ? participant.onHibernate
                : to === 'cold'
                  ? participant.onTeardown
                  : undefined;
      if (typeof hook !== 'function') continue;

      try {
        const result = hook.call(participant, reason as never);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((error) => {
            this.telemetry.warn('runtime-capsules.participant.hook.failed', {
              message: error instanceof Error ? error.message : String(error),
              fields: {
                capsuleId: record.manifest.id,
                participantId: participant.id,
                to,
                reasonKind: reason.kind,
              },
            });
          });
        }
      } catch (error) {
        this.telemetry.warn('runtime-capsules.participant.hook.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            capsuleId: record.manifest.id,
            participantId: participant.id,
            to,
            reasonKind: reason.kind,
          },
        });
      }
    }
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
