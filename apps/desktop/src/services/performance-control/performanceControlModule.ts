import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../audio';
import { TELEMETRY_SERVICE_TOKEN, type TelemetryService } from '../telemetry';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../runtime-capsules';
import {
  DefaultProcessPerfService,
  PROCESS_PERF_SERVICE_TOKEN,
  setGlobalProcessPerfService,
} from './ProcessPerfService';
import {
  DefaultPerformanceControlService,
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
} from './PerformanceControlService';
import {
  DEBUG_PROCESS_PERF_CAPABILITY_ID,
  registerProcessPerfRuntimeCapsuleParticipant,
} from './processPerfRuntimeCapsule';
import { onStartupIdle } from '../../modules/startup/startupReady';

const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS = 5_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_THROTTLE = 12_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_PAUSE = 20_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_COLD_IDLE = 45_000;
const PERFORMANCE_CONTROL_STARTUP_FIRST_REFRESH_DELAY_MS = 5_000;

function resolveRefreshIntervalMs(
  renderMode: 'full' | 'throttle' | 'pause',
  visible: boolean,
  coldIdle: boolean,
  debugProcessPerfActive: boolean
): number {
  if (debugProcessPerfActive) {
    if (!visible || renderMode === 'pause') return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_PAUSE;
    if (renderMode === 'throttle') return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_THROTTLE;
    return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS;
  }

  if (coldIdle) {
    return visible ? PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_COLD_IDLE : PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_PAUSE;
  }
  if (!visible || renderMode === 'pause') return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_PAUSE;
  if (renderMode === 'throttle') return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_THROTTLE;
  return PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS;
}

