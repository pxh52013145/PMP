export {
  ensureDebugConfig,
  getDebugConfig,
  getDebugEnvSnapshot,
  getDefaultDebugConfig,
  reloadApp,
  restartApp,
  getRecentGitCommits,
  setDebugConfig,
  type DebugConfig,
  type DebugEnvSnapshot,
  type DebugVstBridgeConfig,
  type RecentGitCommit,
  type VstSidechainModeOverride,
} from './debugConfig';

export {
  ensureProcessPerfSnapshot,
  ensureProcessPerfTotalsSnapshot,
  ensureProcessWorkingSetTrimResult,
  getProcessPerfSnapshot,
  getProcessPerfTotalsSnapshot,
  ProcessPerfRequestError,
  requestProcessPerfSnapshot,
  requestProcessPerfTotalsSnapshot,
  trimProcessWorkingSet,
  type ProcessPerfKind,
  type ProcessPerfRow,
  type ProcessPerfRequestErrorCode,
  type ProcessPerfSnapshot,
  type ProcessPerfTotalsSnapshot,
  type ProcessPerfTotals,
  type ProcessWorkingSetTrimResult,
  type ProcessWorkingSetTrimTarget,
  type SystemMemorySnapshot,
} from './processPerf';

export {
  clearTelemetrySession,
  exportTelemetryBundle,
  getRecentTelemetryRecords,
  getTelemetryStatus,
  ingestTelemetryBatch,
  queryTelemetryCurrentSession,
  readCurrentTelemetrySession,
  type TelemetryReadSessionResult,
} from './telemetry';

export {
  buildMagnetTelemetryAiQuery,
  getRegisteredMagnetTelemetryIds,
  matchesMagnetTelemetryRecord,
  resolveMagnetTelemetryProfile,
  summarizeTelemetryRecords,
  type MagnetTelemetryProfile,
  type MagnetTelemetryProfileSource,
  type TelemetryRecordSummary,
} from './magnetTelemetry';

