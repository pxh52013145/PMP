import {
  UTILS_TELEMETRY_EVENT_NAMES,
  createUtilsTelemetryEvent,
  resolveUtilsRuntimeGovernanceSnapshot,
  type UtilsTelemetrySink,
} from './utilsTelemetry';

export const utilsTelemetryGovernanceContractCheck = resolveUtilsRuntimeGovernanceSnapshot({
  availability: 'degraded',
  startupTimeMs: 1_700,
  bridgeLatencyMs: 310,
  crashCount: 1,
  idleOverheadPercent: 5,
  telemetryAvailable: true,
});

export const utilsTelemetryEventContractCheck = createUtilsTelemetryEvent({
  event: UTILS_TELEMETRY_EVENT_NAMES.performanceSnapshot,
  level: 'warn',
  kind: 'metric',
  adapterKind: 'standalone',
  runtimeId: 'standalone.main',
  surfaceKind: 'hud',
  health: utilsTelemetryGovernanceContractCheck.health,
  fields: {
    startupTimeMs: utilsTelemetryGovernanceContractCheck.metrics.startupTimeMs,
    bridgeLatencyMs: utilsTelemetryGovernanceContractCheck.metrics.bridgeLatencyMs,
    crashCount: utilsTelemetryGovernanceContractCheck.metrics.crashCount,
    idleOverheadPercent: utilsTelemetryGovernanceContractCheck.metrics.idleOverheadPercent,
    degradedReasonCodes: utilsTelemetryGovernanceContractCheck.degradedReasonCodes,
  },
});

export const utilsLocalSinkContractCheck = {
  sinkKind: 'local',
  log: (_event) => undefined,
  flush: () => undefined,
} satisfies UtilsTelemetrySink;
