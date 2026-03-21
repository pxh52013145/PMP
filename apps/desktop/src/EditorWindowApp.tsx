import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useT } from './i18n';
import { EditorProvider } from './contexts/EditorContext';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { useAdaptiveRenderMode } from './contexts/useAdaptiveRenderMode';
import { QualityProvider } from './contexts/QualityContext';
import { useKernel } from './contexts/KernelContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { EditorStatistics } from './components/editor/EditorStatistics';
import { EditorMagnetLibrary } from './components/editor/EditorMagnetLibrary';
import { StyleBar } from './components/editor/StyleBar';
import { StyleBackgroundEffectPopup } from './components/editor/style/StyleBackgroundEffectPopup';
import { StyleBorderEffectPopup } from './components/editor/style/StyleBorderEffectPopup';
import { StyleCoverColorPopup } from './components/editor/style/StyleCoverColorPopup';
import { StylePixelPopup } from './components/editor/style/StylePixelPopup';
import { MagnetCreator } from './components/editor/MagnetCreator';
import { BackgroundManager } from './components/editor/BackgroundManager';
import { CustomBackgroundEditor } from './components/editor/CustomBackgroundEditor';
import { ThemeEditor } from './components/editor/ThemeEditor';
import { ThemeDebugPage } from './components/debug/ThemeDebugPage';
import { Magnet } from './types/pixel';
import { BackgroundSettings, BackgroundConfig } from './types/background';
import { DEFAULT_BACKGROUND_SETTINGS } from './constants/defaultBackground';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from './constants/magnets';
import { saveConfig, loadConfig, applyConfig, type MagnetConfig, type MagnetStateConfig } from './utils/configManager';
import {
  createDefaultMagnetLibrary,
  createDefaultMagnetSpaceLayout,
  createDefaultMagnetSpacesState,
  ensureMagnetCatalogState,
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  removeMagnetCatalogMagnet,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpacesState,
  ensureMagnetSpaceLayout,
  saveMagnetSpaceLayout,
  upsertMagnetCatalogMagnet,
  type MagnetSpaceLayout,
} from './modules/magnets';
import { MATRIX_CONFIG } from './constants/config';
import { isTauriRuntime } from './utils/tauriRuntime';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  broadcastSignal,
  setupConfigSync,
  setupStorageListener,
  setupTauriListener,
  setupTauriListenerWithPayload,
} from './utils/windowCommunication';
import { readJson, readString, removeKey, writeJson } from './modules/storage';
import { readWindowPinState, writeWindowPinState } from './utils/windowPinState';
import {
  resolveEditorSkinVariant,
  shouldMinimizeEditorSkinEffects,
  shouldPauseEditorSkinMotion,
} from './contracts/editorQualitySkin';
import { QUALITY_SERVICE_TOKEN, type QualityService } from './services/quality';
import { usePerformanceControlSettings } from './contexts/usePerformanceControlSettings';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import './index.css';
import './components/editor/EditorStatistics.css';
import './components/editor/EditorMagnetLibrary.css';
import './components/editor/EditorWindowApp.css';
import './components/editor/MagnetCreator.css';
import './components/editor/BackgroundManager.css';
import './components/editor/CustomBackgroundEditor.css';
import './components/editor/ThemeEditor.css';

const editorControlTelemetry = getTelemetryLogger('editor', 'EditorControlPanel');
const editorWindowTelemetry = getTelemetryLogger('editor', 'EditorWindowApp');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EditorControlPanelProps {
  onExitEditMode: () => void;
}

type ControlPanelToggleType = 'statistics' | 'library' | 'style' | 'theme' | 'background';

