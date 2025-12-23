import { useEffect, useState, useMemo, useCallback } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  setupTauriListener,
} from './utils/windowCommunication';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { useKernel } from './contexts/KernelContext';
import Background from './components/core/Background';
import PixelMatrixCanvas from './components/core/PixelMatrixCanvas';
import WindowBorder from './components/core/WindowBorder';
import MatrixRainEffect from './components/effects/MatrixRainEffect';
import { MagnetLayer } from './components/magnet/MagnetLayer';
import { EditorOverlay } from './components/core/EditorOverlay';
import { EditorPanel } from './components/core/EditorPanel';
import { CommandPalette } from './components/commands/CommandPalette';
import { EditorProvider, useEditor } from './contexts/EditorContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { MATRIX_CONFIG } from './constants/config';
import { Magnet, PixelAnchor } from './types/pixel';
import { BackgroundSettings } from './types/background';
import { DEFAULT_BACKGROUND_SETTINGS } from './constants/defaultBackground';
import { calculateWindowPosition } from './utils/editorWindows';
import { syncEditorEffectsFromStorage } from './utils/editorWindowEffects';
import {
  createDefaultMagnetLibrary,
  createInitialMagnetState,
  MagnetLibraryProvider,
  useMagnetConfig,
} from './modules/magnets';
import { readJson, readString, writeJson } from './modules/storage';
import { gcOrphanBackgroundMedia } from './modules/background/mediaCleanup';
import { APP_LIFECYCLE_SERVICE_TOKEN } from './services/lifecycle';
import { isTauriRuntime } from './utils/tauriRuntime';
import './App.css';

type BackgroundThemeColor = { id: string; rgb: [number, number, number] };
const DEFAULT_BACKGROUND_THEME_COLOR: BackgroundThemeColor = { id: 'cyan', rgb: [0, 255, 136] };

