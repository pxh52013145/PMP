import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { EditorProvider } from './contexts/EditorContext';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { EditorStatistics } from './components/editor/EditorStatistics';
import { EditorMagnetLibrary } from './components/editor/EditorMagnetLibrary';
import { StyleEditor } from './components/editor/StyleEditor';
import { MagnetCreator } from './components/editor/MagnetCreator';
import { BackgroundManager } from './components/editor/BackgroundManager';
import { CustomBackgroundEditor } from './components/editor/CustomBackgroundEditor';
import { ThemeDebugPage } from './components/debug/ThemeDebugPage';
import { Magnet } from './types/pixel';
import { BackgroundSettings, BackgroundConfig } from './types/background';
import { DEFAULT_BACKGROUND_SETTINGS } from './constants/defaultBackground';
import { WINDOW_CONTROL_MAGNETS } from './data/builtin/windowControlMagnets';
import { DRAG_HANDLE_MAGNET } from './data/builtin/dragHandleMagnet';
import { WINDOW_PIN_MAGNET } from './data/builtin/windowPinMagnet';
import { MUSIC_PLAYER_MAGNETS } from './data/builtin/musicPlayerMagnets';
import { EDITOR_BUTTON_MAGNET } from './data/builtin/editorMagnet';
import { DEBUG_BUTTON_MAGNET } from './data/builtin/debugButtonMagnet';
import { NAVIGATION_PAGE_MAGNET } from './data/builtin/navigationPageMagnet';
import { BACK_BUTTON_MAGNET } from './data/builtin/backButtonMagnet';
import { AUDIO_VISUALIZER_MAGNET } from './data/builtin/audioVisualizerMagnet';
import {
  PLAY_QUEUE_MAGNET,
  PLAYLISTS_MAGNET,
  MUSIC_LIBRARY_MAGNET,
} from './data/builtin/musicMagnets';
import { saveConfig, loadConfig, applyConfig } from './utils/configManager';
import { MATRIX_CONFIG } from './constants/config';
import { isTauriRuntime } from './utils/tauriRuntime';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  broadcastSignal,
  setupConfigSync,
  setupTauriListener,
  setupTauriListenerWithPayload,
} from './utils/windowCommunication';
import { readJson, readString, removeKey, writeJson } from './modules/storage';
import './index.css';
import './components/editor/EditorStatistics.css';
import './components/editor/EditorMagnetLibrary.css';
import './components/editor/StyleEditor.css';
import './components/editor/EditorWindowApp.css';
import './components/editor/MagnetCreator.css';
import './components/editor/BackgroundManager.css';
import './components/editor/CustomBackgroundEditor.css';

interface EditorControlPanelProps {
  onExitEditMode: () => void;
}

