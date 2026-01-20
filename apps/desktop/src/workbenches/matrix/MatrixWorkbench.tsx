import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  setupTauriListener,
} from '../../utils/windowCommunication';
import Background from '../../components/core/Background';
import PixelMatrixCanvas from '../../components/core/PixelMatrixCanvas';
import WindowBorder from '../../components/core/WindowBorder';
import MatrixRainEffect from '../../components/effects/MatrixRainEffect';
import { MagnetLayer } from '../../components/magnet/MagnetLayer';
import { EditorOverlay } from '../../components/core/EditorOverlay';
import { EditorPanel } from '../../components/core/EditorPanel';
import { useEditor } from '../../contexts/EditorContext';
import { PixelAnchor } from '../../types/pixel';
import { BackgroundSettings } from '../../types/background';
import { DEFAULT_BACKGROUND_SETTINGS } from '../../constants/defaultBackground';
import { calculateWindowPosition } from '../../utils/editorWindows';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import {
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreGetState,
  type MagnetSpaceHistoryItem,
  type MagnetSpaceLayout,
  useMagnetConfig,
} from '../../modules/magnets';
import { readJson, readString, writeJson } from '../../modules/storage';
import { gcOrphanBackgroundMedia } from '../../modules/background/mediaCleanup';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { useWindowClose } from '../../contexts/WindowCloseContext';

type BackgroundThemeColor = { id: string; rgb: [number, number, number] };
const DEFAULT_BACKGROUND_THEME_COLOR: BackgroundThemeColor = { id: 'cyan', rgb: [0, 255, 136] };

export type MatrixWorkbenchProps = {
  showEditorOverlay: boolean;
  showEditorPanel: boolean;
  showWindowBorder: boolean;
};

