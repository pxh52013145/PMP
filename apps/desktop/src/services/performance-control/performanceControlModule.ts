import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../audio';
import {
  DefaultPerformanceControlService,
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
} from './PerformanceControlService';

const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS = 5_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_THROTTLE = 12_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_PAUSE = 20_000;
const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS_COLD_IDLE = 45_000;

function resolveRefreshIntervalMs(
  renderMode: 'full' | 'throttle' | 'pause',
  visible: boolean,
  coldIdle: boolean
): number {
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
      const service = new DefaultPerformanceControlService(events);
      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);
      const unregister = services.register(PERFORMANCE_CONTROL_SERVICE_TOKEN, service);

      const unsubscribeQuality = events.on('quality/changed', (snapshot) => {
        service.applyQualitySnapshot(snapshot);
      });

      const unsubscribeGovernance = events.on('memory-governance/ran', (result) => {
        service.applyGovernanceSnapshot(result);
      });

      service.refreshSettingsFromStorage();
      void service.refreshNow();

      let timer: number | null = null;
      let activeIntervalMs = PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS;
      let teardown: null | (() => void) = null;
      let onVisibilityOrFocusChanged: (() => void) | null = null;
      let unsubscribeAudioState: null | (() => void) = null;
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

        const getRuntimeActivity = () => {
          const isVisible = !document.hidden;
          const isFocused = document.hasFocus();
          const policy = service.getSettingsSnapshot().backgroundRenderPolicy;
          const renderMode: 'full' | 'throttle' | 'pause' =
            isVisible && isFocused ? 'full' : policy === 'pause' ? 'pause' : policy;
          const coldIdle = isColdIdleAudioState();
          return { isVisible, renderMode, coldIdle };
        };

        const applyInterval = () => {
          if (disposed) return;
          const { isVisible, renderMode, coldIdle } = getRuntimeActivity();
          const nextIntervalMs = resolveRefreshIntervalMs(renderMode, isVisible, coldIdle);
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
      }

      return () => {
        disposed = true;
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
        unsubscribeGovernance();
        unsubscribeQuality();
        unregister();
      };
    },
  };
}