function EditorControlPanel({ onExitEditMode }: EditorControlPanelProps) {
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true); // 默认置顶

  const setOpenStateForType = useCallback((type: string, open: boolean) => {
    switch (type) {
      case 'statistics':
        setStatisticsOpen(open);
        return;
      case 'library':
        setLibraryOpen(open);
        return;
      case 'style':
        setStyleOpen(open);
        return;
      case 'debug':
        setDebugOpen(open);
        return;
      case 'background':
        setBackgroundOpen(open);
        return;
      default:
        return;
    }
  }, []);

  const syncWindowStates = useCallback(async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/window');

      const getVisible = async (type: string) => {
        const win = WebviewWindow.getByLabel(`editor-${type}`);
        if (!win) return false;
        try {
          return await win.isVisible();
        } catch {
          return false;
        }
      };

      const [statistics, library, style, debug, background] = await Promise.all([
        getVisible('statistics'),
        getVisible('library'),
        getVisible('style'),
        getVisible('debug'),
        getVisible('background'),
      ]);

      setStatisticsOpen(statistics);
      setLibraryOpen(library);
      setStyleOpen(style);
      setDebugOpen(debug);
      setBackgroundOpen(background);
    } catch {
      // best-effort: visibility sync is non-critical
    }
  }, []);

  // Keep toggle UI in sync with actual window lifecycle (including force-close paths).
  useEffect(() => {
    const setup = async () => {
      const unlistenHidden = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_HIDDEN,
        (payload) => {
          if (payload === 'control') {
            // Closing the control window exits edit mode and force-closes children; reset the UI state
            // so the next time this cached window is shown it won't display stale toggles.
            setStatisticsOpen(false);
            setLibraryOpen(false);
            setStyleOpen(false);
            setDebugOpen(false);
            setBackgroundOpen(false);
            return;
          }
          setOpenStateForType(payload, false);
        }
      );

      const unlistenShown = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_SHOWN,
        (payload) => {
          if (payload === 'control') {
            setStatisticsOpen(false);
            setLibraryOpen(false);
            setStyleOpen(false);
            setDebugOpen(false);
            setBackgroundOpen(false);
            void syncWindowStates();
            return;
          }
          setOpenStateForType(payload, true);
        }
      );

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = setup();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [setOpenStateForType, syncWindowStates]);

  useEffect(() => {
    let isActive = true;

    const run = () => {
      if (!isActive) return;
      void syncWindowStates();
    };

    run();

    const onVisibilityChange = () => {
      if (!document.hidden) run();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', run);

    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', run);
    };
  }, [syncWindowStates]);

  const handleToggleStatistics = async () => {
    const newState = !statisticsOpen;
    setStatisticsOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('statistics');
        await openEditorWindow({ type: 'statistics', ...position });
      } else {
        // 关闭窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('statistics');
      }
    } catch (error) {
      console.error('Failed to toggle statistics window:', error);
    }
  };

  const handleToggleLibrary = async () => {
    const newState = !libraryOpen;
    setLibraryOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('library');
        await openEditorWindow({ type: 'library', ...position });
      } else {
        // 关闭窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('library');
      }
    } catch (error) {
      console.error('Failed to toggle library window:', error);
    }
  };

  const handleToggleStyle = async () => {
    const newState = !styleOpen;
    setStyleOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('style');
        await openEditorWindow({ type: 'style', ...position });
      } else {
        // 关闭窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('style');
      }
    } catch (error) {
      console.error('Failed to toggle style window:', error);
    }
  };

  const handleToggleDebug = async () => {
    const newState = !debugOpen;
    setDebugOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('debug');
        await openEditorWindow({ type: 'debug', ...position });
      } else {
        // 关闭窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('debug');
      }
    } catch (error) {
      console.error('Failed to toggle debug window:', error);
    }
  };

  const handleToggleBackground = async () => {
    const newState = !backgroundOpen;
    setBackgroundOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('background');
        await openEditorWindow({ type: 'background', ...position });
      } else {
        // 关闭窗口及其子窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('background');
        // 同时关闭自定义背景编辑器窗口
        try {
          await closeEditorWindow('custom-background');
        } catch (error) {
          // 自定义背景窗口可能没打开，忽略错误
        }
      }
    } catch (error) {
      console.error('Failed to toggle background window:', error);
    }
  };

  // 切换所有编辑器窗口的置顶状态
  const handleToggleAlwaysOnTop = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const newState = !isAlwaysOnTop;
    setIsAlwaysOnTop(newState);

    // 立即移除焦点，防止填满效果残留
    e.currentTarget.blur();

    try {
      const { getAll } = await import('@tauri-apps/api/window');
      const allWindows = getAll();

      // 切换所有编辑器窗口的置顶状态
      for (const window of allWindows) {
        if (window.label.startsWith('editor-')) {
          await window.setAlwaysOnTop(newState);
        }
      }
    } catch (error) {
      console.error('Failed to toggle always on top:', error);
    }
  };

  return (
    <div className="draggable-control-panel">
      {/* 拖动标题栏 - 与其他编辑器窗口统一 */}
      <div className="editor-window-header control-header" data-tauri-drag-region>
        <span className="drag-dots" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      {/* 完成编辑按钮和置顶按钮 */}
      <div className="control-button-group">
        <button className="cyber-btn exit-cyber-btn" onClick={onExitEditMode}>
          <span className="btn-text">submit</span>
        </button>
        <button
          className={`cyber-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
          onClick={handleToggleAlwaysOnTop}
          title={isAlwaysOnTop ? '取消置顶' : '窗口置顶'}
        >
          <span className="btn-text"></span>
        </button>
      </div>

      {/* 统计开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${statisticsOpen ? 'active' : ''}`}
          onClick={handleToggleStatistics}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">info</span>
      </div>

      {/* Magnet 库开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${libraryOpen ? 'active' : ''}`}
          onClick={handleToggleLibrary}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">LIB</span>
      </div>

      {/* 风格设置开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${styleOpen ? 'active' : ''}`}
          onClick={handleToggleStyle}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">style</span>
      </div>

      {/* 背景管理开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${backgroundOpen ? 'active' : ''}`}
          onClick={handleToggleBackground}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">BG</span>
      </div>

      {/* Debug 开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${debugOpen ? 'active' : ''}`}
          onClick={handleToggleDebug}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">debug</span>
      </div>
    </div>
  );
}

// 从 URL hash 立即解析窗口类型（避免首次渲染闪烁）
const getWindowTypeFromHash = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/#\/editor\/([\w-]+)/);
  const raw = match ? match[1] : 'control';
  return raw === 'help' ? 'debug' : raw;
};

export function EditorWindowApp() {
  const [windowType, setWindowType] = useState<string>(getWindowTypeFromHash());
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const isWindowActive = isWindowVisible && isDocumentVisible && isWindowFocused;
  const activityRef = useRef({ isWindowActive });
  activityRef.current.isWindowActive = isWindowActive;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const effectsReadyRef = useRef(false);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const needsMagnetConfigSync =
    windowType === 'library' || windowType === 'statistics' || windowType === 'creator';
  const needsBuiltInMagnetIds = windowType === 'library';

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
        setIsWindowFocused(true);
        return;
      }

      // Debounce blur: some platforms briefly drop focus while dragging the window.
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (!disposed) setIsWindowFocused(false);
      }, 160);
    };

    const setup = async () => {
      if (isTauri) {
        try {
          const { appWindow } = await import('@tauri-apps/api/window');
          const initialFocused = await appWindow.isFocused().catch(() => document.hasFocus());
          applyFocus(initialFocused);
          unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
            applyFocus(focused);
          });
          return;
        } catch (error) {
          console.warn('[EditorWindow] Failed to subscribe to focus events:', error);
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
    const setup = async () => {
      const unlistenHidden = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_HIDDEN,
        (payload) => {
          if (payload === windowType) setIsWindowVisible(false);
        }
      );

      const unlistenShown = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_SHOWN,
        (payload) => {
          if (payload === windowType) setIsWindowVisible(true);
        }
      );

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = setup();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [windowType]);

  // 默认内置 Magnet 库
  const defaultMagnetLibrary = useMemo(
    () => [
      DRAG_HANDLE_MAGNET,
      ...WINDOW_CONTROL_MAGNETS,
      WINDOW_PIN_MAGNET,
      ...MUSIC_PLAYER_MAGNETS,
      AUDIO_VISUALIZER_MAGNET,
      EDITOR_BUTTON_MAGNET,
      DEBUG_BUTTON_MAGNET,
      PLAY_QUEUE_MAGNET,
      PLAYLISTS_MAGNET,
      MUSIC_LIBRARY_MAGNET,
      NAVIGATION_PAGE_MAGNET,
      BACK_BUTTON_MAGNET,
    ],
    []
  );

  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(() => {
    return readJson<Magnet[]>(STORAGE_KEYS.MAGNET_LIBRARY, []);
  });
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => {
    return new Set(readJson<string[]>(STORAGE_KEYS.ACTIVE_MAGNETS, []));
  });
  const [builtInMagnetIds, setBuiltInMagnetIds] = useState<Set<string>>(() => {
    return new Set(readJson<string[]>(STORAGE_KEYS.BUILTIN_MAGNETS, []));
  });
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(() => {
    return readJson<BackgroundSettings>(STORAGE_KEYS.BACKGROUND_SETTINGS, DEFAULT_BACKGROUND_SETTINGS);
  });
  const [isMaximized, setIsMaximized] = useState(() => {
    return readJson<boolean>(STORAGE_KEYS.IS_MAXIMIZED, false);
  });

  // Creator 编辑模式数据
  const [creatorMode, setCreatorMode] = useState<'create' | 'edit'>('create');
  const [editingMagnet, setEditingMagnet] = useState<Magnet | undefined>(undefined);

  const reloadCreatorData = useCallback(() => {
    try {
      const mode = readString(STORAGE_KEYS.MAGNET_EDITOR_MODE) as 'create' | 'edit' | null;
      const data = readJson<Magnet | null>(STORAGE_KEYS.MAGNET_EDITOR_DATA, null);

      if (mode === 'edit' && data) {
        setCreatorMode('edit');
        setEditingMagnet(data);
      } else {
        setCreatorMode('create');
        setEditingMagnet(undefined);
      }
    } catch (error) {
      console.error('Failed to load creator data:', error);
      setCreatorMode('create');
      setEditingMagnet(undefined);
    }
  }, []);

  // Creator window is now cached (hidden, not destroyed), so it must reload its payload when reopened.
  useEffect(() => {
    if (windowType !== 'creator') return;

    reloadCreatorData();

    const setup = async () => {
      const unlistenOpened = await setupTauriListener(TAURI_EVENTS.CREATOR_WINDOW_OPENED, () => {
        reloadCreatorData();
      });

      const unlistenHidden = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_HIDDEN,
        (payload) => {
          if (payload === 'creator') {
          void broadcastDataUpdate(
            STORAGE_KEYS.CREATOR_WINDOW_OPEN,
            false,
            TAURI_EVENTS.CREATOR_WINDOW_CLOSED
          );
        }
        }
      );

      return () => {
        unlistenOpened();
        unlistenHidden();
      };
    };

    const cleanupPromise = setup();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [windowType, reloadCreatorData]);

  // 监听 URL hash 变化（如果需要动态切换）
  useEffect(() => {
    const handleHashChange = () => {
      const newType = getWindowTypeFromHash();
      setWindowType(newType);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Scroll performance: when user is actively scrolling, temporarily disable heavy glass effects (blur)
  // to avoid wheel jank in small editor windows.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let rafId: number | null = null;
    let idleTimer: number | null = null;

    const markScrolling = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        root.classList.add('editor-window-app--scrolling');
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          root.classList.remove('editor-window-app--scrolling');
        }, 160);
      });
    };

    root.addEventListener('wheel', markScrolling, { passive: true });

    return () => {
      root.removeEventListener('wheel', markScrolling);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, [windowType]);

  // Avoid "open window stutter": delay expensive glass effects until after the first paint of this window.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (effectsReadyRef.current) return;
    if (isTauri) return;
    if (!isWindowActive) return;

    let raf1: number | null = null;
    let raf2: number | null = null;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        root.classList.add('editor-window-app--effects-ready');
        effectsReadyRef.current = true;
      });
    });

    return () => {
      if (raf1 !== null) window.cancelAnimationFrame(raf1);
      if (raf2 !== null) window.cancelAnimationFrame(raf2);
    };
  }, [isWindowActive, isTauri]);

  // 从主窗口加载初始数据和监听更新
  useEffect(() => {
    const loadConfigFromMain = () => {
      try {
        if (needsMagnetConfigSync) {
          // 从配置文件加载（支持 styleOverride）
          const config = loadConfig();
          if (config) {
            const applied = applyConfig(config, defaultMagnetLibrary);
            setMagnetLibrary(applied.magnetLibrary);
            setActiveMagnetIds(applied.activeMagnetIds);
          }
        }

        // 加载其他辅助数据
        if (needsBuiltInMagnetIds) {
          const builtInData = readJson<string[] | null>(STORAGE_KEYS.BUILTIN_MAGNETS, null);
          if (builtInData) setBuiltInMagnetIds(new Set(builtInData));
        }

        const backgroundData = readJson<BackgroundSettings | null>(STORAGE_KEYS.BACKGROUND_SETTINGS, null);
        if (backgroundData) setBackgroundSettings(backgroundData);

        const maximizedData = readJson<boolean | null>(STORAGE_KEYS.IS_MAXIMIZED, null);
        if (maximizedData !== null) setIsMaximized(maximizedData);
      } catch (error) {
        console.error('Failed to load config from main window:', error);
      }
    };

    // 初始加载
    loadConfigFromMain();

    // 监听主窗口的配置更新（仅对需要 magnet 配置的窗口启用）
    if (!needsMagnetConfigSync) return;

    let reloadTimer: number | null = null;
    let reloadInFlight = false;

    const scheduleReload = () => {
      if (!activityRef.current.isWindowActive) return;
      if (reloadTimer !== null) return;

      reloadTimer = window.setTimeout(async () => {
        reloadTimer = null;
        if (reloadInFlight) return;
        reloadInFlight = true;
        try {
          loadConfigFromMain();
        } finally {
          reloadInFlight = false;
        }
      }, 60);
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.CONFIG],
      [
        TAURI_EVENTS.MAGNET_LIBRARY_UPDATED,
        TAURI_EVENTS.MAGNET_ACTIVATED,
        TAURI_EVENTS.MAGNET_DEACTIVATED,
      ],
      () => {
        scheduleReload();
      }
    );

    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [defaultMagnetLibrary, needsBuiltInMagnetIds, needsMagnetConfigSync]);

  // Handlers
  const handleExitEditMode = async () => {
    try {
      // 通知主窗口退出编辑模式
      await broadcastSignal(TAURI_EVENTS.EDITOR_STYLE_APPLY);

      // 关闭所有编辑器窗口
      const { closeEditorWindow } = await import('./utils/editorWindows');
      await closeEditorWindow('control');
    } catch (error) {
      console.error('Failed to exit edit mode:', error);
    }
  };

  const handleMagnetActivate = async (magnetId: string) => {
    const newActive = new Set(activeMagnetIds);
    newActive.add(magnetId);
    setActiveMagnetIds(newActive);

    // 保存配置并广播
    saveConfig(
      magnetLibrary,
      newActive,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary
    );
    writeJson(STORAGE_KEYS.ACTIVE_MAGNETS, [...newActive]);
    await broadcastSignal(TAURI_EVENTS.MAGNET_ACTIVATED);
    console.log('EditorWindow: Magnet activated:', magnetId);
  };

  const handleMagnetDeactivate = async (magnetId: string) => {
    const newActive = new Set(activeMagnetIds);
    newActive.delete(magnetId);
    setActiveMagnetIds(newActive);

    // 保存配置并广播
    saveConfig(
      magnetLibrary,
      newActive,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary
    );
    writeJson(STORAGE_KEYS.ACTIVE_MAGNETS, [...newActive]);
    await broadcastSignal(TAURI_EVENTS.MAGNET_DEACTIVATED);
    console.log('EditorWindow: Magnet deactivated:', magnetId);
  };

  const handleMagnetDeleteFromLibrary = async (magnetId: string) => {
    const newLibrary = magnetLibrary.filter((m) => m.id !== magnetId);
    setMagnetLibrary(newLibrary);

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary
    );
    writeJson(STORAGE_KEYS.MAGNET_LIBRARY, newLibrary);
    await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    console.log('EditorWindow: Magnet deleted:', magnetId);
  };

  const handleMagnetAddToLibrary = async (magnet: Magnet) => {
    const newLibrary = [...magnetLibrary, magnet];
    setMagnetLibrary(newLibrary);

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary
    );
    writeJson(STORAGE_KEYS.MAGNET_LIBRARY, newLibrary);
    await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    console.log('EditorWindow: Magnet added:', magnet.id);
  };

  const handleMagnetUpdate = async (magnet: Magnet) => {
    const newLibrary = magnetLibrary.map((m) => (m.id === magnet.id ? magnet : m));
    setMagnetLibrary(newLibrary);

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary
    );
    writeJson(STORAGE_KEYS.MAGNET_LIBRARY, newLibrary);
    await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    console.log('EditorWindow: Magnet updated:', magnet.id);
  };

  const handleBackgroundSettingsChange = async (settings: BackgroundSettings) => {
    setBackgroundSettings(settings);
    await broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      settings,
      TAURI_EVENTS.BACKGROUND_UPDATED
    );
  };

  const handleCustomBackgroundSave = async (config: BackgroundConfig) => {
    console.log('handleCustomBackgroundSave called with:', config);
    console.log('isMaximized:', isMaximized);

    // 保存自定义背景到当前模式
    const newSettings = {
      ...backgroundSettings,
      [isMaximized ? 'maximized' : 'windowed']: config,
    };
    console.log('newSettings:', newSettings);

    setBackgroundSettings(newSettings);

    // 使用统一的广播机制
    await broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      newSettings,
      TAURI_EVENTS.BACKGROUND_UPDATED
    );
    console.log('Background settings broadcasted');

    // Auto-add to background history (so custom backgrounds are discoverable without extra clicks).
    try {
      const history = readJson<Array<{ id: string; config: BackgroundConfig; timestamp: number }>>(STORAGE_KEYS.BACKGROUND_HISTORY, []);
      const newItem = {
        id: `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        config,
        timestamp: Date.now(),
      };
      writeJson(STORAGE_KEYS.BACKGROUND_HISTORY, [newItem, ...history].slice(0, 20));
    } catch (error) {
      console.warn('Failed to auto-add background history item:', error);
    }

    // 关闭自定义背景编辑窗口
    import('./utils/editorWindows').then(({ closeEditorWindow }) => {
      closeEditorWindow('custom-background');
      console.log('Custom background window closed');
    });
  };

  // 获取当前激活的 magnets
  const activeMagnets = useMemo(() => {
    return magnetLibrary.filter((magnet) => activeMagnetIds.has(magnet.id));
  }, [magnetLibrary, activeMagnetIds]);

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <NavigationProvider>
          <EditorProvider magnets={activeMagnets}>
            <WindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive }}>
              <div
                className={`editor-window-app ${isTauri ? 'editor-window-app--tauri' : ''}`}
                ref={rootRef}
              >
                  {windowType === 'control' && <EditorControlPanel onExitEditMode={handleExitEditMode} />}

            {windowType === 'statistics' && <EditorStatistics />}

            {windowType === 'library' && (
              <EditorMagnetLibrary
                magnetLibrary={magnetLibrary}
                activeMagnetIds={activeMagnetIds}
                builtInMagnetIds={builtInMagnetIds}
                onMagnetAddToLibrary={handleMagnetAddToLibrary}
                onMagnetActivate={handleMagnetActivate}
                onMagnetDeactivate={handleMagnetDeactivate}
                onMagnetDeleteFromLibrary={handleMagnetDeleteFromLibrary}
              />
            )}

            {windowType === 'style' && <StyleEditor />}

            {windowType === 'creator' && (
              <MagnetCreator
                mode={creatorMode}
                editingMagnet={editingMagnet}
                defaultMagnet={
                  // 如果是编辑内置 Magnet，传入默认配置
                  creatorMode === 'edit' && editingMagnet
                    ? defaultMagnetLibrary.find((m) => m.id === editingMagnet.id)
                    : undefined
                }
                onSave={async (magnet) => {
                  // 根据模式选择新增或更新
                  if (creatorMode === 'edit') {
                    handleMagnetUpdate(magnet);
                  } else {
                    handleMagnetAddToLibrary(magnet);
                  }
                  // 清除编辑数据
                  removeKey(STORAGE_KEYS.MAGNET_EDITOR_MODE);
                  removeKey(STORAGE_KEYS.MAGNET_EDITOR_DATA);
                  // 清除窗口打开状态
                  await broadcastDataUpdate(
                    STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                    false,
                    TAURI_EVENTS.CREATOR_WINDOW_CLOSED
                  );
                }}
                onCancel={async () => {
                  try {
                    // 清除编辑数据
                    removeKey(STORAGE_KEYS.MAGNET_EDITOR_MODE);
                    removeKey(STORAGE_KEYS.MAGNET_EDITOR_DATA);
                    // 清除窗口打开状态
                    await broadcastDataUpdate(
                      STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                      false,
                      TAURI_EVENTS.CREATOR_WINDOW_CLOSED
                    );
                    // 关闭窗口
                    const { closeEditorWindow } = await import('./utils/editorWindows');
                    await closeEditorWindow('creator');
                  } catch (error) {
                    console.error('Failed to close creator window:', error);
                  }
                }}
              />
            )}

            {windowType === 'background' && (
              <BackgroundManager
                settings={backgroundSettings}
                onSettingsChange={handleBackgroundSettingsChange}
                currentWindowMode={isMaximized ? 'maximized' : 'windowed'}
              />
            )}

            {windowType === 'custom-background' && (
              <CustomBackgroundEditor
                initialConfig={backgroundSettings[isMaximized ? 'maximized' : 'windowed']}
                onSave={handleCustomBackgroundSave}
              />
            )}

                {windowType === 'debug' && <ThemeDebugPage />}
              </div>
            </WindowActivityProvider>
          </EditorProvider>
        </NavigationProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
