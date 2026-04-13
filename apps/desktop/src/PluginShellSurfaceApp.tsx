import { appWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { QualityProvider } from './contexts/QualityContext';
import { useAdaptiveRenderMode } from './contexts/useAdaptiveRenderMode';
import { usePerformanceControlSettings } from './contexts/usePerformanceControlSettings';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import { isTauriRuntime } from './utils/tauriRuntime';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from './utils/windowCommunication';
import { ResolvedPluginShellSurfaceHost } from './magnet-system/plugins/ResolvedPluginHosts';
import {
  getInstalledExtensionsRevision,
  subscribeInstalledExtensions,
} from './magnet-system/plugins/extensions';
import { readPluginShellSurfaceDescriptor } from './magnet-system/plugins/shellSurfaceDescriptors';
import {
  buildPluginShellSurfaceEventPayload,
  dismissPluginShellSurface,
} from './utils/pluginShellSurfaces';
import './PluginShellSurfaceApp.css';

const telemetry = getTelemetryLogger('windowing', 'PluginShellSurfaceApp');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePluginShellSurfaceHash():
  | {
      surfaceType: 'overlay' | 'desktop-widget';
      pluginId: string;
      surfaceId: string;
    }
  | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/plugin-shell-surface\/extv2\/(overlay|desktop-widget)\/([\w-]+)\/([\w-]+)$/);
  if (!match) return null;

  return {
    surfaceType: match[1] as 'overlay' | 'desktop-widget',
    pluginId: match[2],
    surfaceId: match[3],
  };
}

export function PluginShellSurfaceApp() {
  const parsed = useMemo(() => parsePluginShellSurfaceHash(), []);
  const expectedPayload = parsed
    ? buildPluginShellSurfaceEventPayload(
        'extv2',
        parsed.surfaceType,
        parsed.pluginId,
        parsed.surfaceId
      )
    : null;
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { settings: performanceSettings } = usePerformanceControlSettings();
  const extensionRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const shellSurfaceLookup = useMemo(() => {
    void extensionRevision;
    if (!parsed) return null;
    return readPluginShellSurfaceDescriptor({
      sourceKind: 'extv2',
      surfaceType: parsed.surfaceType,
      pluginId: parsed.pluginId,
      surfaceId: parsed.surfaceId,
    });
  }, [extensionRevision, parsed]);

  const dismissOnEscape = useMemo(() => {
    if (!parsed) return false;
    if (shellSurfaceLookup?.status === 'present') {
      return shellSurfaceLookup.record.descriptor.dismissOnEscape ?? parsed.surfaceType === 'overlay';
    }
    return parsed.surfaceType === 'overlay';
  }, [parsed, shellSurfaceLookup]);

  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isPageFrozen, setIsPageFrozen] = useState(false);

  const isWindowActive =
    isWindowVisible &&
    isDocumentVisible &&
    !isWindowMinimized &&
    !isPageFrozen &&
    isWindowFocused;

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
          telemetry.warn('plugin_shell_surface.focus_subscription.failed', {
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

      unlistenHidden = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.PLUGIN_SHELL_SURFACE_HIDDEN,
        (payload) => {
          if (payload === expectedPayload) setIsWindowVisible(false);
        }
      );
      unlistenShown = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.PLUGIN_SHELL_SURFACE_SHOWN,
        (payload) => {
          if (payload === expectedPayload) setIsWindowVisible(true);
        }
      );

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

  useEffect(() => {
    if (!parsed || !dismissOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      void dismissPluginShellSurface(
        parsed.pluginId,
        parsed.surfaceId,
        parsed.surfaceType,
        'extv2'
      ).catch((error) => {
        telemetry.warn('plugin_shell_surface.dismiss_on_escape.failed', {
          message: readErrorMessage(error),
          fields: {
            sourceKind: 'extv2',
            pluginId: parsed.pluginId,
            surfaceId: parsed.surfaceId,
            surfaceType: parsed.surfaceType,
          },
        });
      });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismissOnEscape, parsed]);

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
      <div className="plugin-shell-surface-root">
        <div className="plugin-shell-surface-error">Invalid plugin shell surface route.</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <NavigationProvider>
          <WindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive, renderMode }}>
            <QualityProvider>
              <div
                className="plugin-shell-surface-root"
                data-surface-type={parsed.surfaceType}
              >
                <ResolvedPluginShellSurfaceHost
                  pluginId={parsed.pluginId}
                  surfaceId={parsed.surfaceId}
                  surfaceType={parsed.surfaceType}
                />
              </div>
            </QualityProvider>
          </WindowActivityProvider>
        </NavigationProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
