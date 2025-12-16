import { useEffect, useState, useMemo, useCallback } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  setupTauriListener,
} from './utils/windowCommunication';
import Background from './components/core/Background';
import PixelMatrixCanvas from './components/core/PixelMatrixCanvas';
import WindowBorder from './components/core/WindowBorder';
import MatrixRainEffect from './components/effects/MatrixRainEffect';
import { MagnetLayer } from './components/magnet/MagnetLayer';
import { EditorOverlay } from './components/core/EditorOverlay';
import { EditorPanel } from './components/core/EditorPanel';
import { EditorProvider, useEditor } from './contexts/EditorContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
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
import { MATRIX_CONFIG } from './constants/config';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from './constants/magnets';
import { Magnet, PixelAnchor } from './types/pixel';
import { BackgroundSettings } from './types/background';
import { DEFAULT_BACKGROUND_SETTINGS } from './constants/defaultBackground';
import { loadConfig, saveConfig, applyConfig } from './utils/configManager';
import { resolveMagnetPositions, detectConflicts } from './utils/magnetPositionResolver';
import { calculateWindowPosition } from './utils/editorWindows';
import './App.css';

function AppContent() {
  const [pixelPositions, setPixelPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const [isMaximized, setIsMaximized] = useState(false);

  // 同步 isMaximized 状态到 localStorage，供编辑器窗口使用
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.IS_MAXIMIZED, JSON.stringify(isMaximized));
  }, [isMaximized]);

  // 窗口背景效果状态
  const [backgroundEffect, setBackgroundEffect] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
  });
  const [backgroundThemeColor, setBackgroundThemeColor] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BACKGROUND_THEME_COLOR);
    return saved ? JSON.parse(saved) : { id: 'cyan', rgb: [0, 255, 136] };
  });

  // 监听背景效果和主题色变化
  useEffect(() => {
    const setupEffectListeners = async () => {
      const unlistenBg = await setupTauriListener(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED, () => {
        const effect = localStorage.getItem(STORAGE_KEYS.BACKGROUND_EFFECT);
        if (effect) {
          setBackgroundEffect(effect);
        }
      });

      const unlistenBgColor = await setupTauriListener(
        TAURI_EVENTS.BACKGROUND_THEME_COLOR_UPDATED,
        () => {
          const saved = localStorage.getItem(STORAGE_KEYS.BACKGROUND_THEME_COLOR);
          if (saved) {
            setBackgroundThemeColor(JSON.parse(saved));
          }
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
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS);
      return saved ? JSON.parse(saved) : DEFAULT_BACKGROUND_SETTINGS;
    } catch {
      return DEFAULT_BACKGROUND_SETTINGS;
    }
  });

  // 监听背景设置变化（从编辑器窗口更新）
  useEffect(() => {
    let updateTimeout: NodeJS.Timeout | null = null;

    // 防抖更新函数（降低更新频率）
    // 已迁移到 setupConfigSync 统一框架，此处删除旧代码
    return () => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
    };
  }, []);

  // 边框动画已移至 WindowBorder 组件管理

  const { toggleEditMode, updateOccupancy } = useEditor();

  // ============ 新的状态管理系统 ============

  // 默认 Magnet 库
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

  // 默认激活的 Magnet ID（使用统一常量）
  const defaultActiveMagnetIds = DEFAULT_ACTIVE_MAGNET_IDS;

  // 初始化配置（从 localStorage 或使用默认值）
  const initializeConfig = useCallback(() => {
    const savedConfig = loadConfig();

    if (savedConfig) {
      const applied = applyConfig(savedConfig, defaultMagnetLibrary);
      return {
        magnetLibrary: applied.magnetLibrary,
        activeMagnetIds: applied.activeMagnetIds,
      };
    }

    // 首次加载，检测并解决默认magnets的位置冲突
    const conflicts = detectConflicts(defaultMagnetLibrary);
    if (conflicts.length > 0) {
      console.warn(`🔧 首次加载检测到 ${conflicts.length} 个位置冲突，正在自动解决...`);
      conflicts.forEach((conflict) => {
        console.warn(
          `   - "${conflict.magnet1}" 与 "${conflict.magnet2}" 在 ${conflict.conflictPixels.length} 个像素位置冲突`
        );
      });
    }

    const resolvedMagnets = resolveMagnetPositions(defaultMagnetLibrary);

    return {
      magnetLibrary: resolvedMagnets,
      activeMagnetIds: defaultActiveMagnetIds,
    };
  }, [defaultMagnetLibrary, defaultActiveMagnetIds]);

  // Magnet 库：所有可用的 Magnet 模板（内置 + 自定义）
  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(() => {
    const config = initializeConfig();
    return config.magnetLibrary;
  });

  // 当前激活（显示在点阵上）的 Magnet ID 集合
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => {
    const config = initializeConfig();
    return config.activeMagnetIds;
  });

  // 内置 Magnet ID 列表（使用统一常量）
  const builtInMagnetIds = BUILTIN_MAGNET_IDS;

  useEffect(() => {
    // 防止上下文菜单
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // 禁用默认的拖放行为
    document.addEventListener('drop', (e) => e.preventDefault());
    document.addEventListener('dragover', (e) => e.preventDefault());

    // 初始化时检查窗口是否最大化
    appWindow.isMaximized().then(setIsMaximized);

    // 监听窗口大小变化
    const handleResize = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
      // 不再清除位置缓存，保持编辑器窗口的用户自定义位置
    };

    // 监听 resize 事件（窗口大小改变时触发）
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

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 监听背景设置变化（使用统一的通信机制）
  useEffect(() => {
    const reloadBackgroundSettings = () => {
      console.log('Main window: Background settings changed');
      const settings = localStorage.getItem(STORAGE_KEYS.BACKGROUND_SETTINGS);
      if (settings) {
        try {
          setBackgroundSettings(JSON.parse(settings));
        } catch (error) {
          console.error('Failed to parse background settings:', error);
        }
      }
    };

    let cleanupPromise = setupConfigSync(
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
    // 暴露给 Rust 端调用的函数
    (window as any).toggleEditModeFromClose = () => {
      toggleEditMode();
    };

    // 监听 Tauri 退出编辑模式事件
    const setupExitListener = async () => {
      const unlisten = await setupTauriListener(TAURI_EVENTS.EDITOR_EXIT, () => {
        console.log('Main window: Received exit edit mode signal');
        toggleEditMode();
      });
      return unlisten;
    };

    let unlistenPromise = setupExitListener();

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      delete (window as any).toggleEditModeFromClose;
    };
  }, [toggleEditMode]);

  // 同步 builtInMagnetIds 到 localStorage（供编辑器窗口识别）
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BUILTIN_MAGNETS, JSON.stringify([...builtInMagnetIds]));
  }, [builtInMagnetIds]);

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
    console.log('App: activeMagnets computed, count:', filtered.length);
    return filtered;
  }, [magnetLibrary, activeMagnetIds, toggleEditMode]);

  // 更新占用信息
  useEffect(() => {
    updateOccupancy(activeMagnets);
  }, [activeMagnets, updateOccupancy]);

  // 自动保存配置（防抖）- 只在主窗口修改时保存（如拖动 Magnet）
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('App: Auto-saving config');
      saveConfig(
        magnetLibrary,
        activeMagnetIds,
        {
          columns: MATRIX_CONFIG.COLUMNS,
          rows: MATRIX_CONFIG.ROWS,
        },
        defaultMagnetLibrary
      );
    }, 500); // 500ms 防抖

    return () => clearTimeout(timer);
  }, [magnetLibrary, activeMagnetIds, defaultMagnetLibrary]);

  // 处理 Magnet 移动（只更新库中的 Magnet）
  const handleMagnetMove = useCallback((magnetId: string, newAnchors: PixelAnchor[]) => {
    console.log('App.handleMagnetMove called:', magnetId);

    setMagnetLibrary((prev) =>
      prev.map((m) => (m.id === magnetId ? { ...m, anchors: newAnchors } : m))
    );
  }, []);

  // 注意：不再需要 handle* 回调函数
  // 编辑器窗口直接通过 saveConfig + Tauri 事件通知主窗口
  // 主窗口通过监听 Tauri 事件重新加载配置来更新数据

  // 监听编辑器窗口的所有更新（使用统一的新框架）
  useEffect(() => {
    const reloadConfig = () => {
      console.log('Main window: Config changed, reloading from localStorage');
      const config = loadConfig();
      if (config) {
        const applied = applyConfig(config, defaultMagnetLibrary);
        console.log(
          'Main window: Applied config, magnetLibrary:',
          applied.magnetLibrary.length,
          'activeMagnetIds:',
          applied.activeMagnetIds.size
        );
        setMagnetLibrary(applied.magnetLibrary);
        setActiveMagnetIds(applied.activeMagnetIds);
      }
    };

    // 监听所有 Magnet 相关事件
    let cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.CONFIG],
      [
        TAURI_EVENTS.MAGNET_LIBRARY_UPDATED, // 样式修改、新增、删除
        TAURI_EVENTS.MAGNET_ACTIVATED, // 激活
        TAURI_EVENTS.MAGNET_DEACTIVATED, // 停用
      ],
      reloadConfig
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [defaultMagnetLibrary]);

  // 根据窗口状态选择背景配置
  const currentBackground = isMaximized
    ? backgroundSettings.maximized
    : backgroundSettings.windowed;

  return (
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
      <EditorPanel
        magnetLibrary={magnetLibrary}
        activeMagnetIds={activeMagnetIds}
        builtInMagnetIds={builtInMagnetIds}
      />

      {/* 窗口边框 */}
      <WindowBorder />
    </div>
  );
}

function App() {
  // 从 localStorage 加载保存的配置以获取正确的 magnet 位置
  // 注意：magnetsForContext 仅用于 EditorProvider 的初始化
  // 后续更新通过 AppContent 内部的 updateOccupancy 方法进行
  const [magnetsForContext] = useState<Magnet[]>(() => {
    const defaultLibrary = [
      DRAG_HANDLE_MAGNET,
      ...WINDOW_CONTROL_MAGNETS,
      ...MUSIC_PLAYER_MAGNETS,
      EDITOR_BUTTON_MAGNET,
      NAVIGATION_PAGE_MAGNET,
      BACK_BUTTON_MAGNET,
    ];

    const savedConfig = loadConfig();
    if (savedConfig) {
      const applied = applyConfig(savedConfig, defaultLibrary);
      return applied.magnetLibrary;
    }

    return defaultLibrary;
  });

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <EditorProvider magnets={magnetsForContext}>
          <NavigationProvider>
            <AppContent />
          </NavigationProvider>
        </EditorProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}

export default App;
