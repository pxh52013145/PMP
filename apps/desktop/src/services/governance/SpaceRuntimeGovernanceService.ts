import { createServiceToken } from '../../kernel';
import type {
  RuntimeLifecycleParticipant,
  RuntimeLeaseReason,
  RuntimeParticipantSnapshot,
  RuntimePressureReason,
} from '../../contracts/runtimeCapsule';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

export type SpaceRuntimeState = 'cold' | 'warming' | 'active' | 'frozen' | 'tearing_down';

export type SpaceRuntimeKind = 'default' | 'platform' | 'plugin-workspace' | 'editor-workspace';

export type SpaceRuntimeMemoryTier = 'light' | 'medium' | 'heavy';

export interface SpaceRuntimeDescriptor {
  spaceId: string;
  state: SpaceRuntimeState;
  kind: SpaceRuntimeKind;
  hasActivated: boolean;
  lastActivatedAt: number | null;
  lastFrozenAt: number | null;
  lastAssociatedAt: number | null;
  lastZeroAssociationAt: number | null;
  activeAssociationCount: number;
  warmRetentionMs: number;
  memoryTier: SpaceRuntimeMemoryTier;
  estimatedBudgetBytes?: number;
  keepWarmOnBlur: boolean;
  participants: RuntimeParticipantSnapshot[];
}

export interface SpaceRuntimeGovernanceSnapshot {
  activeSpaceId: string | null;
  descriptors: SpaceRuntimeDescriptor[];
  frozenSpaceIds: string[];
  heavySpaceIds: string[];
  zeroAssociationSpaceIds: string[];
  reclaimableSpaceIds: string[];
  lastSwitchAt: number | null;
}

export interface SpaceRuntimeGovernanceService {
  activateSpace(spaceId: string): void;
  warmSpace(spaceId: string): void;
  freezeSpace(spaceId: string): void;
  teardownSpace(spaceId: string, reason: string): void;
  registerParticipant(spaceId: string, participant: RuntimeLifecycleParticipant): () => void;
  retainSpaceAssociation(spaceId: string, resourceId: string): () => void;
  canRunBackground(spaceId: string): boolean;
  collectSnapshot(): SpaceRuntimeGovernanceSnapshot;
  reclaim(options: { reason: string; minTier: number }): string[];
}

export const SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN = createServiceToken<SpaceRuntimeGovernanceService>(
  'service.spaceRuntimeGovernance'
);

const DEFAULT_WARM_RETENTION_MS = 30_000;
const PLATFORM_SPACE_ID = 'space2';

function classifySpace(spaceId: string): Pick<SpaceRuntimeDescriptor, 'kind' | 'memoryTier' | 'warmRetentionMs' | 'keepWarmOnBlur'> {
  if (spaceId === PLATFORM_SPACE_ID) {
    return {
      kind: 'platform',
      memoryTier: 'heavy',
      warmRetentionMs: 10_000,
      keepWarmOnBlur: false,
    };
  }

  return {
    kind: 'default',
    memoryTier: 'light',
    warmRetentionMs: DEFAULT_WARM_RETENTION_MS,
    keepWarmOnBlur: true,
  };
}

export class DefaultSpaceRuntimeGovernanceService implements SpaceRuntimeGovernanceService {
  private readonly descriptors = new Map<string, SpaceRuntimeDescriptor>();
  private readonly associationsBySpaceId = new Map<string, Map<string, number>>();
  private readonly participantsBySpaceId = new Map<string, Map<string, RuntimeLifecycleParticipant>>();
  private activeSpaceId: string | null = null;
  private lastSwitchAt: number | null = null;
  private readonly telemetry = getTelemetryLogger('space-governance', 'SpaceRuntimeGovernanceService');

