import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { APP_LIFECYCLE_SERVICE_TOKEN, type AppLifecycleService } from '../lifecycle';
import { DefaultQualityService, QUALITY_SERVICE_TOKEN, type QualityService } from './QualityService';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

export function createQualityModule(): KernelModule<AppEvents> {
  return {
    id: 'quality',
    activate: ({ services, events }) => {
      const lifecycle = services.get(APP_LIFECYCLE_SERVICE_TOKEN) as AppLifecycleService;
      const service: QualityService = new DefaultQualityService(events);
      const unregister = services.register(QUALITY_SERVICE_TOKEN, service);

      const flushUnregister = lifecycle.registerFlushHandler(() => {
        try {
          service.refreshSettingsFromStorage();
        } catch {
          // ignore
        }
      });

      if (typeof window === 'undefined') {
        return () => {
          flushUnregister();
          unregister();
        };
      }

      let teardown: null | (() => void) = null;
      let disposed = false;

      void setupDualListener(
        [STORAGE_KEYS.UI_QUALITY_SETTINGS_V1],
        [TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED],
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

      const unsubscribeMemory = events.on('memory-governance/ran', (result) => {
        const tier = result.plan.tier;
        service.setLastMemoryTier(tier);
      });

      return () => {
        disposed = true;
        try {
          teardown?.();
        } catch {
          // ignore
        }
        unsubscribeMemory();
        flushUnregister();
        unregister();
      };
    },
  };
}
