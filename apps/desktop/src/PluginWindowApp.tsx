import { appWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useState } from 'react';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { ResolvedPluginWindowHost } from './magnet-system/plugins/ResolvedPluginHosts';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { isTauriRuntime } from './utils/tauriRuntime';
import { useAdaptiveRenderMode } from './contexts/useAdaptiveRenderMode';
import { QualityProvider } from './contexts/QualityContext';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from './utils/windowCommunication';
import { usePerformanceControlSettings } from './contexts/usePerformanceControlSettings';
import type { PluginSurfaceSourceKind } from './contracts/pluginSurfaceSource';
import './PluginWindowApp.css';

const telemetry = getTelemetryLogger('windowing', 'PluginWindowApp');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePluginWindowHash():
  | { eventSourceKind: PluginSurfaceSourceKind; pluginId: string; windowId: string }
  | null {
  const hash = window.location.hash;
  const kindedMatch = hash.match(/^#\/plugin-window\/(pmpm|extv2)\/([\w-]+)\/([\w-]+)$/);
  if (kindedMatch) {
    return {
      eventSourceKind: kindedMatch[1] as PluginSurfaceSourceKind,
      pluginId: kindedMatch[2],
      windowId: kindedMatch[3],
    };
  }

  const legacyMatch = hash.match(/^#\/plugin-window\/([\w-]+)\/([\w-]+)$/);
  if (!legacyMatch) return null;
  return {
    eventSourceKind: 'extv2',
    pluginId: legacyMatch[1],
    windowId: legacyMatch[2],
  };
}

export function PluginWindowApp() {
  const parsed = useMemo(() => parsePluginWindowHash(), []);
  const expectedPayload = parsed
    ? `${parsed.eventSourceKind}/${parsed.pluginId}/${parsed.windowId}`
    : null;
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { settings: performanceSettings } = usePerformanceControlSettings();

  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isPageFrozen, setIsPageFrozen] = useState(false);

  const isWindowActive = isWindowVisible && isDocumentVisible && !isWindowMinimized && !isPageFrozen && isWindowFocused;

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const onFreeze = () => setIsPageFrozen(true);
    const onResume = () => setIsPageFrozen(false);

    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    return () => {
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let blurTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    const applyFocus = (focused: boolean) => {
      if (blurTimer !== null) {
        window.clearTimeout(blurTimer);
        blurTimer = null;
      }

      if (focused) {
        setIsWindowFocused(true);
        return;
      }

      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (!disposed) setIsWindowFocused(false);
      }, 160);
    };

    const setup = async () => {
      if (isTauri) {
        try {
          const initialFocused = await appWindow.isFocused().catch(() => document.hasFocus());
          applyFocus(initialFocused);
          unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
            applyFocus(focused);
          });
          return;
        } catch (error) {
          telemetry.warn('plugin_window.focus_subscription.failed', {
            message: readErrorMessage(error),
          });
        }
      }

      const onFocus = () => applyFocus(true);
      const onBlur = () => applyFocus(false);
      applyFocus(document.hasFocus());
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      unlisten = () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    };

    void setup();

    return () => {
      disposed = true;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      if (unlisten) unlisten();
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlistenResize: (() => void) | null = null;
    let pollTimer: number | null = null;
    let lastMinimized: boolean | null = null;

    const refresh = async () => {
      try {
        const minimized = await appWindow.isMinimized();
        if (disposed) return;
        if (lastMinimized === minimized) return;
        lastMinimized = minimized;
        setIsWindowMinimized(minimized);
      } catch {
        // ignore
      }
    };

    const setup = async () => {
      await refresh();

      pollTimer = window.setInterval(() => {
        if (document.hidden || !document.hasFocus()) {
          void refresh();
        }
      }, 2000);

      try {
        unlistenResize = await appWindow.onResized(() => {
          void refresh();
        });
      } catch {
        // ignore
      }
    };

    void setup();

    return () => {
      disposed = true;
      if (unlistenResize) unlistenResize();
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlistenHidden: (() => void) | null = null;
    let unlistenShown: (() => void) | null = null;

    const setup = async () => {
      try {
        setIsWindowVisible(await appWindow.isVisible());
      } catch {
        // ignore
      }

      if (!expectedPayload) return () => {};

      unlistenHidden = await setupTauriListenerWithPayload<string>(TAURI_EVENTS.PLUGIN_WINDOW_HIDDEN, (payload) => {
        if (payload === expectedPayload) setIsWindowVisible(false);
      });
      unlistenShown = await setupTauriListenerWithPayload<string>(TAURI_EVENTS.PLUGIN_WINDOW_SHOWN, (payload) => {
        if (payload === expectedPayload) setIsWindowVisible(true);
      });

      return () => {
        unlistenHidden?.();
        unlistenShown?.();
      };
    };

    const cleanupPromise = setup();
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => {
        if (!disposed) return;
        cleanup();
      });
    };
  }, [expectedPayload, isTauri]);

  const renderMode = useAdaptiveRenderMode({
    isWindowVisible,
    isDocumentVisible,
    isWindowFocused,
    isWindowMinimized,
    isPageFrozen,
    backgroundRenderPolicy: performanceSettings.backgroundRenderPolicy,
  });

  if (!parsed) {
    return (
      <div className="plugin-window-root">
        <div className="plugin-window-error">Invalid plugin window route.</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <NavigationProvider>
          <WindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive, renderMode }}>
            <QualityProvider>
              <div className="plugin-window-root">
                <ResolvedPluginWindowHost
                  pluginId={parsed.pluginId}
                  windowId={parsed.windowId}
                />
              </div>
            </QualityProvider>
          </WindowActivityProvider>
        </NavigationProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