function EditorControlPanel({ onExitEditMode }: EditorControlPanelProps) {
  const t = useT();
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [pixelHintsVisible, setPixelHintsVisible] = useState(() =>
    readJson<boolean>(STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE, true)
  );
  const toggleInFlightRef = useRef<Record<ControlPanelToggleType, boolean>>({
    statistics: false,
    library: false,
    style: false,
    theme: false,
    background: false,
  });

  const applyEditorWindowsAlwaysOnTop = useCallback(async (value: boolean) => {
    const { appWindow, getAll } = await import('@tauri-apps/api/window');

    // Keep current control window strongly consistent with the toggle state.
    await appWindow.setAlwaysOnTop(value);

    const allWindows = getAll();

    for (const window of allWindows) {
      if (!window.label.startsWith('editor-') || window.label === appWindow.label) {
        continue;
      }

      try {
        await window.setAlwaysOnTop(value);
      } catch (error) {
        // Best-effort for auxiliary windows; the current control window state is authoritative.
        editorControlTelemetry.warn('editor.window.always-on-top.sync.failed', {
          message: getErrorMessage(error),
          fields: {
            targetWindow: window.label,
            value,
          },
        });
      }
    }
  }, []);

  const runWindowToggle = useCallback(
    async (type: ControlPanelToggleType, isOpen: boolean, setOpen: (open: boolean) => void) => {
      if (toggleInFlightRef.current[type]) return;

      const nextOpen = !isOpen;
      toggleInFlightRef.current[type] = true;
      setOpen(nextOpen);

      try {
        const { openEditorWindow, calculateWindowPosition, closeEditorWindow } = await import('./utils/editorWindows');

        if (nextOpen) {
          const position = await calculateWindowPosition(type);
          await openEditorWindow({ type, ...position });
        } else {
          await closeEditorWindow(type);
        }
      } catch (error) {
        setOpen(isOpen);
        editorControlTelemetry.error('editor.window.toggle.failed', {
          message: getErrorMessage(error),
          fields: {
            windowType: type,
            nextOpen,
          },
        });
      } finally {
        toggleInFlightRef.current[type] = false;
      }
    },
    []
  );

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
      case 'theme':
        setThemeOpen(open);
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

      const [statistics, library, style, theme, background] = await Promise.all([
        getVisible('statistics'),
        getVisible('library'),
        getVisible('style'),
        getVisible('theme'),
        getVisible('background'),
      ]);

      setStatisticsOpen(statistics);
      setLibraryOpen(library);
      setStyleOpen(style);
      setThemeOpen(theme);
      setBackgroundOpen(background);
    } catch {
      // best-effort: visibility sync is non-critical
    }
  }, []);

  const refreshPixelHintsVisible = useCallback(() => {
    setPixelHintsVisible(readJson<boolean>(STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE, true));
  }, []);

  useEffect(() => {
    let disposed = false;
    refreshPixelHintsVisible();

    const teardownStorage = setupStorageListener(
      [STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE],
      refreshPixelHintsVisible
    );

    let unlistenTauri: (() => void) | null = null;
    const setup = async () => {
      const unlisten = await setupTauriListener(
        TAURI_EVENTS.EDITOR_OVERLAY_PIXEL_HINTS_UPDATED,
        refreshPixelHintsVisible
      );
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    };
    void setup();

    return () => {
      disposed = true;
      teardownStorage();
      if (unlistenTauri) unlistenTauri();
    };
  }, [refreshPixelHintsVisible]);

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
            setThemeOpen(false);
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
            setThemeOpen(false);
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

  useEffect(() => {
    let disposed = false;

    const syncAndApplyPinnedPreference = async () => {
      if (!isTauriRuntime()) return;

      const preferredPinned = readWindowPinState();
      if (typeof preferredPinned === 'boolean') {
        if (!disposed) {
          setIsAlwaysOnTop(preferredPinned);
        }

        try {
          await applyEditorWindowsAlwaysOnTop(preferredPinned);
        } catch (error) {
          editorControlTelemetry.warn('editor.window.always-on-top.persisted-apply.failed', {
            message: getErrorMessage(error),
            fields: {
              value: preferredPinned,
            },
          });
        }
        return;
      }

      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        const resolvedPinned = await (
          (appWindow as typeof appWindow & {
            isAlwaysOnTop?: () => Promise<boolean>;
          }).isAlwaysOnTop?.() ?? Promise.resolve(false)
        ).catch(() => false);
        if (!disposed) {
          setIsAlwaysOnTop(Boolean(resolvedPinned));
        }
        writeWindowPinState(Boolean(resolvedPinned));
      } catch {
        // best-effort: pin state sync is non-critical
      }
    };

    void syncAndApplyPinnedPreference();

    return () => {
      disposed = true;
    };
  }, [applyEditorWindowsAlwaysOnTop]);

  const handleToggleStatistics = () => {
    void runWindowToggle('statistics', statisticsOpen, setStatisticsOpen);
  };

  const handleToggleLibrary = () => {
    void runWindowToggle('library', libraryOpen, setLibraryOpen);
  };

  const handleToggleStyle = () => {
    void runWindowToggle('style', styleOpen, setStyleOpen);
  };

  const handleToggleTheme = () => {
    void runWindowToggle('theme', themeOpen, setThemeOpen);
  };

  const handleToggleBackground = () => {
    void runWindowToggle('background', backgroundOpen, setBackgroundOpen);
  };

  // 切换所有编辑器窗口的置顶状态
  const handleTogglePixelHints = (e: React.MouseEvent<HTMLButtonElement>) => {
    const newState = !pixelHintsVisible;
    setPixelHintsVisible(newState);
    e.currentTarget.blur();

    void broadcastDataUpdate(
      STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE,
      newState,
      TAURI_EVENTS.EDITOR_OVERLAY_PIXEL_HINTS_UPDATED
      );
  };

  const handleUndoLayout = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    void broadcastSignal(TAURI_EVENTS.EDITOR_LAYOUT_UNDO);
  };

  const handleRedoLayout = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    void broadcastSignal(TAURI_EVENTS.EDITOR_LAYOUT_REDO);
  };

  const handleToggleAlwaysOnTop = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const previousState = isAlwaysOnTop;
    const newState = !isAlwaysOnTop;
    setIsAlwaysOnTop(newState);

    // 立即移除焦点，防止填满效果残留
    e.currentTarget.blur();

    try {
      await applyEditorWindowsAlwaysOnTop(newState);

      writeWindowPinState(newState);
    } catch (error) {
      setIsAlwaysOnTop(previousState);
      editorControlTelemetry.error('editor.window.always-on-top.toggle.failed', {
        message: getErrorMessage(error),
        fields: {
          value: newState,
        },
      });
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

      <div className="control-top-actions">
        {/* 布局历史（撤回/恢复） */}
        <div className="control-layout-history-group">
          <button
            className="cyber-btn layout-undo-btn"
            onClick={handleUndoLayout}
            title={t('editor.control-panel.undo.title')}
            aria-label={t('editor.control-panel.undo.title')}
          >
            <span className="btn-text">{'\u21b6'}</span>
          </button>
          <button
            className="cyber-btn layout-redo-btn"
            onClick={handleRedoLayout}
            title={t('editor.control-panel.redo.title')}
            aria-label={t('editor.control-panel.redo.title')}
          >
            <span className="btn-text">{'\u21b7'}</span>
          </button>
        </div>

        {/* 完成编辑按钮（由左右两侧按钮包裹） */}
        <div className="control-button-group">
          <button
            className={`cyber-btn matrix-hints-btn ${pixelHintsVisible ? 'active' : ''}`}
            onClick={handleTogglePixelHints}
            title={
              pixelHintsVisible
                ? t('editor.control-panel.pixelHints.title.hide')
                : t('editor.control-panel.pixelHints.title.show')
            }
            aria-label={
              pixelHintsVisible
                ? t('editor.control-panel.pixelHints.title.hide')
                : t('editor.control-panel.pixelHints.title.show')
            }
          >
            <span className="btn-text"></span>
          </button>
          <button className="cyber-btn exit-cyber-btn" onClick={onExitEditMode}>
            <span className="btn-text">{t('common.action.done')}</span>
          </button>
          <button
            className={`cyber-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
            onClick={handleToggleAlwaysOnTop}
            title={
              isAlwaysOnTop ? t('editor.control-panel.pin.title.unpin') : t('editor.control-panel.pin.title.pin')
            }
          >
            <span className="btn-text"></span>
          </button>
        </div>
      </div>

      {/* 统计开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${statisticsOpen ? 'active' : ''}`}
          onClick={handleToggleStatistics}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">{t('editor.control-panel.toggle.statistics.label')}</span>
      </div>

      {/* Magnet 库开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${libraryOpen ? 'active' : ''}`}
          onClick={handleToggleLibrary}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">{t('editor.control-panel.toggle.library.label')}</span>
      </div>

      {/* 风格设置开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${styleOpen ? 'active' : ''}`}
          onClick={handleToggleStyle}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">{t('editor.control-panel.toggle.style.label')}</span>
      </div>

      {/* 背景管理开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${backgroundOpen ? 'active' : ''}`}
          onClick={handleToggleBackground}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">{t('editor.control-panel.toggle.background.label')}</span>
      </div>

      {/* Theme Editor 开关 */}
      <div className="switch-container">
        <button
          className={`cyber-switch-btn ${themeOpen ? 'active' : ''}`}
          onClick={handleToggleTheme}
        >
          <span className="switch-indicator"></span>
        </button>
        <span className="glow-label">{t('editor.control-panel.toggle.theme.label')}</span>
      </div>
    </div>
  );
}