export function MatrixWorkbench({
  showEditorOverlay,
  showEditorPanel,
  showWindowBorder,
}: MatrixWorkbenchProps) {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { requestMainWindowClose } = useWindowClose();

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

  const { editorState, toggleEditMode, exitEditMode, updateOccupancy } = useEditor();
  const { magnetLibrary, activeMagnetIds, activeSpaceId, updateMagnetAnchors } = useMagnetConfig();

  const buildHistorySnapshotLayout = useCallback((): MagnetSpaceLayout => {
    const active = new Set(activeMagnetIds);
    for (const id of REQUIRED_MAGNET_IDS) active.add(id);

    const anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {};
    for (const magnet of magnetLibrary) {
      if (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) continue;
      anchorsByMagnetId[magnet.id] = magnet.anchors.map((anchor) => ({ ...anchor }));
    }

    return { version: 1, activeMagnetIds: [...active], anchorsByMagnetId };
  }, [activeMagnetIds, magnetLibrary]);

  const pushEditEntryHistory = useCallback(async (): Promise<void> => {
    const item: MagnetSpaceHistoryItem = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      reason: 'enterEdit',
      createdAt: Date.now(),
      layout: buildHistorySnapshotLayout(),
    };

    if (!isTauri) {
      const historyState = readJson<Record<string, MagnetSpaceHistoryItem[]>>(
        STORAGE_KEYS.MAGNET_SPACE_HISTORY,
        {}
      );
      const existing = Array.isArray(historyState[activeSpaceId]) ? historyState[activeSpaceId] : [];
      const nextList = [...existing, item];
      if (nextList.length > 20) nextList.splice(0, nextList.length - 20);
      writeJson(STORAGE_KEYS.MAGNET_SPACE_HISTORY, { ...historyState, [activeSpaceId]: nextList });
      return;
    }

    const state = await magnetLayoutStoreGetState();
    const expectedRevision = state?.revision ?? 0;
    if (expectedRevision <= 0) return;

    const patches = [{ kind: 'pushSpaceHistory', spaceId: activeSpaceId, item }] as const;
    const response = await magnetLayoutStoreApplyPatch({
      expectedRevision,
      patches: [...patches],
      reason: 'enterEdit',
    });
    if (!response) return;
    if (response.ok) return;
    if (response.error?.code !== 'revisionConflict') return;

    const retryRevision = response.state.revision;
    if (retryRevision <= 0 || retryRevision === expectedRevision) return;
    await magnetLayoutStoreApplyPatch({
      expectedRevision: retryRevision,
      patches: [...patches],
      reason: 'enterEdit:retry',
    });
  }, [activeSpaceId, buildHistorySnapshotLayout, isTauri]);

  type LayoutUndoEntry = { magnetId: string; from: PixelAnchor[]; to: PixelAnchor[] };
  const undoStackRef = useRef<LayoutUndoEntry[]>([]);
  const redoStackRef = useRef<LayoutUndoEntry[]>([]);

  const editHistoryCapturedRef = useRef(false);
  useEffect(() => {
    if (!editorState.isEditing) {
      editHistoryCapturedRef.current = false;
      return;
    }
    if (editHistoryCapturedRef.current) return;
    editHistoryCapturedRef.current = true;
    void pushEditEntryHistory();
  }, [editorState.isEditing, pushEditEntryHistory]);

  useEffect(() => {
    if (editorState.isEditing) return;
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [editorState.isEditing]);

  const undoLastMove = useCallback(() => {
    if (!editorState.isEditing) return;
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    redoStackRef.current.push(entry);
    updateMagnetAnchors(entry.magnetId, entry.from);
  }, [editorState.isEditing, updateMagnetAnchors]);

  const redoLastMove = useCallback(() => {
    if (!editorState.isEditing) return;
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    undoStackRef.current.push(entry);
    updateMagnetAnchors(entry.magnetId, entry.to);
  }, [editorState.isEditing, updateMagnetAnchors]);

  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();

    // 防止上下文菜单
    document.addEventListener('contextmenu', preventDefault);

    // 禁用默认的拖放行为
    document.addEventListener('drop', preventDefault);
    document.addEventListener('dragover', preventDefault);

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
  }, [isTauri]);

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

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const setup = async () => {
      const unlistenUndo = await setupTauriListener(TAURI_EVENTS.EDITOR_LAYOUT_UNDO, () => {
        if (disposed) return;
        undoLastMove();
      });
      const unlistenRedo = await setupTauriListener(TAURI_EVENTS.EDITOR_LAYOUT_REDO, () => {
        if (disposed) return;
        redoLastMove();
      });
      return () => {
        unlistenUndo();
        unlistenRedo();
      };
    };

    const cleanupPromise = setup();
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri, redoLastMove, undoLastMove]);

  // 获取当前激活的 Magnet（显示在点阵上的）
  const activeMagnets = useMemo(() => {
    const filtered = magnetLibrary
      .filter((m) => activeMagnetIds.has(m.id))
      .map((m) => {
        // 为编辑器按钮绑定切换函数
        if (m.id === 'drag-handle') {
          return {
            ...m,
            interactions: {
              ...m.interactions,
              onDrag: () => {
                if (!isTauri) return;
                appWindow.startDragging();
              },
            },
          };
        }

        if (m.id === 'btn-minimize') {
          return {
            ...m,
            interactions: {
              ...m.interactions,
              onClick: () => {
                if (!isTauri) return;
                void appWindow.minimize();
              },
            },
          };
        }

        if (m.id === 'btn-maximize') {
          return {
            ...m,
            interactions: {
              ...m.interactions,
              onClick: async () => {
                if (!isTauri) return;
                const maximized = await appWindow.isMaximized();
                if (maximized) {
                  void appWindow.unmaximize();
                } else {
                  void appWindow.maximize();
                }
              },
            },
          };
        }

        if (m.id === 'btn-close') {
          return {
            ...m,
            interactions: {
              ...m.interactions,
              onClick: () => {
                if (!isTauri) return;
                requestMainWindowClose('magnet');
              },
            },
          };
        }

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
  }, [activeMagnetIds, isTauri, magnetLibrary, requestMainWindowClose, toggleEditMode]);

  // 更新占用信息
  useEffect(() => {
    updateOccupancy(activeMagnets);
  }, [activeMagnets, updateOccupancy]);

  // 处理 Magnet 移动（只更新库中的 Magnet）
  const handleMagnetMove = useCallback(
    (magnetId: string, newAnchors: PixelAnchor[]) => {
      const current = magnetLibrary.find((m) => m.id === magnetId);
      const from = current?.anchors ?? [];
      if (editorState.isEditing && from.length > 0 && newAnchors.length > 0) {
        const entry: LayoutUndoEntry = {
          magnetId,
          from: from.map((a) => ({ ...a })),
          to: newAnchors.map((a) => ({ ...a })),
        };
        undoStackRef.current.push(entry);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
      updateMagnetAnchors(magnetId, newAnchors);
    },
    [editorState.isEditing, magnetLibrary, updateMagnetAnchors]
  );

  // 根据窗口状态选择背景配置
  const currentBackground = isMaximized ? backgroundSettings.maximized : backgroundSettings.windowed;

  return (
    <>
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
      {showEditorOverlay && pixelPositions.size > 0 && (
        <EditorOverlay
          pixelPositions={pixelPositions}
          magnets={activeMagnets}
          onMagnetMove={handleMagnetMove}
        />
      )}

      {/* 编辑器面板 */}
      {showEditorPanel && <EditorPanel />}

      {/* 窗口边框 */}
      {showWindowBorder && <WindowBorder />}
    </>
  );
}