function AppContent() {
  const [isMainWindowVisible, setIsMainWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const isWindowActive = isMainWindowVisible && isDocumentVisible;
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    void syncEditorEffectsFromStorage();
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const [{ migrateInstalledPmpmPluginsToDurableStorage }, { migrateInstalledPmpsShaderPacksToDurableStorage }] =
          await Promise.all([
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

    const requestIdleCallback = (window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;
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
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!target || !(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      return target.isContentEditable;
    };

    const isMac = navigator.platform.toLowerCase().includes('mac');

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setCommandPaletteOpen((value) => !value);
        return;
      }

      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

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

  const [pixelPositions, setPixelPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const [isMaximized, setIsMaximized] = useState(false);

  // 同步 isMaximized 状态到 localStorage，供编辑器窗口使用
  useEffect(() => {
    writeJson(STORAGE_KEYS.IS_MAXIMIZED, isMaximized);
  }, [isMaximized]);

  // 窗口背景效果状态
  const [backgroundEffect, setBackgroundEffect] = useState(() => {
    return readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
  });
  const [backgroundThemeColor, setBackgroundThemeColor] = useState<BackgroundThemeColor>(() => {
    return readJson<BackgroundThemeColor>(
      STORAGE_KEYS.BACKGROUND_THEME_COLOR,
      DEFAULT_BACKGROUND_THEME_COLOR
    );
  });

  // 监听背景效果和主题色变化
  useEffect(() => {
    const setupEffectListeners = async () => {
      const unlistenBg = await setupTauriListener(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED, () => {
        const effect = readString(STORAGE_KEYS.BACKGROUND_EFFECT);
        if (effect) {
          setBackgroundEffect(effect);
        }
      });

      const unlistenBgColor = await setupTauriListener(
        TAURI_EVENTS.BACKGROUND_THEME_COLOR_UPDATED,
        () => {
          setBackgroundThemeColor(
            readJson<BackgroundThemeColor>(
              STORAGE_KEYS.BACKGROUND_THEME_COLOR,
              DEFAULT_BACKGROUND_THEME_COLOR
            )
          );
        }
      );

      return () => {
        unlistenBg();
        unlistenBgColor();
      };
    };

    const cleanup = setupEffectListeners();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, []);

  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(() => {
    return readJson(STORAGE_KEYS.BACKGROUND_SETTINGS, DEFAULT_BACKGROUND_SETTINGS);
  });

  // 边框动画已移至 WindowBorder 组件管理

  const { toggleEditMode, exitEditMode, updateOccupancy } = useEditor();
  const { magnetLibrary, activeMagnetIds, updateMagnetAnchors } = useMagnetConfig();

  // ============ 新的状态管理系统 ============

  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();

    // 防止上下文菜单
    document.addEventListener('contextmenu', preventDefault);

    // 禁用默认的拖放行为
    document.addEventListener('drop', preventDefault);
    document.addEventListener('dragover', preventDefault);

    const isTauri = isTauriRuntime();

    // 初始化时检查窗口是否最大化
    if (isTauri) {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {
        // ignore
      });
    }

    // 监听窗口大小变化
    const handleResize = async () => {
      if (!isTauri) return;
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
      // 不再清除位置缓存，保持编辑器窗口的用户自定义位置
    };

    // 监听 resize 事件（窗口大小改变时触发）
    if (isTauri) {
      window.addEventListener('resize', handleResize);

      // 预热：预先计算编辑器窗口位置
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          calculateWindowPosition('control').catch(() => {
            // 忽略错误，这只是预热
          });
        });
      } else {
        // 降级方案
        setTimeout(() => {
          calculateWindowPosition('control').catch(() => {
            // 忽略错误，这只是预热
          });
        }, 1000);
      }
    }

    return () => {
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('drop', preventDefault);
      document.removeEventListener('dragover', preventDefault);
      if (isTauri) {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  // Background media GC (runs on startup; no UI blocking).
  useEffect(() => {
    const run = async () => {
      try {
        const result = await gcOrphanBackgroundMedia();
        if (result.removed > 0) {
          console.log(`[background] GC removed ${result.removed}/${result.scanned} orphan files`);
        }
      } catch (error) {
        console.warn('[background] GC failed:', error);
      }
    };

    const requestIdleCallback = (window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (requestIdleCallback) {
      requestIdleCallback(() => {
        void run();
      }, { timeout: 2000 });
      return;
    }
    const timer = setTimeout(() => run(), 800);
    return () => clearTimeout(timer);
  }, []);

  // 监听背景设置变化（使用统一的通信机制）
  useEffect(() => {
    const reloadBackgroundSettings = () => {
      setBackgroundSettings(readJson(STORAGE_KEYS.BACKGROUND_SETTINGS, DEFAULT_BACKGROUND_SETTINGS));
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.BACKGROUND_SETTINGS],
      [TAURI_EVENTS.BACKGROUND_UPDATED],
      reloadBackgroundSettings
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  // 监听编辑器窗口的退出信号
  useEffect(() => {
    // 监听 Tauri 退出编辑模式事件
    const setupExitListener = async () => {
      const unlisten = await setupTauriListener(TAURI_EVENTS.EDITOR_EXIT, () => {
        exitEditMode();
      });
      return unlisten;
    };

    const unlistenPromise = setupExitListener();

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [exitEditMode]);

  // 获取当前激活的 Magnet（显示在点阵上的）
  const activeMagnets = useMemo(() => {
    const filtered = magnetLibrary
      .filter((m) => activeMagnetIds.has(m.id))
      .map((m) => {
        // 为编辑器按钮绑定切换函数
        if (m.id === 'btn-editor') {
          return {
            ...m,
            interactions: {
              ...m.interactions,
              onClick: toggleEditMode,
            },
          };
        }
        return m;
      });
    return filtered;
  }, [magnetLibrary, activeMagnetIds, toggleEditMode]);

  // 更新占用信息
  useEffect(() => {
    updateOccupancy(activeMagnets);
  }, [activeMagnets, updateOccupancy]);

  // 处理 Magnet 移动（只更新库中的 Magnet）
  const handleMagnetMove = useCallback((magnetId: string, newAnchors: PixelAnchor[]) => {
    updateMagnetAnchors(magnetId, newAnchors);
  }, [updateMagnetAnchors]);

  // 根据窗口状态选择背景配置
  const currentBackground = isMaximized
    ? backgroundSettings.maximized
    : backgroundSettings.windowed;

  return (
    <WindowActivityProvider value={{ isVisible: isMainWindowVisible, isActive: isWindowActive }}>
      <div className="app-container">
      {/* 背景层 - 根据窗口状态显示不同背景 */}
      <Background config={currentBackground} />

      {/* 字符雨背景效果层 - 独立渲染在低层级 */}
      {backgroundEffect === 'matrix-rain' && (
        <MatrixRainEffect
          color={backgroundThemeColor.rgb}
          isRainbow={backgroundThemeColor.id === 'rainbow'}
        />
      )}

      {/* Pixel Grid 层 */}
      <PixelMatrixCanvas onPixelPositionsUpdate={setPixelPositions} />

      {/* Magnet 层 */}
      {pixelPositions.size > 0 && (
        <MagnetLayer magnets={activeMagnets} pixelPositions={pixelPositions} />
      )}

      {/* 编辑器覆盖层 */}
      {pixelPositions.size > 0 && (
        <EditorOverlay
          pixelPositions={pixelPositions}
          magnets={activeMagnets}
          onMagnetMove={handleMagnetMove}
        />
      )}

      {/* 编辑器面板 */}
      <EditorPanel />

      {/* 窗口边框 */}
      <WindowBorder />
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
              <AppContent />
            </MagnetLibraryProvider>
          </NavigationProvider>
        </EditorProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}

export default App;
