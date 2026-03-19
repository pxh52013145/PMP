import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { flushStorageWrites, usePersistentSetting } from '../modules/storage';
import { useT } from '../i18n';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { broadcastSignal, setupTauriListener, STORAGE_KEYS, TAURI_EVENTS } from '../utils/windowCommunication';
import { ExitDialog } from '../components/core/ExitDialog';

export type MainWindowCloseSource = 'magnet' | 'system';
export type MainWindowCloseBehavior = 'ask' | 'hide' | 'exit';

type WindowCloseContextValue = {
  requestMainWindowClose: (source: MainWindowCloseSource) => void;
};

const WindowCloseContext = createContext<WindowCloseContextValue | undefined>(undefined);

function normalizeBehavior(value: unknown, fallback: MainWindowCloseBehavior): MainWindowCloseBehavior {
  if (value === 'ask' || value === 'hide' || value === 'exit') return value;
  return fallback;
}

export function WindowCloseProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const isTauri = isTauriRuntime();
  const telemetry = useMemo(() => getTelemetryLogger('windowing', 'WindowCloseContext'), []);

  const [magnetBehaviorRaw] = usePersistentSetting<string>(STORAGE_KEYS.MAIN_WINDOW_CLOSE_BEHAVIOR_MAGNET, 'ask', {
    format: 'string',
  });
  const [systemBehaviorRaw] = usePersistentSetting<string>(STORAGE_KEYS.MAIN_WINDOW_CLOSE_BEHAVIOR_SYSTEM, 'hide', {
    format: 'string',
  });

  const magnetBehavior = useMemo(
    () => normalizeBehavior(magnetBehaviorRaw, 'ask'),
    [magnetBehaviorRaw]
  );
  const systemBehavior = useMemo(
    () => normalizeBehavior(systemBehaviorRaw, 'hide'),
    [systemBehaviorRaw]
  );

  const [promptSource, setPromptSource] = useState<MainWindowCloseSource | null>(null);
  const [busy, setBusy] = useState(false);

  const hideToTray = useCallback(async () => {
    if (!isTauri) return;
    flushStorageWrites();
    try {
      await appWindow.hide();
    } catch {
      // best-effort
    }
    await broadcastSignal(TAURI_EVENTS.MAIN_WINDOW_HIDDEN);
    telemetry.info('window.main.hide.completed');
  }, [isTauri, telemetry]);

  const requestExit = useCallback(async () => {
    if (!isTauri) return;
    flushStorageWrites();
    telemetry.info('window.main.exit.requested');
    await invokeWithTelemetry('app_request_exit', undefined, {
      moduleId: 'windowing',
      component: 'windowClose',
      event: 'window.main.request-exit',
      successLevel: 'info',
    });
  }, [isTauri, telemetry]);

  const applyBehavior = useCallback(
    async (behavior: MainWindowCloseBehavior) => {
      if (behavior === 'hide') {
        await hideToTray();
        return;
      }
      if (behavior === 'exit') {
        await requestExit();
      }
    },
    [hideToTray, requestExit]
  );

  const requestMainWindowClose = useCallback(
    (source: MainWindowCloseSource) => {
      if (!isTauri) return;

      const behavior = source === 'magnet' ? magnetBehavior : systemBehavior;
      if (behavior === 'ask') {
        telemetry.info('window.main.close.prompt-opened', {
          fields: {
            source,
          },
        });
        setPromptSource(source);
        return;
      }

      if (busy) return;
      setBusy(true);
      void applyBehavior(behavior).finally(() => setBusy(false));
    },
    [applyBehavior, busy, isTauri, magnetBehavior, systemBehavior, telemetry]
  );

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    const setup = async () => {
      const unlisten = await setupTauriListener(TAURI_EVENTS.MAIN_WINDOW_CLOSE_REQUESTED, () => {
        if (disposed) return;
        requestMainWindowClose('system');
      });
      return unlisten;
    };

    const cleanupPromise = setup();
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri, requestMainWindowClose]);

  const dialogTitle = t('windowClose.dialog.title');
  const dialogMessage =
    promptSource === 'system' ? t('windowClose.dialog.message.system') : t('windowClose.dialog.message.magnet');

  return (
    <WindowCloseContext.Provider value={{ requestMainWindowClose }}>
      {children}
      <ExitDialog
        open={promptSource !== null}
        title={dialogTitle}
        message={dialogMessage}
        cancelText={t('common.action.cancel')}
        hideText={t('windowClose.action.hide')}
        exitText={t('windowClose.action.exit')}
        onCancel={() => setPromptSource(null)}
        onHide={() => {
          if (busy) return;
          setPromptSource(null);
          setBusy(true);
          void hideToTray().finally(() => setBusy(false));
        }}
        onExit={() => {
          if (busy) return;
          setPromptSource(null);
          setBusy(true);
          void requestExit().finally(() => setBusy(false));
        }}
      />
    </WindowCloseContext.Provider>
  );
}

export function useWindowClose(): WindowCloseContextValue {
  const ctx = useContext(WindowCloseContext);
  if (!ctx) {
    throw new Error('useWindowClose must be used within a WindowCloseProvider');
  }
  return ctx;
}

