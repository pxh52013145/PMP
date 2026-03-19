import { createServiceToken } from '../../kernel';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

export type LifecycleFlushReason =
  | 'beforeunload'
  | 'pagehide'
  | 'visibility-hidden'
  | 'tauri-window-hidden'
  | 'kernel-deactivate';

export type FlushHandler = (reason: LifecycleFlushReason) => void;

export interface AppLifecycleService {
  registerFlushHandler(handler: FlushHandler): () => void;
  flush(reason: LifecycleFlushReason): void;
}

export const APP_LIFECYCLE_SERVICE_TOKEN = createServiceToken<AppLifecycleService>(
  'AppLifecycleService'
);

export class DefaultAppLifecycleService implements AppLifecycleService {
  private readonly handlers = new Set<FlushHandler>();
  private readonly telemetry = getTelemetryLogger('lifecycle', 'LifecycleService');

  registerFlushHandler(handler: FlushHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  flush(reason: LifecycleFlushReason): void {
    this.telemetry.info('lifecycle.flush', {
      fields: {
        reason,
        handlerCount: this.handlers.size,
      },
    });
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(reason);
      } catch (error) {
        this.telemetry.warn('lifecycle.flush-handler.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            reason,
          },
        });
      }
    }
  }
}

