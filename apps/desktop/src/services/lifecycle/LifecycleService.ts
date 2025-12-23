import { createServiceToken } from '../../kernel';

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

  registerFlushHandler(handler: FlushHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  flush(reason: LifecycleFlushReason): void {
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(reason);
      } catch (error) {
        console.warn('[lifecycle] flush handler failed', error);
      }
    }
  }
}