  activateSpace(spaceId: string): void {
    const normalized = spaceId.trim();
    if (!normalized) return;

    const now = Date.now();
    const previousActiveSpaceId = this.activeSpaceId;
    if (previousActiveSpaceId && previousActiveSpaceId !== normalized) {
      this.freezeSpace(previousActiveSpaceId);
    }

    const descriptor = this.ensureDescriptor(normalized);
    descriptor.state = 'active';
    descriptor.hasActivated = true;
    descriptor.lastActivatedAt = now;
    descriptor.lastFrozenAt = null;
    this.activeSpaceId = normalized;
    this.lastSwitchAt = previousActiveSpaceId === normalized ? this.lastSwitchAt : now;

    this.telemetry.info('space-governance.runtime.state', {
      fields: {
        spaceId: normalized,
        state: descriptor.state,
        previousActiveSpaceId,
        kind: descriptor.kind,
        memoryTier: descriptor.memoryTier,
      },
    });
  }

  warmSpace(spaceId: string): void {
    const descriptor = this.ensureDescriptor(spaceId);
    if (descriptor.state === 'active') return;
    descriptor.state = 'warming';
    this.invokeParticipantHook(spaceId, 'onWarm', {
      kind: 'system',
      ownerId: 'space-runtime-governance',
      spaceId: descriptor.spaceId,
      detail: 'space warm requested',
    });
    this.telemetry.debug('space-governance.runtime.state', {
      fields: { spaceId: descriptor.spaceId, state: descriptor.state },
    });
  }

  freezeSpace(spaceId: string): void {
    const descriptor = this.descriptors.get(spaceId.trim());
    if (!descriptor || descriptor.state === 'cold' || descriptor.state === 'frozen') return;
    descriptor.state = 'frozen';
    descriptor.lastFrozenAt = Date.now();
    this.invokeParticipantHook(spaceId, 'onFreeze', {
      kind: 'space-exit',
      spaceId: descriptor.spaceId,
      detail: 'space frozen',
    });
    if (descriptor.activeAssociationCount === 0 && descriptor.lastZeroAssociationAt === null) {
      descriptor.lastZeroAssociationAt = descriptor.lastFrozenAt;
    }
    this.telemetry.info('space-governance.runtime.state', {
      fields: {
        spaceId: descriptor.spaceId,
        state: descriptor.state,
        kind: descriptor.kind,
        memoryTier: descriptor.memoryTier,
      },
    });
  }

  teardownSpace(spaceId: string, reason: string): void {
    const descriptor = this.descriptors.get(spaceId.trim());
    if (!descriptor || descriptor.spaceId === this.activeSpaceId) return;

    descriptor.state = 'tearing_down';
    this.invokeParticipantHook(spaceId, 'onTeardown', {
      kind: 'memory-pressure',
      spaceId: descriptor.spaceId,
      detail: reason,
    });
    this.telemetry.info('space-governance.runtime.teardown', {
      fields: {
        spaceId: descriptor.spaceId,
        reason,
        kind: descriptor.kind,
        memoryTier: descriptor.memoryTier,
      },
    });

    descriptor.state = 'cold';
    descriptor.lastFrozenAt = null;
    descriptor.lastZeroAssociationAt = null;
    descriptor.activeAssociationCount = 0;
    this.associationsBySpaceId.delete(descriptor.spaceId);
  }

