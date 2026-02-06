import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  DefaultPerformanceControlService,
  PERFORMANCE_CONTROL_SERVICE_TOKEN,
} from './PerformanceControlService';

const PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS = 5_000;

export function createPerformanceControlModule(): KernelModule<AppEvents> {
  return {
    id: 'performance-control',
    activate: ({ services, events }) => {
      const service = new DefaultPerformanceControlService(events);
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
      let teardown: null | (() => void) = null;
      let disposed = false;
      if (typeof window !== 'undefined') {
        void setupDualListener(
          [
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
          }
        ).then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          teardown = fn;
        });

        timer = window.setInterval(() => {
          void service.refreshNow();
        }, PERFORMANCE_CONTROL_REFRESH_INTERVAL_MS);
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
        unsubscribeGovernance();
        unsubscribeQuality();
        unregister();
      };
    },
  };
}
