import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { APP_LIFECYCLE_SERVICE_TOKEN, type AppLifecycleService } from '../lifecycle';
import { NAVIGATION_SERVICE_TOKEN } from '../navigation';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED,
  MEMORY_GOVERNANCE_INTERVAL_MS,
  MEMORY_GOVERNANCE_PLAYBACK_INTERVAL_MS,
  type MemoryGovernanceRequest,
  type MemoryGovernanceReason,
} from '../../contracts/memoryGovernance';
import {
  DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  parsePerformanceRuntimeProfile,
  resolvePerformanceRuntimePresetSettings,
} from '../../contracts/performanceControl';
import { readJson } from '../../modules/storage';
import { PMP_STORAGE_CHANGE_EVENT, type PmpStorageChangeDetail } from '../../modules/storage/localStorage';
import {
  DefaultMemoryGovernanceService,
  MEMORY_GOVERNANCE_SERVICE_TOKEN,
  type MemoryGovernanceService,
} from './MemoryGovernanceService';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../audio';
import { getRegisteredMusicLibraryService } from '../audio/MusicLibraryServiceRegistry';
import {
  attachPerformanceObservabilityBridge,
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
  PROCESS_PERF_SERVICE_TOKEN,
  type PerformanceControlService,
  type ProcessPerfService,
} from '../performance-control';
import { QUALITY_SERVICE_TOKEN, type QualityService } from '../quality';
import { TELEMETRY_SERVICE_TOKEN, type TelemetryService } from '../telemetry';
import {
  SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN,
  type SpaceRuntimeGovernanceService,
} from './SpaceRuntimeGovernanceService';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../runtime-capsules';
import { onStartupIdle } from '../../modules/startup/startupReady';
import type { LifecycleFlushReason } from '../lifecycle/LifecycleService';

const MEMORY_GOVERNANCE_STARTUP_FIRST_RUN_DELAY_MS = 15_000;
const MEMORY_GOVERNANCE_REQUEST_DEFAULT_DELAYS_MS = [900] as const;
const MEMORY_GOVERNANCE_REQUEST_DEFAULT_MIN_INTERVAL_MS = 2_500;

function readEnabledSetting(): boolean {
  try {
    const runtimeProfile = parsePerformanceRuntimeProfile(
      readJson<unknown>(
        STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
        DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
      ),
      DEFAULT_PERFORMANCE_CONTROL_SETTINGS.runtimeProfile
    );

    const fallbackEnabled =
      runtimeProfile === 'custom'
        ? DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED
        : resolvePerformanceRuntimePresetSettings(runtimeProfile).memoryGovernanceAutoEnabled;

    return readJson<boolean>(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, fallbackEnabled);
  } catch {
    return DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED;
  }
}

function normalizeRequestDelays(delaysMs?: readonly number[]): number[] {
  const source =
    Array.isArray(delaysMs) && delaysMs.length > 0
      ? delaysMs
      : MEMORY_GOVERNANCE_REQUEST_DEFAULT_DELAYS_MS;
  return [...new Set(source)]
    .map((value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0))
    .sort((left, right) => left - right);
}

function resolveAuxWindowHiddenReason(
  reason: LifecycleFlushReason
): MemoryGovernanceReason | null {
  switch (reason) {
    case 'tauri-editor-window-hidden':
      return 'editor-window-hidden';
    case 'tauri-plugin-window-hidden':
    case 'tauri-plugin-shell-surface-hidden':
      return 'plugin-window-hidden';
    case 'tauri-vst-manager-window-hidden':
      return 'vst-manager-window-hidden';
    default:
      return null;
  }
}

