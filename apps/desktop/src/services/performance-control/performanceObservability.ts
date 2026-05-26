import type { AppEvents } from '../../contracts/events';
import type { MemoryGovernanceRunResult } from '../../contracts/memoryGovernance';
import type { PerformanceControlSnapshot } from '../../contracts/performanceControl';
import type { QualitySnapshot } from '../../contracts/quality';
import type { ScopedEventBus } from '../../kernel';
import type { TelemetryLogger, TelemetryService, TelemetrySnapshot } from '../telemetry';
import type {
  ProcessPerfService,
  ProcessPerfServiceSnapshot,
} from './ProcessPerfService';

type PerformanceObservabilityBridgeDeps = {
  events: ScopedEventBus<AppEvents>;
  telemetryService: TelemetryService;
  processPerfService: ProcessPerfService;
  performanceControlSnapshot: PerformanceControlSnapshot;
  qualitySnapshot: QualitySnapshot;
};

type PerformanceTelemetryPolicy = {
  enabled: boolean;
  realtimeVerbose: boolean;
};

function readPolicy(snapshot: TelemetrySnapshot): PerformanceTelemetryPolicy {
  const modulePolicy = snapshot.policy.modules.performance;
  return {
    enabled:
      snapshot.policy.enabled && modulePolicy?.enabled !== false && modulePolicy?.perf !== false,
    realtimeVerbose: modulePolicy?.realtimeVerbose === true,
  };
}

function readGovernanceEventKey(result: MemoryGovernanceRunResult): string {
  return JSON.stringify({
    reason: result.reason,
    tier: result.plan.tier,
    executed: result.executed,
  });
}

function readSettingsKey(snapshot: PerformanceControlSnapshot): string {
  return JSON.stringify({
    runtimeProfile: snapshot.settings.runtimeProfile,
    editorLowPerformanceMode: snapshot.settings.editorLowPerformanceMode,
    gifImportMaxFps: snapshot.settings.gifImportMaxFps,
    coverMaxEdgePx: snapshot.settings.coverMaxEdgePx,
    backgroundRenderPolicy: snapshot.settings.backgroundRenderPolicy,
    memoryGovernanceAutoEnabled: snapshot.settings.memoryGovernanceAutoEnabled,
    uiQualityMode: snapshot.settings.uiQualitySettings.mode,
    uiQualityFixedLevel: snapshot.settings.uiQualitySettings.fixedLevel,
    uiQualityMinLevel: snapshot.settings.uiQualitySettings.auto.minLevel,
    uiQualityMaxLevel: snapshot.settings.uiQualitySettings.auto.maxLevel,
  });
}

function emitIfEnabled(
  logger: TelemetryLogger,
  policy: PerformanceTelemetryPolicy,
  level: 'debug' | 'info' | 'warn',
  event: string,
  fields: Record<string, unknown>
): void {
  if (!policy.enabled) return;
  logger.log(level, event, { fields });
}

