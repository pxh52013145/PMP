import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { APP_LIFECYCLE_SERVICE_TOKEN, type AppLifecycleService } from '../lifecycle';
import { attachConsoleBridge } from './consoleBridge';
import {
  DefaultTelemetryService,
  setGlobalTelemetryService,
  TELEMETRY_SERVICE_TOKEN,
} from './TelemetryService';
import { attachTauriInvokeTelemetry } from './tauriInvokeTelemetry';

export function createTelemetryModule(): KernelModule<AppEvents> {
  return {
    id: 'telemetry',
    activate: ({ services }) => {
      const lifecycle = services.get(APP_LIFECYCLE_SERVICE_TOKEN) as AppLifecycleService;
      const service = new DefaultTelemetryService();
      setGlobalTelemetryService(service);
      const unregister = services.register(TELEMETRY_SERVICE_TOKEN, service);
      const detachConsoleBridge = attachConsoleBridge(service);
      const detachInvokeTelemetry = attachTauriInvokeTelemetry(service);

      const unregisterFlush = lifecycle.registerFlushHandler(() => {
        void service.flushNow();
      });

      void service.refreshRuntime();

      return () => {
        try {
          unregisterFlush();
        } catch {
          // ignore
        }
        detachInvokeTelemetry();
        detachConsoleBridge();
        setGlobalTelemetryService(null);
        void service.flushNow();
        service.destroy();
        unregister();
      };
    },
  };
}
