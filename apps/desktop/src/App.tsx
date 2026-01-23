import { useEffect, useState, useMemo, useCallback } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { TAURI_EVENTS, setupTauriListener } from './utils/windowCommunication';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { useKernel } from './contexts/KernelContext';
import { CommandPalette } from './components/commands/CommandPalette';
import { WorkbenchHost } from './components/workbench/WorkbenchHost';
import { EditorProvider } from './contexts/EditorContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { MATRIX_CONFIG } from './constants/config';
import { Magnet } from './types/pixel';
import { syncEditorEffectsFromStorage } from './utils/editorWindowEffects';
import {
  createDefaultMagnetLibrary,
  createInitialMagnetState,
  MagnetLibraryProvider,
} from './modules/magnets';
import { APP_LIFECYCLE_SERVICE_TOKEN } from './services/lifecycle';
import { isTauriRuntime } from './utils/tauriRuntime';
import { WindowCloseProvider } from './contexts/WindowCloseContext';
import { KEYBINDINGS_SERVICE_TOKEN } from './services/keybindings';
import './App.css';

function AppContent() {
  const kernel = useKernel();
  const keybindings = kernel.services.get(KEYBINDINGS_SERVICE_TOKEN);

  const [isMainWindowVisible, setIsMainWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isMainWindowFocused, setIsMainWindowFocused] = useState(() => document.hasFocus());
  const isWindowActive = isMainWindowVisible && isDocumentVisible && isMainWindowFocused;
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const isTauri = useMemo(() => isTauriRuntime(), []);

  useEffect(() => {
    void syncEditorEffectsFromStorage();
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const [
          { migrateInstalledPmpmPluginsToDurableStorage },
          { migrateInstalledPmpsShaderPacksToDurableStorage },
        ] = await Promise.all([
          import('./magnet-system/plugins/pmpm'),
          import('./shader-system/pmps'),
        ]);

        const [pmpm, pmps] = await Promise.all([
          migrateInstalledPmpmPluginsToDurableStorage(),
          migrateInstalledPmpsShaderPacksToDurableStorage(),
        ]);

        if (pmpm.migrated || pmps.migrated || pmpm.failed || pmps.failed) {
          console.info('[storage] migration result', { pmpm, pmps });
        }
      } catch {
        // best-effort: migration should not block app boot
      }
    };

    const requestIdleCallback = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
      }
    ).requestIdleCallback;
    if (requestIdleCallback) {
      requestIdleCallback(() => void run(), { timeout: 1500 });
      return;
    }

    const timer = window.setTimeout(() => void run(), 800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
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
        setIsMainWindowFocused(true);
        return;
      }

      // Debounce blur: some platforms briefly drop focus while spawning child windows or dragging.
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (!disposed) setIsMainWindowFocused(false);
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
          console.warn('[MainWindow] Failed to subscribe to focus events:', error);
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
    const onKeyDown = (e: KeyboardEvent) => {
      const handled = keybindings.handleKeyboardEvent(e);
      if (handled) {
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keybindings]);

  useEffect(() => {
    const unsubscribeToggle = kernel.events.on('ui/commandPaletteToggleRequested', () => {
      setCommandPaletteOpen((value) => !value);
    });
    const unsubscribeClose = kernel.events.on('ui/commandPaletteCloseRequested', () => {
      setCommandPaletteOpen(false);
    });
    return () => {
      unsubscribeToggle();
      unsubscribeClose();
    };
  }, [kernel.events]);

  useEffect(() => {
    const init = async () => {
      try {
        setIsMainWindowVisible(await appWindow.isVisible());
      } catch {
        // ignore
      }

      const unlistenHidden = await setupTauriListener(TAURI_EVENTS.MAIN_WINDOW_HIDDEN, () => {
        setIsMainWindowVisible(false);
      });
      const unlistenShown = await setupTauriListener(TAURI_EVENTS.MAIN_WINDOW_SHOWN, () => {
        setIsMainWindowVisible(true);
      });

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = init();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  return (
    <WindowActivityProvider value={{ isVisible: isMainWindowVisible, isActive: isWindowActive }}>
      <div className="app-container">
        <WorkbenchHost />
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </WindowActivityProvider>
  );
}

function App() {
  const kernel = useKernel();
  const lifecycle = kernel.services.get(APP_LIFECYCLE_SERVICE_TOKEN);
  const registerFlushHandler = useCallback(
    (handler: () => void) => lifecycle.registerFlushHandler(() => handler()),
    [lifecycle]
  );

  // 从 localStorage 加载保存的配置以获取正确的 magnet 位置
  // 注意：magnetsForContext 仅用于 EditorProvider 的初始化
  // 后续更新通过 AppContent 内部的 updateOccupancy 方法进行
  const [magnetsForContext] = useState<Magnet[]>(() => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const initial = createInitialMagnetState(defaultLibrary);
    return initial.magnetLibrary.filter((magnet) => initial.activeMagnetIds.has(magnet.id));
  });

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <EditorProvider magnets={magnetsForContext}>
          <NavigationProvider>
            <MagnetLibraryProvider
              gridSize={{ columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS }}
              registerFlushHandler={registerFlushHandler}
            >
              <WindowCloseProvider>
                <AppContent />
              </WindowCloseProvider>
            </MagnetLibraryProvider>
          </NavigationProvider>
        </EditorProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}

export default App;