export function createMemoryGovernanceModule(): KernelModule<AppEvents> {
  return {
    id: 'memory-governance',
    activate: ({ services, events }) => {
      const telemetry = getTelemetryLogger('memory-governance', 'memoryGovernanceModule');
      const navigation = services.get(NAVIGATION_SERVICE_TOKEN);
      const lifecycle = services.get(APP_LIFECYCLE_SERVICE_TOKEN) as AppLifecycleService;
      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);
      const processPerfService = services.get(PROCESS_PERF_SERVICE_TOKEN) as ProcessPerfService;
      const performanceControlService = services.get(
        PERFORMANCE_CONTROL_SERVICE_TOKEN
      ) as PerformanceControlService;
      const qualityService = services.get(QUALITY_SERVICE_TOKEN) as QualityService;
      const telemetryService = services.get(TELEMETRY_SERVICE_TOKEN) as TelemetryService;
      const spaceRuntimeGovernance = services.getOptional(
        SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN
      ) as SpaceRuntimeGovernanceService | null;
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;

      const service: MemoryGovernanceService = new DefaultMemoryGovernanceService(
        navigation,
        events,
        processPerfService,
        spaceRuntimeGovernance,
        runtimeCapsuleManager,
        getRegisteredMusicLibraryService
      );
      const unregister = services.register(MEMORY_GOVERNANCE_SERVICE_TOKEN, service);
      const detachPerformanceObservability = attachPerformanceObservabilityBridge({
        events,
        telemetryService,
        processPerfService,
        performanceControlSnapshot: performanceControlService.getSnapshot(),
        qualitySnapshot: qualityService.getSnapshot(),
      });

      if (typeof window === 'undefined') {
        return () => unregister();
      }

      let enabled = readEnabledSetting();
      let timer: number | null = null;
      let playbackTimer: number | null = null;
      let cleanupStartupFirstRun: (() => void) | null = null;
      let lastRequestedRunAtMs = 0;
      const requestTimers = new Set<number>();

      const cancelStartupFirstRun = () => {
        cleanupStartupFirstRun?.();
        cleanupStartupFirstRun = null;
      };

      const stopPlaybackWatch = () => {
        if (playbackTimer === null) return;
        window.clearInterval(playbackTimer);
        playbackTimer = null;
      };

      const clearRequestTimers = () => {
        for (const requestTimer of requestTimers) {
          window.clearTimeout(requestTimer);
        }
        requestTimers.clear();
      };

      const runRequestedGovernance = (request: MemoryGovernanceRequest) => {
        if (!enabled) return;

        const minIntervalMs =
          typeof request.minIntervalMs === 'number' && Number.isFinite(request.minIntervalMs)
            ? Math.max(0, Math.floor(request.minIntervalMs))
            : MEMORY_GOVERNANCE_REQUEST_DEFAULT_MIN_INTERVAL_MS;
        const now = Date.now();
        const elapsedMs = now - lastRequestedRunAtMs;
        if (lastRequestedRunAtMs > 0 && elapsedMs < minIntervalMs) {
          const retryTimer = window.setTimeout(() => {
            requestTimers.delete(retryTimer);
            runRequestedGovernance(request);
          }, minIntervalMs - elapsedMs);
          requestTimers.add(retryTimer);
          return;
        }

        lastRequestedRunAtMs = now;
        telemetry.debug('memory-governance.request.run', {
          fields: {
            reason: request.reason,
            source: request.source,
          },
        });
        void service.runOnce(request.reason);
      };

      const scheduleRequestedGovernance = (request: MemoryGovernanceRequest) => {
        if (!enabled) return;

        const delaysMs = normalizeRequestDelays(request.delaysMs);
        telemetry.debug('memory-governance.request.scheduled', {
          fields: {
            reason: request.reason,
            source: request.source,
            delaysMs,
          },
        });

        for (const delayMs of delaysMs) {
          const requestTimer = window.setTimeout(() => {
            requestTimers.delete(requestTimer);
            runRequestedGovernance(request);
          }, delayMs);
          requestTimers.add(requestTimer);
        }
      };

      const startPlaybackWatch = () => {
        if (!audioEngine) return;
        if (playbackTimer !== null) return;
        playbackTimer = window.setInterval(() => {
          try {
            const state = audioEngine.getSnapshot().audioService.getState();
            if (state.playbackState !== 'playing') return;

            const hidden = typeof document !== 'undefined' ? document.hidden : false;
            const bufferedAhead =
              typeof state.bufferedAhead === 'number' && Number.isFinite(state.bufferedAhead)
                ? state.bufferedAhead
                : 0;

            // Avoid fighting playback path too often while foreground is healthy;
            // run aggressively when hidden or rebuffer risk appears.
            if (!hidden && bufferedAhead >= 0.8) return;

            void service.runOnce('playback-active');
          } catch {
            // best-effort
          }
        }, MEMORY_GOVERNANCE_PLAYBACK_INTERVAL_MS);
      };

      const start = () => {
        if (timer !== null) return;
        timer = window.setInterval(() => {
          void service.runOnce('interval');
        }, MEMORY_GOVERNANCE_INTERVAL_MS);
      };

      const scheduleStartupFirstRun = () => {
        cancelStartupFirstRun();
        cleanupStartupFirstRun = onStartupIdle(
          () => {
            cleanupStartupFirstRun = null;
            if (!enabled) return;
            void service.runOnce('interval');
          },
          {
            delayMs: MEMORY_GOVERNANCE_STARTUP_FIRST_RUN_DELAY_MS,
            timeoutMs: 3_000,
          }
        );
      };

      const stop = () => {
        if (timer === null) return;
        window.clearInterval(timer);
        timer = null;
      };

      const syncEnabled = (next: boolean, reason: MemoryGovernanceReason) => {
        enabled = next;
        telemetry.info('memory-governance.auto.enabled-changed', {
          fields: {
            enabled,
            reason,
          },
        });
        if (enabled) {
          start();
          startPlaybackWatch();
          cancelStartupFirstRun();
          void service.runOnce(reason);
        } else {
          cancelStartupFirstRun();
          stop();
          stopPlaybackWatch();
          clearRequestTimers();
        }
      };

      if (enabled) {
        start();
        startPlaybackWatch();
        scheduleStartupFirstRun();
      }

      const unregisterFlush = lifecycle.registerFlushHandler((reason) => {
        if (reason === 'visibility-hidden') {
          try {
            service.runOnce('visibility-hidden').catch(() => {});
          } catch {
            // best-effort
          }
          return;
        }

        const auxWindowHiddenReason = resolveAuxWindowHiddenReason(reason);
        if (auxWindowHiddenReason) {
          scheduleRequestedGovernance({
            reason: auxWindowHiddenReason,
            source: reason,
            delaysMs: [1_200],
            minIntervalMs: 2_500,
          });
          return;
        }

        if (!enabled) return;
        if (
          reason === 'beforeunload' ||
          reason === 'pagehide' ||
          reason === 'tauri-main-window-hidden' ||
          reason === 'tauri-window-hidden'
        ) {
          void service.runOnce(
            reason === 'tauri-main-window-hidden' ? 'tauri-main-window-hidden' : reason
          );
        }
      });

      const unsubscribeMemoryGovernanceRequests = events.on(
        'memory-governance/requested',
        (request) => {
          scheduleRequestedGovernance(request);
        }
      );

      const onStorageChange = (event: Event) => {
        const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
        if (!detail || detail.key !== STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED) return;
        syncEnabled(readEnabledSetting(), 'manual');
      };
      window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);

      return () => {
        cancelStartupFirstRun();
        clearRequestTimers();
        stop();
        stopPlaybackWatch();
        try {
          unregisterFlush();
        } catch {
          // ignore
        }
        detachPerformanceObservability();
        unsubscribeMemoryGovernanceRequests();
        window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);
        unregister();
      };
    },
  };
}