export function attachPerformanceObservabilityBridge(
  deps: PerformanceObservabilityBridgeDeps
): () => void {
  const logger = deps.telemetryService.getLogger('performance', 'PerformanceObservabilityBridge');
  const initialProcessPerfSnapshot = deps.processPerfService.getSnapshot();

  let policy = readPolicy(deps.telemetryService.getSnapshot());
  let lastPressure = deps.performanceControlSnapshot.pressure;
  let lastSettingsKey = readSettingsKey(deps.performanceControlSnapshot);
  let lastQualityDecisionAt =
    deps.qualitySnapshot.lastDecision?.atMs ?? null;
  let lastGovernanceKey: string | null = null;
  let lastPerfAvailability =
    initialProcessPerfSnapshot.availability === 'ready'
      ? 'ready'
      : 'idle';
  let lastVerboseSampleAt =
    initialProcessPerfSnapshot.lastSuccessAtMs ?? null;

  const unsubscribeTelemetry = deps.telemetryService.subscribe((snapshot) => {
    policy = readPolicy(snapshot);
  });

  const unsubscribePerformanceControl = deps.events.on(
    'performance-control/changed',
    (snapshot) => {
      if (snapshot.pressure !== lastPressure) {
        emitIfEnabled(logger, policy, 'info', 'performance.pressure.changed', {
          from: lastPressure,
          to: snapshot.pressure,
          tier: snapshot.governance.tier,
          qualityLevel: snapshot.quality.level,
          webview2PrivateWorkingSetBytes:
            snapshot.webview2?.webview2PrivateWorkingSetBytes ?? null,
          webview2PrivateBytes: snapshot.webview2?.webview2PrivateBytes ?? null,
          webview2CpuPercent: snapshot.webview2?.webview2CpuPercent ?? null,
        });
        lastPressure = snapshot.pressure;
      }

      const nextSettingsKey = readSettingsKey(snapshot);
      if (nextSettingsKey !== lastSettingsKey) {
        emitIfEnabled(logger, policy, 'info', 'performance.settings.updated', {
          runtimeProfile: snapshot.settings.runtimeProfile,
          editorLowPerformanceMode: snapshot.settings.editorLowPerformanceMode,
          gifImportMaxFps: snapshot.settings.gifImportMaxFps,
          coverMaxEdgePx: snapshot.settings.coverMaxEdgePx,
          backgroundRenderPolicy: snapshot.settings.backgroundRenderPolicy,
          memoryGovernanceAutoEnabled: snapshot.settings.memoryGovernanceAutoEnabled,
          uiQualityMode: snapshot.settings.uiQualitySettings.mode,
          uiQualityFixedLevel: snapshot.settings.uiQualitySettings.fixedLevel,
          uiQualityMinLevel: snapshot.settings.uiQualitySettings.auto.minLevel,
          uiQualityMaxLevel: snapshot.settings.uiQualitySettings.auto.maxLevel,
        });
        lastSettingsKey = nextSettingsKey;
      }
    }
  );

  const unsubscribeQuality = deps.events.on('quality/changed', (snapshot) => {
    const nextDecisionAt = snapshot.lastDecision?.atMs ?? null;
    if (!snapshot.lastDecision || nextDecisionAt === null || nextDecisionAt === lastQualityDecisionAt) {
      return;
    }
    lastQualityDecisionAt = nextDecisionAt;
    emitIfEnabled(logger, policy, 'info', 'performance.quality.decision', {
      from: snapshot.lastDecision.from,
      to: snapshot.lastDecision.to,
      reason: snapshot.lastDecision.reason.kind,
      detail: 'detail' in snapshot.lastDecision.reason ? snapshot.lastDecision.reason.detail ?? null : null,
      qualityLevel: snapshot.effective.level,
      renderScale: snapshot.effective.renderScale,
      fpsForeground: snapshot.effective.fpsForeground,
      fpsBackground: snapshot.effective.fpsBackground,
      lastMemoryTier: snapshot.telemetry?.lastMemoryTier ?? null,
    });
  });

  const unsubscribeGovernance = deps.events.on('memory-governance/ran', (result) => {
    const nextKey = readGovernanceEventKey(result);
    if (nextKey === lastGovernanceKey) {
      return;
    }
    if (lastGovernanceKey !== null || result.executed.length > 0 || result.plan.tier > 0) {
      emitIfEnabled(logger, policy, 'info', 'performance.memory-governance.executed', {
        reason: result.reason,
        tier: result.plan.tier,
        executed: result.executed,
        webview2PrivateWorkingSetBytes:
          result.snapshot.webview2?.webview2PrivateWorkingSetBytes ?? null,
        webview2PrivateBytes: result.snapshot.webview2?.webview2PrivateBytes ?? null,
        webview2CpuPercent: result.snapshot.webview2?.webview2CpuPercent ?? null,
      });
    }
    lastGovernanceKey = nextKey;
  });

  const unsubscribeProcessPerf = deps.processPerfService.subscribe(
    (snapshot: ProcessPerfServiceSnapshot) => {
      const nextAvailability = snapshot.availability;
      if (
        nextAvailability !== lastPerfAvailability &&
        (nextAvailability !== 'idle' || lastPerfAvailability !== 'idle')
      ) {
        if (nextAvailability === 'ready') {
          emitIfEnabled(logger, policy, 'info', 'performance.process-snapshot.recovered', {
            previousStatus: lastPerfAvailability,
            status: nextAvailability,
            samplingMs: snapshot.policy.samplingMs,
            detailLevel: snapshot.detailLevel,
          });
        } else {
          emitIfEnabled(logger, policy, 'warn', 'performance.process-snapshot.unavailable', {
            previousStatus: lastPerfAvailability,
            status: nextAvailability,
            samplingMs: snapshot.policy.samplingMs,
            detailLevel: snapshot.detailLevel,
            reason: snapshot.lastError,
          });
        }
        lastPerfAvailability = nextAvailability;
      }

      const nextSampleAt = snapshot.lastSuccessAtMs;
      if (
        policy.enabled &&
        policy.realtimeVerbose &&
        snapshot.availability === 'ready' &&
        nextSampleAt !== null &&
        nextSampleAt !== lastVerboseSampleAt
      ) {
        logger.debug('performance.process-snapshot.sampled', {
          fields: {
            samplingMs: snapshot.policy.samplingMs,
            detailLevel: snapshot.detailLevel,
            webview2PrivateWorkingSetBytes:
              snapshot.totalsSnapshot?.totals.webview2PrivateWorkingSetBytes ?? null,
            webview2PrivateBytes: snapshot.totalsSnapshot?.totals.webview2PrivateBytes ?? null,
            webview2CpuPercent: snapshot.totalsSnapshot?.totals.webview2CpuPercent ?? null,
            treePrivateWorkingSetBytes:
              snapshot.totalsSnapshot?.totals.privateWorkingSetBytes ?? null,
            treePrivateBytes: snapshot.totalsSnapshot?.totals.privateBytes ?? null,
            systemMemoryLoadPercent:
              snapshot.totalsSnapshot?.systemMemory?.memoryLoadPercent ?? null,
          },
        });
      }
      if (nextSampleAt !== null) {
        lastVerboseSampleAt = nextSampleAt;
      }
    }
  );

  return () => {
    unsubscribeProcessPerf();
    unsubscribeGovernance();
    unsubscribeQuality();
    unsubscribePerformanceControl();
    unsubscribeTelemetry();
  };
}