function readActiveMagnetSpaceId(): string {
  const raw = readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState());
  return sanitizeMagnetSpacesState(raw).activeSpaceId;
}

function buildMagnetSpaceLayoutSnapshot(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>
): MagnetSpaceLayout {
  const active = new Set(activeMagnetIds);
  for (const id of REQUIRED_MAGNET_IDS) active.add(id);

  const anchorsByMagnetId: Record<string, MagnetStateConfig['anchors']> = {};
  for (const magnet of magnetLibrary) {
    if (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) continue;
    anchorsByMagnetId[magnet.id] = magnet.anchors;
  }

  return {
    version: 1,
    activeMagnetIds: [...active],
    anchorsByMagnetId,
  };
}

// 从 URL hash 立即解析窗口类型（避免首次渲染闪烁）
const getWindowTypeFromHash = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/#\/editor\/([\w-]+)/);
  const raw = match ? match[1] : 'control';
  return raw === 'help' ? 'debug' : raw;
};

export function EditorWindowApp() {
  const kernel = useKernel();
  const qualityService = useMemo(
    () => kernel.services.get(QUALITY_SERVICE_TOKEN) as QualityService,
    [kernel]
  );
  const { settings: performanceSettings } = usePerformanceControlSettings();
  const [windowType, setWindowType] = useState<string>(getWindowTypeFromHash());
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isPageFrozen, setIsPageFrozen] = useState(false);
  const editorLowPerformanceMode = performanceSettings.editorLowPerformanceMode;
  const backgroundRenderPolicy = performanceSettings.backgroundRenderPolicy;
  const [qualityLevel, setQualityLevel] = useState(() => qualityService.getSnapshot().effective.level);
  const isWindowActive = isWindowVisible && isDocumentVisible && !isWindowMinimized && !isPageFrozen && isWindowFocused;
  const activityRef = useRef({ isWindowActive });
  activityRef.current.isWindowActive = isWindowActive;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const effectsReadyRef = useRef(false);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const needsMagnetConfigSync =
    windowType === 'library' || windowType === 'statistics' || windowType === 'creator';

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    setQualityLevel(qualityService.getSnapshot().effective.level);
    return kernel.events.on('quality/changed', (next) => {
      setQualityLevel(next.effective.level);
    });
  }, [kernel.events, qualityService]);

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
          editorWindowTelemetry.warn('editor.window.focus.subscribe.failed', {
            message: getErrorMessage(error),
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

    const setup = async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window');

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
  const defaultMagnetLibrary = useMemo(() => createDefaultMagnetLibrary(), []);

  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(defaultMagnetLibrary);
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(
    () => new Set([...DEFAULT_ACTIVE_MAGNET_IDS, ...REQUIRED_MAGNET_IDS])
  );
  const builtInMagnetIds = useMemo(() => new Set(BUILTIN_MAGNET_IDS), []);
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
      editorWindowTelemetry.error('editor.creator-data.load.failed', {
        message: getErrorMessage(error),
      });
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
    const loadConfigFromMain = async () => {
      try {
        if (needsMagnetConfigSync) {
          let activeSpaceId = readActiveMagnetSpaceId();
          let layout = ensureMagnetSpaceLayout(activeSpaceId, {
            defaultActiveMagnetIds: DEFAULT_ACTIVE_MAGNET_IDS,
          }).layout;

          if (isTauri) {
            const bootstrapped = await magnetLayoutStoreBootstrap();
            const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
            if (store) {
              activeSpaceId = store.spaces.activeSpaceId;
              layout =
                store.layoutsBySpaceId[activeSpaceId] ??
                createDefaultMagnetSpaceLayout(activeSpaceId, DEFAULT_ACTIVE_MAGNET_IDS);
            }
          }

          const catalogMagnets = ensureMagnetCatalogState().state.magnets;
          const activeFromLayout = new Set(layout.activeMagnetIds);
          for (const id of REQUIRED_MAGNET_IDS) activeFromLayout.add(id);

          // 从配置文件加载（支持 styleOverride），但 anchors/isActive 以 layout 为准
          const configKey = resolveMagnetConfigStorageKey(activeSpaceId);
          const config = loadConfig(configKey);
          const baseConfig: MagnetConfig = config
            ? { ...config, customMagnets: catalogMagnets }
            : {
                version: '1.1.0',
                gridSize: { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
                magnets: {},
                customMagnets: catalogMagnets,
              };

          const patchedMagnets: Record<string, MagnetStateConfig> = { ...baseConfig.magnets };
          const patchMagnet = (magnet: Magnet) => {
            const existing = patchedMagnets[magnet.id];
            patchedMagnets[magnet.id] = {
              ...(existing ?? { anchors: magnet.anchors, isActive: false }),
              anchors: layout.anchorsByMagnetId[magnet.id] ?? existing?.anchors ?? magnet.anchors,
              isActive: activeFromLayout.has(magnet.id),
            };
          };

          defaultMagnetLibrary.forEach(patchMagnet);
          catalogMagnets.forEach(patchMagnet);

          const applied = applyConfig(
            { ...baseConfig, gridSize: { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS }, magnets: patchedMagnets },
            defaultMagnetLibrary
          );
          setMagnetLibrary(applied.magnetLibrary);
          const ensuredActive = new Set(applied.activeMagnetIds);
          for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);
          setActiveMagnetIds(ensuredActive);
        }

        const backgroundData = readJson<BackgroundSettings | null>(STORAGE_KEYS.BACKGROUND_SETTINGS, null);
        if (backgroundData) setBackgroundSettings(backgroundData);

        const maximizedData = readJson<boolean | null>(STORAGE_KEYS.IS_MAXIMIZED, null);
        if (maximizedData !== null) setIsMaximized(maximizedData);
        } catch (error) {
          editorWindowTelemetry.error('editor.config.load-from-main.failed', {
            message: getErrorMessage(error),
            fields: {
              windowType,
            },
          });
        }
    };

    // 初始加载
    void loadConfigFromMain();

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
          await loadConfigFromMain();
        } finally {
          reloadInFlight = false;
        }
      }, 60);
    };

      const cleanupPromise = setupConfigSync(
        [STORAGE_KEYS.CONFIG, STORAGE_KEYS.MAGNET_SPACES, STORAGE_KEYS.MAGNET_SPACE_LAYOUT, STORAGE_KEYS.MAGNET_CATALOG],
        [
          TAURI_EVENTS.MAGNET_LIBRARY_UPDATED,
          TAURI_EVENTS.MAGNET_ACTIVATED,
          TAURI_EVENTS.MAGNET_DEACTIVATED,
          TAURI_EVENTS.MAGNET_SPACES_UPDATED,
          TAURI_EVENTS.MAGNET_LAYOUT_STORE_UPDATED,
        ],
        () => {
          scheduleReload();
        }
      );

    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [defaultMagnetLibrary, isTauri, needsMagnetConfigSync]);

  // Handlers
  const handleExitEditMode = async () => {
    try {
      await broadcastSignal(TAURI_EVENTS.EDITOR_STYLE_APPLY);

      // 关闭所有编辑器窗口
      const { closeEditorWindow } = await import('./utils/editorWindows');
      await closeEditorWindow('control');
    } catch (error) {
      editorWindowTelemetry.error('editor.exit-edit-mode.failed', {
        message: getErrorMessage(error),
      });
    }
  };


  const handleMagnetActivate = async (magnetId: string) => {
    await broadcastDataUpdate(
      STORAGE_KEYS.MAGNET_PLACEMENT_REQUEST_V1,
      {
        requestId: `place-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        magnetId,
        createdAt: Date.now(),
      },
      TAURI_EVENTS.MAGNET_PLACEMENT_REQUESTED
    );
  };

  const handleMagnetDeactivate = async (magnetId: string) => {
    if (REQUIRED_MAGNET_IDS.has(magnetId)) {
      editorWindowTelemetry.debug('editor.magnet.deactivate.skipped-required', {
        fields: {
          magnetId,
        },
      });
      return;
    }
    const newActive = new Set(activeMagnetIds);
    newActive.delete(magnetId);
    setActiveMagnetIds(newActive);

    let activeSpaceId = readActiveMagnetSpaceId();

    if (isTauri) {
      const bootstrapped = await magnetLayoutStoreBootstrap();
      const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (store) {
        activeSpaceId = store.spaces.activeSpaceId;
        const response = await magnetLayoutStoreApplyPatchWithRetry(
          {
            expectedRevision: store.revision,
            patches: [{ kind: 'setMagnetActive', spaceId: activeSpaceId, magnetId, active: false }],
            reason: 'deactivateMagnet',
          },
          { maxRetries: 2 }
        );
        if (!response?.ok) {
          editorWindowTelemetry.warn('editor.magnet.deactivate.persist.failed', {
            message: String(response?.error ?? response),
            fields: {
              magnetId,
              spaceId: activeSpaceId,
            },
          });
        }
      }
    } else {
      // Save per-space layout (source of truth for active + anchors)
      saveMagnetSpaceLayout(
        buildMagnetSpaceLayoutSnapshot(magnetLibrary, newActive),
        resolveMagnetLayoutStorageKey(activeSpaceId)
      );
    }

    // 保存配置并广播
    saveConfig(
      magnetLibrary,
      newActive,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary,
      resolveMagnetConfigStorageKey(activeSpaceId),
      { includeCustomMagnets: false }
    );
    if (!isTauri) {
      await broadcastSignal(TAURI_EVENTS.MAGNET_DEACTIVATED);
    }
    editorWindowTelemetry.info('editor.magnet.deactivated', {
      fields: {
        magnetId,
        activeCount: newActive.size,
      },
    });
  };

  const handleMagnetDeleteFromLibrary = async (magnetId: string) => {
    const newLibrary = magnetLibrary.filter((m) => m.id !== magnetId);
    setMagnetLibrary(newLibrary);

    removeMagnetCatalogMagnet(magnetId);

    let activeSpaceId = readActiveMagnetSpaceId();
    const nextLayout = buildMagnetSpaceLayoutSnapshot(newLibrary, activeMagnetIds);

    if (isTauri) {
      const bootstrapped = await magnetLayoutStoreBootstrap();
      const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (store) {
        activeSpaceId = store.spaces.activeSpaceId;
        const response = await magnetLayoutStoreApplyPatchWithRetry(
          {
            expectedRevision: store.revision,
            patches: [{ kind: 'setSpaceLayout', spaceId: activeSpaceId, layout: nextLayout }],
            reason: 'deleteMagnetFromLibrary',
          },
          { maxRetries: 2 }
        );
        if (!response?.ok) {
          editorWindowTelemetry.warn('editor.magnet.delete.persist.failed', {
            message: String(response?.error ?? response),
            fields: {
              magnetId,
              spaceId: activeSpaceId,
            },
          });
        }
      }
    } else {
      saveMagnetSpaceLayout(nextLayout, resolveMagnetLayoutStorageKey(activeSpaceId));
    }

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary,
      resolveMagnetConfigStorageKey(activeSpaceId),
      { includeCustomMagnets: false }
    );
    if (!isTauri) {
      await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    }
    editorWindowTelemetry.info('editor.magnet.deleted', {
      fields: {
        magnetId,
        librarySize: newLibrary.length,
      },
    });
  };

  const handleMagnetAddToLibrary = async (magnet: Magnet) => {
    const newLibrary = [...magnetLibrary, magnet];
    setMagnetLibrary(newLibrary);

    upsertMagnetCatalogMagnet(magnet);

    let activeSpaceId = readActiveMagnetSpaceId();
    const nextLayout = buildMagnetSpaceLayoutSnapshot(newLibrary, activeMagnetIds);

    if (isTauri) {
      const bootstrapped = await magnetLayoutStoreBootstrap();
      const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (store) {
        activeSpaceId = store.spaces.activeSpaceId;
        const response = await magnetLayoutStoreApplyPatchWithRetry(
          {
            expectedRevision: store.revision,
            patches: [{ kind: 'setSpaceLayout', spaceId: activeSpaceId, layout: nextLayout }],
            reason: 'addMagnetToLibrary',
          },
          { maxRetries: 2 }
        );
        if (!response?.ok) {
          editorWindowTelemetry.warn('editor.magnet.add.persist.failed', {
            message: String(response?.error ?? response),
            fields: {
              magnetId: magnet.id,
              spaceId: activeSpaceId,
            },
          });
        }
      }
    } else {
      saveMagnetSpaceLayout(nextLayout, resolveMagnetLayoutStorageKey(activeSpaceId));
    }

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary,
      resolveMagnetConfigStorageKey(activeSpaceId),
      { includeCustomMagnets: false }
    );
    if (!isTauri) {
      await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    }
    editorWindowTelemetry.info('editor.magnet.added', {
      fields: {
        magnetId: magnet.id,
        librarySize: newLibrary.length,
      },
    });
  };

  const handleMagnetUpdate = async (magnet: Magnet) => {
    const newLibrary = magnetLibrary.map((m) => (m.id === magnet.id ? magnet : m));
    setMagnetLibrary(newLibrary);

    upsertMagnetCatalogMagnet(magnet);

    let activeSpaceId = readActiveMagnetSpaceId();
    const nextLayout = buildMagnetSpaceLayoutSnapshot(newLibrary, activeMagnetIds);

    if (isTauri) {
      const bootstrapped = await magnetLayoutStoreBootstrap();
      const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (store) {
        activeSpaceId = store.spaces.activeSpaceId;
        const response = await magnetLayoutStoreApplyPatchWithRetry(
          {
            expectedRevision: store.revision,
            patches: [{ kind: 'setSpaceLayout', spaceId: activeSpaceId, layout: nextLayout }],
            reason: 'updateMagnetInLibrary',
          },
          { maxRetries: 2 }
        );
        if (!response?.ok) {
          editorWindowTelemetry.warn('editor.magnet.update.persist.failed', {
            message: String(response?.error ?? response),
            fields: {
              magnetId: magnet.id,
              spaceId: activeSpaceId,
            },
          });
        }
      }
    } else {
      saveMagnetSpaceLayout(nextLayout, resolveMagnetLayoutStorageKey(activeSpaceId));
    }

    // 保存配置并广播
    saveConfig(
      newLibrary,
      activeMagnetIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary,
      resolveMagnetConfigStorageKey(activeSpaceId),
      { includeCustomMagnets: false }
    );
    if (!isTauri) {
      await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
    }
    editorWindowTelemetry.info('editor.magnet.updated', {
      fields: {
        magnetId: magnet.id,
        librarySize: newLibrary.length,
      },
    });
  };

  const handleApplyRendererBindings = useCallback(
    async (bindings: Array<{ magnetId: string; rendererId: string }>): Promise<{ updated: number }> => {
      const bindingByMagnetId = new Map<string, string>();
      for (const binding of bindings) {
        const magnetId = typeof binding.magnetId === 'string' ? binding.magnetId.trim() : '';
        const rendererId = typeof binding.rendererId === 'string' ? binding.rendererId.trim() : '';
        if (!magnetId || !rendererId) continue;
        bindingByMagnetId.set(magnetId, rendererId);
      }

      if (bindingByMagnetId.size === 0) return { updated: 0 };

      let updated = 0;
      const nextLibrary = magnetLibrary.map((magnet) => {
        const rendererId = bindingByMagnetId.get(magnet.id);
        if (!rendererId) return magnet;
        const nextRenderer = rendererId === magnet.id ? undefined : rendererId;
        if (magnet.renderer === nextRenderer) return magnet;
        updated += 1;
        return { ...magnet, renderer: nextRenderer };
      });

      if (updated === 0) return { updated: 0 };

      setMagnetLibrary(nextLibrary);

      let activeSpaceId = readActiveMagnetSpaceId();
      if (isTauri) {
        const bootstrapped = await magnetLayoutStoreBootstrap();
        const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
        if (store) {
          activeSpaceId = store.spaces.activeSpaceId;
        }
      }
      saveConfig(
        nextLibrary,
        activeMagnetIds,
        { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
        defaultMagnetLibrary,
        resolveMagnetConfigStorageKey(activeSpaceId),
        { includeCustomMagnets: false }
      );
      await broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);

      return { updated };
    },
    [activeMagnetIds, defaultMagnetLibrary, isTauri, magnetLibrary]
  );

  const handleBackgroundSettingsChange = async (settings: BackgroundSettings) => {
    setBackgroundSettings(settings);
    await broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      settings,
      TAURI_EVENTS.BACKGROUND_UPDATED
    );
  };

  const handleCustomBackgroundSave = async (config: BackgroundConfig) => {
    editorWindowTelemetry.debug('editor.background.custom.save.requested', {
      fields: {
        isMaximized,
      },
    });

    // 保存自定义背景到当前模式
    const newSettings = {
      ...backgroundSettings,
      [isMaximized ? 'maximized' : 'windowed']: config,
    };

    setBackgroundSettings(newSettings);

    // 使用统一的广播机制
    await broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_SETTINGS,
      newSettings,
      TAURI_EVENTS.BACKGROUND_UPDATED
    );
    editorWindowTelemetry.info('editor.background.custom.save.completed', {
      fields: {
        targetMode: isMaximized ? 'maximized' : 'windowed',
      },
    });

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
      editorWindowTelemetry.warn('editor.background.history.auto-add.failed', {
        message: getErrorMessage(error),
      });
    }

    // 关闭自定义背景编辑窗口
    import('./utils/editorWindows').then(({ closeEditorWindow }) => {
      closeEditorWindow('custom-background');
      editorWindowTelemetry.debug('editor.background.custom.window.close.requested');
    });
  };

  // 获取当前激活的 magnets
  const activeMagnets = useMemo(() => {
    return magnetLibrary.filter((magnet) => activeMagnetIds.has(magnet.id));
  }, [magnetLibrary, activeMagnetIds]);

  const renderMode = useAdaptiveRenderMode({
    isWindowVisible,
    isDocumentVisible,
    isWindowFocused,
    isWindowMinimized,
    isPageFrozen,
    backgroundRenderPolicy,
  });

  const editorSkinVariant = resolveEditorSkinVariant(qualityLevel, editorLowPerformanceMode);
  const editorSkinMotionPaused = shouldPauseEditorSkinMotion(renderMode);
  const editorSkinEffectsReduced = shouldMinimizeEditorSkinEffects(
    qualityLevel,
    editorLowPerformanceMode
  );

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <NavigationProvider>
          <EditorProvider magnets={activeMagnets}>
            <WindowActivityProvider value={{ isVisible: isWindowVisible, isActive: isWindowActive, renderMode }}>
              <QualityProvider>
                <div
                className={`editor-window-app ${windowType === 'control' ? 'editor-window-app--control' : ''} ${windowType === 'style' ? 'editor-window-app--style-bar' : ''} ${isTauri ? 'editor-window-app--tauri' : ''} ${editorLowPerformanceMode ? 'editor-window-app--low-performance' : ''} editor-window-app--skin-${editorSkinVariant} ${editorSkinMotionPaused ? 'editor-window-app--motion-paused' : ''} ${editorSkinEffectsReduced ? 'editor-window-app--effects-reduced' : ''}`}
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
                onMagnetUpdate={handleMagnetUpdate}
                onMagnetActivate={handleMagnetActivate}
                onMagnetDeactivate={handleMagnetDeactivate}
                onMagnetDeleteFromLibrary={handleMagnetDeleteFromLibrary}
              />
            )}

            {windowType === 'style' && <StyleBar />}

            {windowType === 'style-pixel' && <StylePixelPopup />}
            {windowType === 'style-cover-color' && <StyleCoverColorPopup />}
            {windowType === 'style-background-effect' && <StyleBackgroundEffectPopup />}
            {windowType === 'style-border-effect' && <StyleBorderEffectPopup />}


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
                    editorWindowTelemetry.error('editor.creator.window.close.failed', {
                      message: getErrorMessage(error),
                    });
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

            {windowType === 'theme' && (
              <ThemeEditor
                magnetLibrary={magnetLibrary}
                applyRendererBindings={handleApplyRendererBindings}
              />
            )}

                {windowType === 'debug' && <ThemeDebugPage />}
              </div>
              </QualityProvider>
            </WindowActivityProvider>
          </EditorProvider>
        </NavigationProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
