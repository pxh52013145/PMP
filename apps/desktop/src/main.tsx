import React from 'react';
import ReactDOM from 'react-dom/client';
import { KernelProvider } from './contexts/KernelContext';
import { I18nSync, readPersistedLocale, setLocale } from './i18n';
import { installConsoleBridge } from './services/telemetry/consoleBridge';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import { isTauriRuntime } from './utils/tauriRuntime';
import { bootstrapPerformanceRuntimeProfileStorage } from './modules/startup/performanceRuntimeBootstrap';
import './index.css';
import './themes/surfaceMotion.css';

installConsoleBridge();
const startupTelemetry = getTelemetryLogger('startup', 'main');

function applyRuntimePlatformDataset(): void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;

  try {
    const ua = navigator.userAgent || '';
    const root = document.documentElement;

    if (/windows/i.test(ua)) {
      root.dataset.pmpPlatform = 'windows';
      return;
    }

    if (/macintosh|mac os/i.test(ua)) {
      root.dataset.pmpPlatform = 'mac';
      return;
    }

    if (/linux/i.test(ua)) {
      root.dataset.pmpPlatform = 'linux';
    }
  } catch {
    // best-effort
  }
}

applyRuntimePlatformDataset();

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
          startupTelemetry.warn('startup.idle-task.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
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
    startupTelemetry.info('startup.root.rendered');
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

type RootAppResolveResult = {
  component: React.ComponentType;
  kind:
    | 'main'
    | 'editor'
    | 'plugin'
    | 'plugin-shell-surface'
    | 'vst-manager'
    | 'desktop-lyrics-overlay';
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

  if (hash.startsWith('#/plugin-shell-surface/')) {
    const mod = await import('./PluginShellSurfaceApp');
    return { component: mod.PluginShellSurfaceApp, kind: 'plugin-shell-surface' };
  }

  if (hash.startsWith('#/vst-manager')) {
    const mod = await import('./VstManagerWindowApp');
    return { component: mod.VstManagerWindowApp, kind: 'vst-manager' };
  }

  if (hash.startsWith('#/desktop-lyrics-overlay')) {
    const mod = await import('./DesktopLyricsOverlayApp');
    return { component: mod.DesktopLyricsOverlayApp, kind: 'desktop-lyrics-overlay' };
  }

  const mod = await import('./App');
  return { component: mod.default, kind: 'main' };
}

async function bootstrap(): Promise<void> {
  startupTelemetry.info('startup.bootstrap.begin');
  const rootApp = await resolveRootAppByHash(window.location.hash);
  startupTelemetry.info('startup.root.resolved', {
    fields: {
      kind: rootApp.kind,
    },
  });
  const RootApp = rootApp.component;
  const rootContent = (
    <StartupReadyGate>
      <RootApp />
    </StartupReadyGate>
  );

  const appContent =
    rootApp.kind === 'desktop-lyrics-overlay' ? rootContent : <KernelProvider>{rootContent}</KernelProvider>;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nSync />
      {appContent}
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
          startupTelemetry.warn('startup.background.restore-settings.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
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
          startupTelemetry.warn('startup.background.restore-history.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      { timeoutMs: 4_000, delayMs: 2_500 }
    );

  });
}

void bootstrap();

