import React from 'react';
import ReactDOM from 'react-dom/client';
import { KernelProvider } from './contexts/KernelContext';
import { I18nSync, readPersistedLocale, setLocale } from './i18n';
import { isTauriRuntime } from './utils/tauriRuntime';
import { readString } from './modules/storage';
import { STORAGE_KEYS } from './utils/windowCommunication';
import { bootstrapPerformanceRuntimeProfileStorage } from './modules/startup/performanceRuntimeBootstrap';
import './index.css';

setLocale(readPersistedLocale());
bootstrapPerformanceRuntimeProfileStorage();

function runAfterNextPaint(task: () => void): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      task();
    });
  });
}

function scheduleIdle(
  task: () => void | Promise<void>,
  options: { timeoutMs?: number; delayMs?: number } = {}
): void {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const delayMs = options.delayMs ?? 0;

  const run = () => {
    const requestIdleCallback = (window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;

    const exec = () => {
      void Promise.resolve()
        .then(() => task())
        .catch((error) => {
          console.warn('[startup] idle task failed:', error);
        });
    };

    if (requestIdleCallback) {
      requestIdleCallback(exec, { timeout: timeoutMs });
      return;
    }

    window.setTimeout(exec, Math.min(timeoutMs, 800));
  };

  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
  } else {
    run();
  }
}

function StartupReadyGate({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const overlay = document.getElementById('pmp-startup-overlay');
    if (!overlay) return;

    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 120ms ease-out';

    const timer = window.setTimeout(() => {
      overlay.remove();
    }, 140);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return <>{children}</>;
}

function shouldRunStartupBackgroundMigration(): boolean {
  const migrationState = readString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1);
  return migrationState !== 'done';
}

type RootAppResolveResult = {
  component: React.ComponentType;
  kind: 'main' | 'editor' | 'plugin' | 'vst-manager';
};

async function resolveRootAppByHash(hash: string): Promise<RootAppResolveResult> {
  if (hash.startsWith('#/editor/')) {
    const mod = await import('./EditorWindowApp');
    return { component: mod.EditorWindowApp, kind: 'editor' };
  }

  if (hash.startsWith('#/plugin-window/')) {
    const mod = await import('./PluginWindowApp');
    return { component: mod.PluginWindowApp, kind: 'plugin' };
  }

  if (hash.startsWith('#/vst-manager')) {
    const mod = await import('./VstManagerWindowApp');
    return { component: mod.VstManagerWindowApp, kind: 'vst-manager' };
  }

  const mod = await import('./App');
  return { component: mod.default, kind: 'main' };
}

async function bootstrap(): Promise<void> {
  const rootApp = await resolveRootAppByHash(window.location.hash);
  const RootApp = rootApp.component;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nSync />
      <KernelProvider>
        <StartupReadyGate>
          <RootApp />
        </StartupReadyGate>
      </KernelProvider>
    </React.StrictMode>
  );

  if (rootApp.kind !== 'main' || !isTauriRuntime()) return;

  // Avoid blocking first paint (dev cold-start is dominated by Vite transform anyway).
  runAfterNextPaint(() => {
    scheduleIdle(
      async () => {
        try {
          const { restoreBackgroundSnapshots } = await import('./modules/background/backgroundSnapshot');
          await restoreBackgroundSnapshots({ restoreHistory: false });
        } catch (error) {
          console.warn('[background] restore snapshots failed:', error);
        }
      },
      { timeoutMs: 2_000 }
    );

    // History is only needed for the background manager; restore it later.
    scheduleIdle(
      async () => {
        try {
          const { restoreBackgroundSnapshots } = await import('./modules/background/backgroundSnapshot');
          await restoreBackgroundSnapshots({ restoreSettings: false, restoreHistory: true });
        } catch (error) {
          console.warn('[background] restore history snapshot failed:', error);
        }
      },
      { timeoutMs: 4_000, delayMs: 2_500 }
    );

    if (shouldRunStartupBackgroundMigration()) {
      // Migration may touch filesystem and copy media; delay it to avoid fighting initial UI/Pixi.
      scheduleIdle(
        async () => {
          try {
            const { migrateBackgroundStorageToManagedMedia } = await import(
              './modules/background/backgroundMediaMigration'
            );
            await migrateBackgroundStorageToManagedMedia();
          } catch (error) {
            console.warn('[background] migration failed:', error);
          }
        },
        { timeoutMs: 8_000, delayMs: 4_000 }
      );
    }
  });
}

void bootstrap();