  registerParticipant(spaceId: string, participant: RuntimeLifecycleParticipant): () => void {
    const normalizedSpaceId = spaceId.trim();
    const normalizedParticipantId = participant.id.trim();
    if (!normalizedSpaceId || !normalizedParticipantId) return () => undefined;

    this.ensureDescriptor(normalizedSpaceId);
    let participants = this.participantsBySpaceId.get(normalizedSpaceId);
    if (!participants) {
      participants = new Map();
      this.participantsBySpaceId.set(normalizedSpaceId, participants);
    }
    participants.set(normalizedParticipantId, participant);

    this.telemetry.debug('space-governance.runtime.participant.registered', {
      fields: {
        spaceId: normalizedSpaceId,
        participantId: normalizedParticipantId,
        capsuleId: participant.capsuleId,
        participantCount: participants.size,
      },
    });

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const current = this.participantsBySpaceId.get(normalizedSpaceId);
      if (!current) return;
      const registered = current.get(normalizedParticipantId);
      if (registered !== participant) return;
      current.delete(normalizedParticipantId);
      if (current.size === 0) {
        this.participantsBySpaceId.delete(normalizedSpaceId);
      }
    };
  }

  retainSpaceAssociation(spaceId: string, resourceId: string): () => void {
    const normalizedSpaceId = spaceId.trim();
    const normalizedResourceId = resourceId.trim();
    if (!normalizedSpaceId || !normalizedResourceId) return () => undefined;

    const descriptor = this.ensureDescriptor(normalizedSpaceId);
    let associations = this.associationsBySpaceId.get(normalizedSpaceId);
    if (!associations) {
      associations = new Map();
      this.associationsBySpaceId.set(normalizedSpaceId, associations);
    }

    associations.set(normalizedResourceId, (associations.get(normalizedResourceId) ?? 0) + 1);
    descriptor.activeAssociationCount = this.countAssociations(normalizedSpaceId);
    descriptor.lastAssociatedAt = Date.now();
    descriptor.lastZeroAssociationAt = null;

    this.telemetry.debug('space-governance.runtime.association', {
      fields: {
        spaceId: descriptor.spaceId,
        resourceId: normalizedResourceId,
        activeAssociationCount: descriptor.activeAssociationCount,
      },
    });

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const current = this.associationsBySpaceId.get(normalizedSpaceId);
      if (!current) return;
      const count = current.get(normalizedResourceId) ?? 0;
      if (count <= 1) {
        current.delete(normalizedResourceId);
      } else {
        current.set(normalizedResourceId, count - 1);
      }
      if (current.size === 0) {
        this.associationsBySpaceId.delete(normalizedSpaceId);
      }

      const nextDescriptor = this.descriptors.get(normalizedSpaceId);
      if (!nextDescriptor) return;
      nextDescriptor.activeAssociationCount = this.countAssociations(normalizedSpaceId);
      if (nextDescriptor.activeAssociationCount === 0) {
        nextDescriptor.lastZeroAssociationAt = Date.now();
      }
    };
  }

  canRunBackground(spaceId: string): boolean {
    const descriptor = this.descriptors.get(spaceId.trim());
    if (!descriptor) return false;
    return descriptor.hasActivated && descriptor.state !== 'cold' && descriptor.state !== 'tearing_down';
  }

  collectSnapshot(): SpaceRuntimeGovernanceSnapshot {
    const descriptors = [...this.descriptors.values()].map((descriptor) => ({
      ...descriptor,
      participants: this.collectParticipantSnapshots(descriptor.spaceId, descriptor.state),
    }));
    return {
      activeSpaceId: this.activeSpaceId,
      descriptors,
      frozenSpaceIds: descriptors
        .filter((descriptor) => descriptor.state === 'frozen')
        .map((descriptor) => descriptor.spaceId),
      heavySpaceIds: descriptors
        .filter((descriptor) => descriptor.memoryTier === 'heavy')
        .map((descriptor) => descriptor.spaceId),
      zeroAssociationSpaceIds: descriptors
        .filter((descriptor) => descriptor.activeAssociationCount === 0)
        .map((descriptor) => descriptor.spaceId),
      reclaimableSpaceIds: this.getReclaimableDescriptors(descriptors).map(
        (descriptor) => descriptor.spaceId
      ),
      lastSwitchAt: this.lastSwitchAt,
    };
  }

  reclaim(options: { reason: string; minTier: number }): string[] {
    if (options.minTier < 1) return [];
    const reclaimed: string[] = [];
    const candidates = this.getReclaimableDescriptors([...this.descriptors.values()], {
      bypassWarmRetention: options.minTier >= 2,
    });
    for (const descriptor of candidates) {
      this.teardownSpace(descriptor.spaceId, options.reason);
      reclaimed.push(descriptor.spaceId);
    }
    return reclaimed;
  }

  private ensureDescriptor(spaceId: string): SpaceRuntimeDescriptor {
    const normalized = spaceId.trim();
    const existing = this.descriptors.get(normalized);
    if (existing) return existing;

    const classification = classifySpace(normalized);
    const descriptor: SpaceRuntimeDescriptor = {
      spaceId: normalized,
      state: 'cold',
      kind: classification.kind,
      hasActivated: false,
      lastActivatedAt: null,
      lastFrozenAt: null,
      lastAssociatedAt: null,
      lastZeroAssociationAt: null,
      activeAssociationCount: 0,
      warmRetentionMs: classification.warmRetentionMs,
      memoryTier: classification.memoryTier,
      keepWarmOnBlur: classification.keepWarmOnBlur,
      participants: [],
    };
    this.descriptors.set(normalized, descriptor);
    return descriptor;
  }

  private collectParticipantSnapshots(spaceId: string, state: SpaceRuntimeState): RuntimeParticipantSnapshot[] {
    const participants = this.participantsBySpaceId.get(spaceId);
    if (!participants || participants.size === 0) return [];

    const snapshots: RuntimeParticipantSnapshot[] = [];
    for (const participant of participants.values()) {
      try {
        const snapshot = participant.collectSnapshot?.();
        snapshots.push(
          snapshot ?? {
            id: participant.id,
            capsuleId: participant.capsuleId,
            state,
          }
        );
      } catch (error) {
        this.telemetry.warn('space-governance.runtime.participant.snapshot.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            spaceId,
            participantId: participant.id,
            capsuleId: participant.capsuleId,
          },
        });
      }
    }
    return snapshots.sort((a, b) => a.id.localeCompare(b.id));
  }

  private invokeParticipantHook(
    spaceId: string,
    hookName: 'onWarm' | 'onFreeze' | 'onTeardown' | 'onSuspend' | 'onHibernate',
    reason: RuntimeLeaseReason | RuntimePressureReason
  ): void {
    const participants = this.participantsBySpaceId.get(spaceId.trim());
    if (!participants || participants.size === 0) return;

    for (const participant of participants.values()) {
      const hook = participant[hookName];
      if (typeof hook !== 'function') continue;
      try {
        void hook(reason as never);
      } catch (error) {
        this.telemetry.warn('space-governance.runtime.participant.hook.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            spaceId,
            participantId: participant.id,
            capsuleId: participant.capsuleId,
            hookName,
            reasonKind: reason.kind,
          },
        });
      }
    }
  }

  private getReclaimableDescriptors(
    descriptors: readonly SpaceRuntimeDescriptor[],
    options: { bypassWarmRetention?: boolean } = {}
  ): SpaceRuntimeDescriptor[] {
    const now = Date.now();
    return descriptors
      .filter((descriptor) => descriptor.spaceId !== this.activeSpaceId)
      .filter((descriptor) => descriptor.state === 'frozen')
      .filter((descriptor) => descriptor.hasActivated)
      .filter((descriptor) => descriptor.activeAssociationCount === 0)
      .filter((descriptor) => descriptor.memoryTier === 'heavy' || !descriptor.keepWarmOnBlur)
      .filter((descriptor) => {
        if (options.bypassWarmRetention && descriptor.memoryTier === 'heavy') return true;
        const zeroAssociationAt = descriptor.lastZeroAssociationAt ?? descriptor.lastFrozenAt;
        if (zeroAssociationAt === null) return false;
        return now - zeroAssociationAt >= descriptor.warmRetentionMs;
      })
      .sort((a, b) => {
        const tierScore = (value: SpaceRuntimeMemoryTier) =>
          value === 'heavy' ? 2 : value === 'medium' ? 1 : 0;
        return tierScore(b.memoryTier) - tierScore(a.memoryTier);
      });
  }

  private countAssociations(spaceId: string): number {
    const associations = this.associationsBySpaceId.get(spaceId);
    if (!associations) return 0;

    let total = 0;
    for (const count of associations.values()) {
      total += Math.max(0, count);
    }
    return total;
  }
}