export function createPerformanceControlModule(): KernelModule<AppEvents> {
  return {
    id: 'performance-control',
    activate: ({ services, events }) => {
      const telemetryService = services.get(TELEMETRY_SERVICE_TOKEN) as TelemetryService;
      const processPerfService = new DefaultProcessPerfService(telemetryService);
      setGlobalProcessPerfService(processPerfService);
      const unregisterProcessPerf = services.register(
        PROCESS_PERF_SERVICE_TOKEN,
        processPerfService
      );
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;

      const service = new DefaultPerformanceControlService(events, processPerfService);
      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);
      const unregister = services.register(PERFORMANCE_CONTROL_SERVICE_TOKEN, service);

      const unsubscribeQuality = events.on('quality/changed', (snapshot) => {
        service.applyQualitySnapshot(snapshot);
      });

      const unsubscribeGovernance = events.on('memory-governance/ran', (result) => {
        service.applyGovernanceSnapshot(result);
      });

      service.refreshSettingsFromStorage();

      let timer: number | null = null;
      let activeIntervalMs = PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS;
      let teardown: null | (() => void) = null;
      let cleanupStartupFirstRefresh: null | (() => void) = null;
      let onVisibilityOrFocusChanged: (() => void) | null = null;
      let unsubscribeAudioState: null | (() => void) = null;
      let unsubscribeRuntimeCapsules: null | (() => void) = null;
      let unregisterProcessPerfParticipant: null | (() => void) = null;
      let runtimeCapsuleSnapshot = runtimeCapsuleManager?.collectSnapshot() ?? null;
      let disposed = false;
      if (typeof window !== 'undefined') {
        const isColdIdleAudioState = (): boolean => {
          if (!audioEngine) return false;
          try {
            const state = audioEngine.getSnapshot().audioService.getState();
            return (
              state.queue.length === 0 &&
              state.currentTrack == null &&
              (state.playbackState === 'idle' ||
                state.playbackState === 'stopped' ||
              state.playbackState === 'error')
            );
          } catch {
            return false;
          }
        };

        const isDebugProcessPerfActive = (): boolean => {
          if (!runtimeCapsuleSnapshot) return false;
          return runtimeCapsuleSnapshot.capsules.some((capsule) => {
            if (!capsule.activeLeases.length) return false;
            return capsule.manifest.provides?.includes(DEBUG_PROCESS_PERF_CAPABILITY_ID) ?? false;
          });
        };

        const getRuntimeActivity = () => {
          const isVisible = !document.hidden;
          const isFocused = document.hasFocus();
          const policy = service.getSettingsSnapshot().backgroundRenderPolicy;
          const renderMode: 'full' | 'throttle' | 'pause' =
            isVisible && isFocused ? 'full' : policy === 'pause' ? 'pause' : policy;
          const coldIdle = isColdIdleAudioState();
          const debugProcessPerfActive = isDebugProcessPerfActive();
          return { isVisible, renderMode, coldIdle, debugProcessPerfActive };
        };

        const applyInterval = () => {
          if (disposed) return;
          const { isVisible, renderMode, coldIdle, debugProcessPerfActive } = getRuntimeActivity();
          const nextIntervalMs = resolveRefreshIntervalMs(
            renderMode,
            isVisible,
            coldIdle,
            debugProcessPerfActive
          );
          if (timer !== null && nextIntervalMs === activeIntervalMs) {
            return;
          }
          if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
          }
          activeIntervalMs = nextIntervalMs;
          timer = window.setInterval(() => {
            void service.refreshNow();
          }, activeIntervalMs);
        };

        onVisibilityOrFocusChanged = () => {
          applyInterval();
          void service.refreshNow();
        };

        if (runtimeCapsuleManager) {
          unsubscribeRuntimeCapsules = runtimeCapsuleManager.subscribe((snapshot) => {
            runtimeCapsuleSnapshot = snapshot;
            applyInterval();
          });

          unregisterProcessPerfParticipant = registerProcessPerfRuntimeCapsuleParticipant({
            runtimeCapsuleManager,
            processPerfService,
            onRuntimeActivityChanged: applyInterval,
            refreshNow: () => {
              void service.refreshNow();
            },
          });
        }

        void setupDualListener(
          [
            STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
            STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
            STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS,
            STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
            STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
            STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
            STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
          ],
          [
            TAURI_EVENTS.EDITOR_LOW_PERFORMANCE_MODE_UPDATED,
            TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED,
            TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED,
          ],
          () => {
            service.refreshSettingsFromStorage();
            applyInterval();
          }
        ).then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          teardown = fn;
        });

        document.addEventListener('visibilitychange', onVisibilityOrFocusChanged);
        window.addEventListener('focus', onVisibilityOrFocusChanged);
        window.addEventListener('blur', onVisibilityOrFocusChanged);
        unsubscribeAudioState = events.on('audio/stateChanged', () => {
          applyInterval();
        });

        applyInterval();
        cleanupStartupFirstRefresh = onStartupIdle(
          () => {
            if (disposed) return;
            void service.refreshNow();
          },
          {
            delayMs: PERFORMANCE_CONTROL_STARTUP_FIRST_REFRESH_DELAY_MS,
            timeoutMs: 2_500,
          }
        );
      }

      return () => {
        disposed = true;
        cleanupStartupFirstRefresh?.();
        try {
          teardown?.();
        } catch {
          // ignore
        }
        if (timer !== null && typeof window !== 'undefined') {
          window.clearInterval(timer);
        }
        if (typeof window !== 'undefined') {
          if (onVisibilityOrFocusChanged) {
            document.removeEventListener('visibilitychange', onVisibilityOrFocusChanged);
            window.removeEventListener('focus', onVisibilityOrFocusChanged);
            window.removeEventListener('blur', onVisibilityOrFocusChanged);
          }
        }
        unsubscribeAudioState?.();
        unsubscribeRuntimeCapsules?.();
        unregisterProcessPerfParticipant?.();
        unsubscribeGovernance();
        unsubscribeQuality();
        setGlobalProcessPerfService(null);
        processPerfService.destroy();
        unregisterProcessPerf();
        unregister();
      };
    },
  };
}
