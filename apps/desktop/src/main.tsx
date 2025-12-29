import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EditorWindowApp } from './EditorWindowApp';
import { PluginWindowApp } from './PluginWindowApp';
import { VstManagerWindowApp } from './VstManagerWindowApp';
import { KernelProvider } from './contexts/KernelContext';
import { isTauriRuntime } from './utils/tauriRuntime';
import './index.css';

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

// 根据 URL 判断渲染哪个应用
const hash = window.location.hash;
const isEditorWindow = hash.startsWith('#/editor/');
const isPluginWindow = hash.startsWith('#/plugin-window/');
const isVstManagerWindow = hash.startsWith('#/vst-manager');

const RootApp = isEditorWindow
  ? EditorWindowApp
  : isPluginWindow
    ? PluginWindowApp
    : isVstManagerWindow
      ? VstManagerWindowApp
      : App;

async function bootstrap(): Promise<void> {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <KernelProvider>
        <StartupReadyGate>
          <RootApp />
        </StartupReadyGate>
      </KernelProvider>
    </React.StrictMode>
  );

  if (RootApp !== App || !isTauriRuntime()) return;

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
  });
}

void bootstrap();
