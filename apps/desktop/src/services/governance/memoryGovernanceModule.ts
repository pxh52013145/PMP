import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { APP_LIFECYCLE_SERVICE_TOKEN, type AppLifecycleService } from '../lifecycle';
import { NAVIGATION_SERVICE_TOKEN } from '../navigation';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED,
  MEMORY_GOVERNANCE_INTERVAL_MS,
  MEMORY_GOVERNANCE_PLAYBACK_INTERVAL_MS,
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
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../audio';

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

export function createMemoryGovernanceModule(): KernelModule<AppEvents> {
  return {
    id: 'memory-governance',
    activate: ({ services, events }) => {
      const navigation = services.get(NAVIGATION_SERVICE_TOKEN);
      const lifecycle = services.get(APP_LIFECYCLE_SERVICE_TOKEN) as AppLifecycleService;
      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);

      const service: MemoryGovernanceService = new DefaultMemoryGovernanceService(navigation, events);
      const unregister = services.register(MEMORY_GOVERNANCE_SERVICE_TOKEN, service);

      if (typeof window === 'undefined') {
        return () => unregister();
      }

      let enabled = readEnabledSetting();
      let timer: number | null = null;
      let playbackTimer: number | null = null;

      const stopPlaybackWatch = () => {
        if (playbackTimer === null) return;
        window.clearInterval(playbackTimer);
        playbackTimer = null;
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

      const stop = () => {
        if (timer === null) return;
        window.clearInterval(timer);
        timer = null;
      };

      const syncEnabled = (next: boolean, reason: MemoryGovernanceReason) => {
        enabled = next;
        if (enabled) {
          start();
          startPlaybackWatch();
          void service.runOnce(reason);
        } else {
          stop();
          stopPlaybackWatch();
        }
      };

      if (enabled) {
        start();
        startPlaybackWatch();
        void service.runOnce('interval');
      }

      const unregisterFlush = lifecycle.registerFlushHandler((reason) => {
        if (reason === 'visibility-hidden') {
          try {
            service.runOnce('visibility-hidden').catch(() => {});
          } catch {
            // best-effort
          }
        }

        if (!enabled) return;
        if (
          reason === 'beforeunload' ||
          reason === 'pagehide' ||
          reason === 'visibility-hidden' ||
          reason === 'tauri-window-hidden'
        ) {
          void service.runOnce(reason);
        }
      });

      const onStorageChange = (event: Event) => {
        const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
        if (!detail || detail.key !== STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED) return;
        syncEnabled(readEnabledSetting(), 'manual');
      };
      window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);

      return () => {
        stop();
        stopPlaybackWatch();
        try {
          unregisterFlush();
        } catch {
          // ignore
        }
        window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);
        unregister();
      };
    },
  };
}
