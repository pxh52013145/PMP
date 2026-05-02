import type {
  RuntimeCapabilityId,
  RuntimeCapsuleManifest,
  RuntimeCapsuleSnapshot,
  RuntimeCapsuleState,
  RuntimeCapsuleTransition,
  RuntimeLease,
  RuntimeLeaseOwnerKind,
  RuntimeLeasePriority,
  RuntimeLeaseReason,
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

export interface RuntimeCapsuleManagerService {
  registerCapsule(manifest: RuntimeCapsuleManifest): () => void;
  registerCapsules(manifests: readonly RuntimeCapsuleManifest[]): () => void;
  acquireLease(request: RuntimeCapsuleLeaseRequest): RuntimeLease | null;
  releaseLease(leaseId: string, reason?: RuntimePressureReason): void;
  releaseLeasesByOwner(ownerKind: RuntimeLeaseOwnerKind, ownerId: string, reason?: RuntimePressureReason): void;
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

function createPressureReason(kind: RuntimePressureReason['kind'], detail?: string): RuntimePressureReason {
  return { kind, detail };
}

export class DefaultRuntimeCapsuleManagerService implements RuntimeCapsuleManagerService {
  private readonly capsules = new Map<string, RuntimeCapsuleRecord>();
  private readonly capabilityToCapsuleId = new Map<RuntimeCapabilityId, string>();
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
    this.lastUpdatedAtMs = this.now();
    this.emitSnapshot();
  }

  private resolveCapsuleId(request: RuntimeCapsuleLeaseRequest): string | null {
    const explicit = request.capsuleId?.trim();
    if (explicit) return explicit;
    if (!request.capabilityId) return null;
    return this.capabilityToCapsuleId.get(request.capabilityId) ?? null;
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

    this.telemetry.info('runtime-capsules.state.changed', {
      fields: {
        capsuleId: record.manifest.id,
        from,
        to,
        reasonKind: reason.kind,
      },
    });
  }

  private snapshotRecord(record: RuntimeCapsuleRecord): RuntimeCapsuleSnapshot {
    return {
      manifest: { ...record.manifest },
      state: record.state,
      activeLeases: [...record.activeLeases.values()].map((lease) => ({
        ...lease,
        reason: { ...lease.reason },
      })),
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

  private emitSnapshot(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.collectSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
