import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { EditorProvider } from './contexts/EditorContext';
import { EditorWindowActivityProvider } from './contexts/EditorWindowActivityContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { EditorStatistics } from './components/editor/EditorStatistics';
import { EditorMagnetLibrary } from './components/editor/EditorMagnetLibrary';
import { StyleEditor } from './components/editor/StyleEditor';
import { EditorHelp } from './components/editor/EditorHelp';
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
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  broadcastSignal,
  setupConfigSync,
  setupTauriListener,
  setupTauriListenerWithPayload,
} from './utils/windowCommunication';
import './index.css';
import './components/editor/EditorStatistics.css';
import './components/editor/EditorMagnetLibrary.css';
import './components/editor/StyleEditor.css';
import './components/editor/EditorHelp.css';
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true); // 默认置顶

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

      const [statistics, library, style, help, background] = await Promise.all([
        getVisible('statistics'),
        getVisible('library'),
        getVisible('style'),
        getVisible('help'),
        getVisible('background'),
      ]);

      setStatisticsOpen(statistics);
      setLibraryOpen(library);
      setStyleOpen(style);
      setHelpOpen(help);
      setBackgroundOpen(background);
    } catch {
      // best-effort: visibility sync is non-critical
    }
  }, []);

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

  const handleToggleHelp = async () => {
    const newState = !helpOpen;
    setHelpOpen(newState);

    try {
      if (newState) {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import('./utils/editorWindows');
        const position = await calculateWindowPosition('help');
        await openEditorWindow({ type: 'help', ...position });
      } else {
        // 关闭窗口
        const { closeEditorWindow } = await import('./utils/editorWindows');
        await closeEditorWindow('help');
      }
    } catch (error) {
      console.error('Failed to toggle help window:', error);
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

      {/* 帮助开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${helpOpen ? 'active' : ''}`}
          onClick={handleToggleHelp}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">help</span>
      </div>
    </div>
  );
}

// 从 URL hash 立即解析窗口类型（避免首次渲染闪烁）
const getWindowTypeFromHash = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/#\/editor\/([\w-]+)/);
  return match ? match[1] : 'control';
};

export function EditorWindowApp() {
  const [windowType, setWindowType] = useState<string>(getWindowTypeFromHash());
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const isWindowActive = isWindowVisible && isDocumentVisible;
  const activityRef = useRef({ isWindowActive });
  activityRef.current.isWindowActive = isWindowActive;

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

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

    let cleanupPromise = setup();
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
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MAGNET_LIBRARY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_MAGNETS);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [builtInMagnetIds, setBuiltInMagnetIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BUILTIN_MAGNETS);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS);
      return saved ? JSON.parse(saved) : DEFAULT_BACKGROUND_SETTINGS;
    } catch {
      return DEFAULT_BACKGROUND_SETTINGS;
    }
  });
  const [isMaximized, setIsMaximized] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.IS_MAXIMIZED);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  // Creator 编辑模式数据
  const [creatorMode, setCreatorMode] = useState<'create' | 'edit'>('create');
  const [editingMagnet, setEditingMagnet] = useState<Magnet | undefined>(undefined);

  const reloadCreatorData = useCallback(() => {
    try {
      const mode = localStorage.getItem(STORAGE_KEYS.MAGNET_EDITOR_MODE) as
        | 'create'
        | 'edit'
        | null;
      const data = localStorage.getItem(STORAGE_KEYS.MAGNET_EDITOR_DATA);

      if (mode === 'edit' && data) {
        setCreatorMode('edit');
        setEditingMagnet(JSON.parse(data));
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

    let cleanupPromise = setup();
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

  // 从主窗口加载初始数据和监听更新
  useEffect(() => {
    const loadConfigFromMain = () => {
      try {
        // 从配置文件加载（支持 styleOverride）
        const config = loadConfig();
        if (config) {
          const applied = applyConfig(config, defaultMagnetLibrary);
          console.log(
            'EditorWindow: Config loaded, magnets:',
            applied.magnetLibrary.length,
            'active:',
            applied.activeMagnetIds.size
          );
          setMagnetLibrary(applied.magnetLibrary);
          setActiveMagnetIds(applied.activeMagnetIds);
        }

        // 加载其他辅助数据
        const builtInData = localStorage.getItem(STORAGE_KEYS.BUILTIN_MAGNETS);
        if (builtInData) {
          setBuiltInMagnetIds(new Set(JSON.parse(builtInData)));
        }

        const backgroundData = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS);
        if (backgroundData) {
          setBackgroundSettings(JSON.parse(backgroundData));
        }

        const maximizedData = localStorage.getItem(STORAGE_KEYS.IS_MAXIMIZED);
        if (maximizedData) {
          setIsMaximized(JSON.parse(maximizedData));
        }
      } catch (error) {
        console.error('Failed to load config from main window:', error);
      }
    };

    // 初始加载
    loadConfigFromMain();

    // 监听主窗口的配置更新
    let cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.CONFIG],
      [
        TAURI_EVENTS.MAGNET_LIBRARY_UPDATED,
        TAURI_EVENTS.MAGNET_ACTIVATED,
        TAURI_EVENTS.MAGNET_DEACTIVATED,
      ],
      () => {
        if (!activityRef.current.isWindowActive) return;
        console.log('Editor window: Received update signal, reloading config');
        loadConfigFromMain();
      }
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [defaultMagnetLibrary]);

  // Handlers
  const handleExitEditMode = async () => {
    try {
      // 通知主窗口退出编辑模式
      await broadcastSignal(TAURI_EVENTS.EDITOR_EXIT);
      await broadcastSignal(TAURI_EVENTS.EDITOR_STYLE_APPLY);

      // 关闭所有编辑器窗口
      const { closeAllEditorWindows } = await import('./utils/editorWindows');
      await closeAllEditorWindows();
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
    localStorage.setItem(STORAGE_KEYS.ACTIVE_MAGNETS, JSON.stringify([...newActive]));
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
    localStorage.setItem(STORAGE_KEYS.ACTIVE_MAGNETS, JSON.stringify([...newActive]));
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
    localStorage.setItem(STORAGE_KEYS.MAGNET_LIBRARY, JSON.stringify(newLibrary));
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
    localStorage.setItem(STORAGE_KEYS.MAGNET_LIBRARY, JSON.stringify(newLibrary));
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
    localStorage.setItem(STORAGE_KEYS.MAGNET_LIBRARY, JSON.stringify(newLibrary));
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
      const historyRaw = localStorage.getItem(STORAGE_KEYS.BACKGROUND_HISTORY);
      const history = historyRaw ? (JSON.parse(historyRaw) as Array<{ id: string; config: BackgroundConfig; timestamp: number }>) : [];
      const newItem = {
        id: `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        config,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEYS.BACKGROUND_HISTORY, JSON.stringify([newItem, ...history].slice(0, 20)));
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
	            <EditorWindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive }}>
	              <div className="editor-window-app">
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

            {windowType === 'help' && <EditorHelp />}

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
                  localStorage.removeItem(STORAGE_KEYS.MAGNET_EDITOR_MODE);
                  localStorage.removeItem(STORAGE_KEYS.MAGNET_EDITOR_DATA);
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
                    localStorage.removeItem(STORAGE_KEYS.MAGNET_EDITOR_MODE);
                    localStorage.removeItem(STORAGE_KEYS.MAGNET_EDITOR_DATA);
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
	            </EditorWindowActivityProvider>
	          </EditorProvider>
	        </NavigationProvider>
	      </AudioEngineProvider>
	    </ThemeProvider>
	  );
	}
