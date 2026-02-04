import { appWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { VstManagerWindow } from './components/vst/VstManagerWindow';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { readJson } from './modules/storage';
import { isTauriRuntime } from './utils/tauriRuntime';
import { useAdaptiveRenderMode } from './contexts/useAdaptiveRenderMode';
import { STORAGE_KEYS, TAURI_EVENTS, setupDualListener, setupTauriListener } from './utils/windowCommunication';
import { DEFAULT_BACKGROUND_RENDER_POLICY, type BackgroundRenderPolicy, parseBackgroundRenderPolicy } from './contracts/performance';
import './VstManagerWindowApp.css';

function isVstManagerRoute(): boolean {
  const hash = window.location.hash;
  return hash === '#/vst-manager' || hash.startsWith('#/vst-manager?');
}

export function VstManagerWindowApp() {
  const ok = useMemo(() => isVstManagerRoute(), []);
  const isTauri = useMemo(() => isTauriRuntime(), []);

  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isPageFrozen, setIsPageFrozen] = useState(false);
  const [backgroundRenderPolicy, setBackgroundRenderPolicy] = useState<BackgroundRenderPolicy>(() =>
    parseBackgroundRenderPolicy(
      readJson(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, DEFAULT_BACKGROUND_RENDER_POLICY),
      DEFAULT_BACKGROUND_RENDER_POLICY
    )
  );

  const isWindowActive = isWindowVisible && isDocumentVisible && !isWindowMinimized && !isPageFrozen && isWindowFocused;

  const refreshBackgroundRenderPolicy = useCallback(() => {
    setBackgroundRenderPolicy(
      parseBackgroundRenderPolicy(
        readJson(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, DEFAULT_BACKGROUND_RENDER_POLICY),
        DEFAULT_BACKGROUND_RENDER_POLICY
      )
    );
  }, []);

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
          console.warn('[VstManagerWindow] Failed to subscribe to focus events:', error);
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
    let disposed = false;
    refreshBackgroundRenderPolicy();

    const setup = async () => {
      const teardown = await setupDualListener(
        [STORAGE_KEYS.BACKGROUND_RENDER_POLICY],
        [TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED],
        refreshBackgroundRenderPolicy
      );
      if (disposed) {
        teardown();
        return () => {};
      }
      return teardown;
    };

    const teardownPromise = setup();
    return () => {
      disposed = true;
      teardownPromise.then((teardown) => teardown());
    };
  }, [refreshBackgroundRenderPolicy]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;

    const setup = async () => {
      try {
        setIsWindowVisible(await appWindow.isVisible());
      } catch {
        // ignore
      }

      const unlistenHidden = await setupTauriListener(TAURI_EVENTS.VST_MANAGER_WINDOW_HIDDEN, () => {
        if (!disposed) setIsWindowVisible(false);
      });
      const unlistenShown = await setupTauriListener(TAURI_EVENTS.VST_MANAGER_WINDOW_SHOWN, () => {
        if (!disposed) setIsWindowVisible(true);
      });

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = setup();
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri]);

  const renderMode = useAdaptiveRenderMode({
    isWindowVisible,
    isDocumentVisible,
    isWindowFocused,
    isWindowMinimized,
    isPageFrozen,
    backgroundRenderPolicy,
  });

  if (!ok) {
    return (
      <div className="vst-manager-window-root">
        <div className="vst-manager-window-error">Invalid VST manager window route.</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <WindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive, renderMode }}>
          <div className="vst-manager-window-root">
            <VstManagerWindow />
          </div>
        </WindowActivityProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
