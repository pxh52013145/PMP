import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { flushStorageWrites } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  APP_LIFECYCLE_SERVICE_TOKEN,
  DefaultAppLifecycleService,
  type LifecycleFlushReason,
} from './LifecycleService';

export function createLifecycleModule(): KernelModule<AppEvents> {
  return {
    id: 'lifecycle',
    activate: ({ services }) => {
      const service = new DefaultAppLifecycleService();
      const unregister = services.register(APP_LIFECYCLE_SERVICE_TOKEN, service);

      service.registerFlushHandler(() => flushStorageWrites());

      if (typeof window === 'undefined') {
        return () => unregister();
      }

      const flush = (reason: LifecycleFlushReason) => {
        service.flush(reason);
      };

      const onBeforeUnload = () => flush('beforeunload');
      const onPageHide = () => flush('pagehide');
      const onVisibilityChange = () => {
        if (document.hidden) flush('visibility-hidden');
      };

      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('visibilitychange', onVisibilityChange);

      let unlistenMainHidden: null | (() => void) = null;
      let unlistenEditorHidden: null | (() => void) = null;

      if (isTauriRuntime()) {
        void import('@tauri-apps/api/event')
          .then(({ listen }) =>
            Promise.all([
              listen('main-window-hidden', () => flush('tauri-window-hidden')),
              listen('editor-window-hidden', () => flush('tauri-window-hidden')),
            ])
          )
          .then(([mainHidden, editorHidden]) => {
            unlistenMainHidden = mainHidden;
            unlistenEditorHidden = editorHidden;
          })
          .catch(() => {
            // best-effort
          });
      }

      return () => {
        flush('kernel-deactivate');
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        try {
          unlistenMainHidden?.();
        } catch {
          // ignore
        }
        try {
          unlistenEditorHidden?.();
        } catch {
          // ignore
        }
        unregister();
      };
    },
  };
}

