export const UTILS_TELEMETRY_SCHEMA_VERSION = 'utils.telemetry.v1' as const;
export const UTILS_PRODUCT_ID = 'utils' as const;

export const UTILS_RUNTIME_HEALTH_STATES = [
  'healthy',
  'degraded',
  'unavailable',
] as const;

export type UtilsRuntimeHealthState = (typeof UTILS_RUNTIME_HEALTH_STATES)[number];

export const UTILS_ADAPTER_KINDS = ['core', 'pmp', 'standalone', 'mock'] as const;

export type UtilsAdapterKind = (typeof UTILS_ADAPTER_KINDS)[number];

export const UTILS_SURFACE_KINDS = [
  'hud',
  'overlay',
  'widget',
  'control-center',
  'diagnostics',
  'command',
  'unknown',
] as const;

export type UtilsSurfaceKind = (typeof UTILS_SURFACE_KINDS)[number];

export const UTILS_SURFACE_LIFECYCLE_STATES = [
  'mount-start',
  'mounted',
  'visible',
  'hidden',
  'dismissed',
  'disposed',
  'failed',
] as const;

export type UtilsSurfaceLifecycleState =
  (typeof UTILS_SURFACE_LIFECYCLE_STATES)[number];

export const UTILS_DEGRADED_REASON_CODES = [
  'startup-slow',
  'bridge-latency-high',
  'idle-overhead-high',
  'crash-threshold',
  'surface-failure',
  'adapter-unavailable',
  'telemetry-unavailable',
  'capability-unavailable',
  'runtime-unresponsive',
  'unknown',
] as const;

export type UtilsDegradedReasonCode = (typeof UTILS_DEGRADED_REASON_CODES)[number];

export const UTILS_FAILURE_KINDS = [
  'startup-timeout',
  'bridge-timeout',
  'crash',
  'unresponsive',
  'capability-denied',
  'surface-failed',
  'unknown',
] as const;

export type UtilsFailureKind = (typeof UTILS_FAILURE_KINDS)[number];

export const UTILS_TELEMETRY_EVENT_NAMES = {
  runtimeStartup: 'plugin.utils.runtime.startup',
  bridgeLatency: 'plugin.utils.bridge.latency',
  runtimeFailure: 'plugin.utils.runtime.failure',
  surfaceLifecycle: 'plugin.utils.surface.lifecycle',
  runtimeHealth: 'performance.utils.runtime.health',
  performanceSnapshot: 'performance.utils.runtime.snapshot',
  degraded: 'performance.utils.runtime.degraded',
} as const;

export type UtilsTelemetryEventName =
  (typeof UTILS_TELEMETRY_EVENT_NAMES)[keyof typeof UTILS_TELEMETRY_EVENT_NAMES];

export type UtilsTelemetryLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

export type UtilsTelemetryKind = 'log' | 'metric' | 'span-start' | 'span-end';

export type UtilsTelemetryScalar = string | number | boolean | null;

export type UtilsTelemetryFields = Record<
  string,
  UtilsTelemetryScalar | UtilsTelemetryScalar[] | Record<string, UtilsTelemetryScalar>
>;

export type UtilsRuntimeGovernanceThresholds = {
  startupWarningMs: number;
  bridgeLatencyWarningMs: number;
  idleOverheadWarningPercent: number;
  crashDegradedThreshold: number;
  crashUnavailableThreshold: number;
};

export const DEFAULT_UTILS_RUNTIME_GOVERNANCE_THRESHOLDS: UtilsRuntimeGovernanceThresholds = {
  startupWarningMs: 1_500,
  bridgeLatencyWarningMs: 250,
  idleOverheadWarningPercent: 4,
  crashDegradedThreshold: 1,
  crashUnavailableThreshold: 3,
};

export type UtilsRuntimeGovernanceInput = {
  availability?: 'available' | 'degraded' | 'unavailable' | null;
  startupTimeMs?: number | null;
  bridgeLatencyMs?: number | null;
  crashCount?: number | null;
  idleOverheadPercent?: number | null;
  surfaceFailureCount?: number | null;
  runtimeUnresponsive?: boolean | null;
  telemetryAvailable?: boolean | null;
  capabilityAvailable?: boolean | null;
  degradedReasonCodes?: readonly UtilsDegradedReasonCode[] | null;
};

export type UtilsRuntimeGovernanceSnapshot = {
  schemaVersion: typeof UTILS_TELEMETRY_SCHEMA_VERSION;
  productId: typeof UTILS_PRODUCT_ID;
  health: UtilsRuntimeHealthState;
  degradedReasonCodes: UtilsDegradedReasonCode[];
  metrics: {
    startupTimeMs: number | null;
    bridgeLatencyMs: number | null;
    crashCount: number;
    idleOverheadPercent: number | null;
    surfaceFailureCount: number;
  };
  thresholds: UtilsRuntimeGovernanceThresholds;
};

export type UtilsSurfaceLifecycleSnapshot = {
  surfaceKind: UtilsSurfaceKind;
  state: UtilsSurfaceLifecycleState;
  activeSurfaceCount?: number | null;
  transitionDurationMs?: number | null;
};

