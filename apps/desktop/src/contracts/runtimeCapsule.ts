export type RuntimeCapabilityId = string;

export type RuntimeCapsuleState =
  | 'cold'
  | 'resolving'
  | 'warming'
  | 'active'
  | 'idle-warm'
  | 'suspended'
  | 'frozen'
  | 'hibernated'
  | 'tearing_down'
  | 'faulted';

export type RuntimeCapsuleKind =
  | 'core'
  | 'audio'
  | 'music-library'
  | 'visualizer'
  | 'platform'
  | 'plugin'
  | 'editor'
  | 'debug'
  | 'ornaments'
  | 'tool';

export type RuntimeCapsuleMemoryTier = 'light' | 'medium' | 'heavy';

export type RuntimeCapsuleStartupPolicy = 'core' | 'active-space' | 'first-use' | 'manual';

export type RuntimeCapsuleBackgroundPolicy =
  | 'never'
  | 'while-visible'
  | 'while-active'
  | 'pinned'
  | 'realtime-critical';

export type RuntimeLeaseActivation = 'visible' | 'interaction' | 'first-use' | 'manual';

export type RuntimeLeaseBackgroundPolicy = 'never' | 'visible-only' | 'pinned' | 'critical';

export type RuntimeRestorePriority = 'instant' | 'fast' | 'lazy';

export type RuntimeLeaseOwnerKind =
  | 'magnet'
  | 'route'
  | 'window'
  | 'command'
  | 'plugin'
  | 'debug'
  | 'system';

export type RuntimeLeasePriority = 'background' | 'normal' | 'foreground' | 'critical';

export type RuntimePressureReasonKind =
  | 'startup'
  | 'space-exit'
  | 'window-hidden'
  | 'window-backgrounded'
  | 'memory-pressure'
  | 'game-mode'
  | 'idle-timeout'
  | 'lease-expired'
  | 'manual'
  | 'shutdown';

export interface RuntimeCapsuleBudget {
  jsHeapSoftBytes?: number;
  jsHeapHardBytes?: number;
  webviewPrivateSoftBytes?: number;
  nativePrivateSoftBytes?: number;
  maxTimers?: number;
  maxListeners?: number;
  maxBlobUrls?: number;
  maxDecodedImageBytes?: number;
}

export interface RuntimeCapsuleManifest {
  id: string;
  kind: RuntimeCapsuleKind;
  memoryTier: RuntimeCapsuleMemoryTier;
  startup: RuntimeCapsuleStartupPolicy;
  backgroundPolicy: RuntimeCapsuleBackgroundPolicy;
  warmRetentionMs: number;
  hibernateAfterMs: number;
  dependencies?: string[];
  provides?: RuntimeCapabilityId[];
  requires?: RuntimeCapabilityId[];
  budget?: RuntimeCapsuleBudget;
}

export interface RuntimeLeaseReason {
  kind: RuntimeLeaseOwnerKind;
  ownerId: string;
  capabilityId?: RuntimeCapabilityId;
  spaceId?: string;
  routeId?: string;
  detail?: string;
}

export interface RuntimePressureReason {
  kind: RuntimePressureReasonKind;
  sourceId?: string;
  spaceId?: string;
  detail?: string;
  pressureLevel?: 'normal' | 'watch' | 'high';
}

export interface RuntimeLease {
  id: string;
  capsuleId: string;
  capabilityId?: RuntimeCapabilityId;
  ownerKind: RuntimeLeaseOwnerKind;
  ownerId: string;
  reason: RuntimeLeaseReason;
  priority: RuntimeLeasePriority;
  acquiredAtMs: number;
  lastRenewedAtMs?: number;
  expiresAtMs?: number;
}

export interface RuntimeCapsuleTransition {
  from: RuntimeCapsuleState;
  to: RuntimeCapsuleState;
  reason: RuntimeLeaseReason | RuntimePressureReason;
  atMs: number;
}

export interface RuntimeCapsuleSnapshot {
  manifest: RuntimeCapsuleManifest;
  state: RuntimeCapsuleState;
  activeLeases: RuntimeLease[];
  lastTransition: RuntimeCapsuleTransition | null;
  lastActiveAtMs: number | null;
  lastSuspendedAtMs: number | null;
  lastFault?: {
    message: string;
    atMs: number;
  };
}

export interface RuntimeParticipantSnapshot {
  id: string;
  capsuleId: string;
  state: RuntimeCapsuleState;
  timers?: number;
  listeners?: number;
  blobUrls?: number;
  decodedImageBytes?: number;
  estimatedJsHeapBytes?: number;
  detail?: Record<string, unknown>;
}

export interface RuntimeLifecycleParticipant {
  id: string;
  capsuleId: string;
  onWarm?(reason: RuntimeLeaseReason): Promise<void> | void;
  onSuspend?(reason: RuntimePressureReason): Promise<void> | void;
  onFreeze?(reason: RuntimePressureReason): Promise<void> | void;
  onHibernate?(reason: RuntimePressureReason): Promise<void> | void;
  onTeardown?(reason: RuntimePressureReason): Promise<void> | void;
  collectSnapshot?(): RuntimeParticipantSnapshot;
}
