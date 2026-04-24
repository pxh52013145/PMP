import { createServiceToken } from '../../kernel';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

export type SpaceRuntimeState = 'cold' | 'warming' | 'active' | 'frozen' | 'tearing_down';

export type SpaceRuntimeKind = 'default' | 'platform' | 'plugin-workspace' | 'editor-workspace';

export type SpaceRuntimeMemoryTier = 'light' | 'medium' | 'heavy';

export interface SpaceRuntimeDescriptor {
  spaceId: string;
  state: SpaceRuntimeState;
  kind: SpaceRuntimeKind;
  lastActivatedAt: number | null;
  lastFrozenAt: number | null;
  warmRetentionMs: number;
  memoryTier: SpaceRuntimeMemoryTier;
  estimatedBudgetBytes?: number;
  keepWarmOnBlur: boolean;
}

export interface SpaceRuntimeGovernanceSnapshot {
  activeSpaceId: string | null;
  descriptors: SpaceRuntimeDescriptor[];
  frozenSpaceIds: string[];
  heavySpaceIds: string[];
  reclaimableSpaceIds: string[];
  lastSwitchAt: number | null;
}

export interface SpaceRuntimeGovernanceService {
  activateSpace(spaceId: string): void;
  warmSpace(spaceId: string): void;
  freezeSpace(spaceId: string): void;
  teardownSpace(spaceId: string, reason: string): void;
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
    this.telemetry.debug('space-governance.runtime.state', {
      fields: { spaceId: descriptor.spaceId, state: descriptor.state },
    });
  }

  freezeSpace(spaceId: string): void {
    const descriptor = this.descriptors.get(spaceId.trim());
    if (!descriptor || descriptor.state === 'cold' || descriptor.state === 'frozen') return;
    descriptor.state = 'frozen';
    descriptor.lastFrozenAt = Date.now();
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
  }

  collectSnapshot(): SpaceRuntimeGovernanceSnapshot {
    const descriptors = [...this.descriptors.values()].map((descriptor) => ({ ...descriptor }));
    return {
      activeSpaceId: this.activeSpaceId,
      descriptors,
      frozenSpaceIds: descriptors
        .filter((descriptor) => descriptor.state === 'frozen')
        .map((descriptor) => descriptor.spaceId),
      heavySpaceIds: descriptors
        .filter((descriptor) => descriptor.memoryTier === 'heavy')
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
      lastActivatedAt: null,
      lastFrozenAt: null,
      warmRetentionMs: classification.warmRetentionMs,
      memoryTier: classification.memoryTier,
      keepWarmOnBlur: classification.keepWarmOnBlur,
    };
    this.descriptors.set(normalized, descriptor);
    return descriptor;
  }

  private getReclaimableDescriptors(
    descriptors: readonly SpaceRuntimeDescriptor[],
    options: { bypassWarmRetention?: boolean } = {}
  ): SpaceRuntimeDescriptor[] {
    const now = Date.now();
    return descriptors
      .filter((descriptor) => descriptor.spaceId !== this.activeSpaceId)
      .filter((descriptor) => descriptor.state === 'frozen')
      .filter((descriptor) => descriptor.memoryTier === 'heavy' || !descriptor.keepWarmOnBlur)
      .filter((descriptor) => {
        if (options.bypassWarmRetention && descriptor.memoryTier === 'heavy') return true;
        if (descriptor.lastFrozenAt === null) return true;
        return now - descriptor.lastFrozenAt >= descriptor.warmRetentionMs;
      })
      .sort((a, b) => {
        const tierScore = (value: SpaceRuntimeMemoryTier) =>
          value === 'heavy' ? 2 : value === 'medium' ? 1 : 0;
        return tierScore(b.memoryTier) - tierScore(a.memoryTier);
      });
  }
}