export type UtilsActionableFailure = {
  failureKind: UtilsFailureKind;
  actionCode:
    | 'restart-runtime'
    | 'fallback-webview'
    | 'revoke-capability'
    | 'reduce-refresh'
    | 'disable-surface'
    | 'inspect-telemetry'
    | 'none';
  retryable: boolean;
};

export type UtilsTelemetryEvent = {
  schemaVersion: typeof UTILS_TELEMETRY_SCHEMA_VERSION;
  productId: typeof UTILS_PRODUCT_ID;
  event: UtilsTelemetryEventName | string;
  level: UtilsTelemetryLevel;
  kind: UtilsTelemetryKind;
  adapterKind: UtilsAdapterKind;
  runtimeId?: string | null;
  surfaceKind?: UtilsSurfaceKind | null;
  health?: UtilsRuntimeHealthState | null;
  message?: string | null;
  fields?: UtilsTelemetryFields;
};

export type UtilsTelemetrySink = {
  sinkKind: 'pmp' | 'local' | 'mock';
  log: (event: UtilsTelemetryEvent) => void | Promise<void>;
  flush?: () => void | Promise<void>;
};

function asNonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function asNonNegativeInteger(value: number | null | undefined): number {
  const normalized = asNonNegativeNumber(value);
  return normalized === null ? 0 : Math.floor(normalized);
}

function addReason(
  reasons: Set<UtilsDegradedReasonCode>,
  reason: UtilsDegradedReasonCode,
  active: boolean
): void {
  if (active) {
    reasons.add(reason);
  }
}

export function resolveUtilsRuntimeGovernanceSnapshot(
  input: UtilsRuntimeGovernanceInput,
  thresholds: Partial<UtilsRuntimeGovernanceThresholds> = {}
): UtilsRuntimeGovernanceSnapshot {
  const resolvedThresholds: UtilsRuntimeGovernanceThresholds = {
    ...DEFAULT_UTILS_RUNTIME_GOVERNANCE_THRESHOLDS,
    ...thresholds,
  };
  const startupTimeMs = asNonNegativeNumber(input.startupTimeMs);
  const bridgeLatencyMs = asNonNegativeNumber(input.bridgeLatencyMs);
  const idleOverheadPercent = asNonNegativeNumber(input.idleOverheadPercent);
  const crashCount = asNonNegativeInteger(input.crashCount);
  const surfaceFailureCount = asNonNegativeInteger(input.surfaceFailureCount);
  const reasons = new Set<UtilsDegradedReasonCode>(input.degradedReasonCodes ?? []);

  addReason(
    reasons,
    'startup-slow',
    startupTimeMs !== null && startupTimeMs >= resolvedThresholds.startupWarningMs
  );
  addReason(
    reasons,
    'bridge-latency-high',
    bridgeLatencyMs !== null && bridgeLatencyMs >= resolvedThresholds.bridgeLatencyWarningMs
  );
  addReason(
    reasons,
    'idle-overhead-high',
    idleOverheadPercent !== null &&
      idleOverheadPercent >= resolvedThresholds.idleOverheadWarningPercent
  );
  addReason(
    reasons,
    'crash-threshold',
    crashCount >= resolvedThresholds.crashDegradedThreshold
  );
  addReason(reasons, 'surface-failure', surfaceFailureCount > 0);
  addReason(reasons, 'adapter-unavailable', input.availability === 'unavailable');
  addReason(reasons, 'runtime-unresponsive', input.runtimeUnresponsive === true);
  addReason(reasons, 'telemetry-unavailable', input.telemetryAvailable === false);
  addReason(reasons, 'capability-unavailable', input.capabilityAvailable === false);

  const health: UtilsRuntimeHealthState =
    input.availability === 'unavailable' ||
    input.runtimeUnresponsive === true ||
    crashCount >= resolvedThresholds.crashUnavailableThreshold
      ? 'unavailable'
      : input.availability === 'degraded' || reasons.size > 0
        ? 'degraded'
        : 'healthy';

  return {
    schemaVersion: UTILS_TELEMETRY_SCHEMA_VERSION,
    productId: UTILS_PRODUCT_ID,
    health,
    degradedReasonCodes: Array.from(reasons.values()).sort((left, right) =>
      left.localeCompare(right)
    ),
    metrics: {
      startupTimeMs,
      bridgeLatencyMs,
      crashCount,
      idleOverheadPercent,
      surfaceFailureCount,
    },
    thresholds: resolvedThresholds,
  };
}

export function createUtilsTelemetryEvent(
  event: Omit<UtilsTelemetryEvent, 'schemaVersion' | 'productId' | 'kind'> & {
    kind?: UtilsTelemetryKind;
  }
): UtilsTelemetryEvent {
  return {
    ...event,
    schemaVersion: UTILS_TELEMETRY_SCHEMA_VERSION,
    productId: UTILS_PRODUCT_ID,
    kind: event.kind ?? 'log',
  };
}
