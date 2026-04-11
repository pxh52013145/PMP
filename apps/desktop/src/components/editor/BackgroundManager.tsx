import { useState, useCallback, memo, useEffect, useMemo, useRef } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { BackgroundConfig, BackgroundSettings, PRESET_BACKGROUNDS } from '../../types/background';
import { setupStorageListener, STORAGE_KEYS } from '../../utils/windowCommunication';
import { readJson, tryWriteJson } from '../../modules/storage';
import { useT } from '../../i18n';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import './BackgroundManager.css';

const telemetry = getTelemetryLogger('editor', 'BackgroundManager');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTauriLocalhostHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

interface BackgroundManagerProps {
  settings: BackgroundSettings;
  onSettingsChange: (settings: BackgroundSettings) => void;
  currentWindowMode: 'maximized' | 'windowed';
}

type BackgroundMode = 'maximized' | 'windowed';

interface HistoryItem {
  id: string;
  config: BackgroundConfig;
  timestamp: number;
}

type ConfirmDialogState =
  | { type: 'delete-history'; historyId: string }
  | { type: 'clear-history' }
  | { type: 'gc-media' };

export const BackgroundManager = memo(function BackgroundManager({
  settings,
  onSettingsChange,
  currentWindowMode,
}: BackgroundManagerProps) {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const t = useT();

  const [mode, setMode] = useState<BackgroundMode>(currentWindowMode);
  const [glitchEffect, setGlitchEffect] = useState(false);
  const [glitchPreset, setGlitchPreset] = useState<string | null>(null);
  const [historyPersistError, setHistoryPersistError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  const modeRef = useRef<BackgroundMode>(mode);
  const lastCustomConfigRef = useRef<Record<BackgroundMode, BackgroundConfig | null>>({
    maximized: null,
    windowed: null,
  });

  // Keep refs hot to avoid stale closures in debounced handlers.
  settingsRef.current = settings;
  modeRef.current = mode;

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    return readJson<HistoryItem[]>(STORAGE_KEYS.BACKGROUND_HISTORY, []);
  });

  // Sync history across windows (e.g. custom-background window auto-adds entries).
  useEffect(() => {
    return setupStorageListener([STORAGE_KEYS.BACKGROUND_HISTORY], () => {
      setHistory(readJson<HistoryItem[]>(STORAGE_KEYS.BACKGROUND_HISTORY, []));
    });
  }, []);

  // 当 currentWindowMode 改变时，同步 mode
  useEffect(() => {
    setMode(currentWindowMode);
  }, [currentWindowMode]);

  // 保存历史记录到 localStorage（使用统一的 STORAGE_KEYS）
  useEffect(() => {
    const ok = tryWriteJson(STORAGE_KEYS.BACKGROUND_HISTORY, history);
    if (ok) {
      setHistoryPersistError(null);
      return;
    }

    setHistoryPersistError('editor.background-manager.error.historyPersistFailed');
  }, [history]);

  const currentConfig = settings[mode];
  const isCustomMode = ['image', 'video', 'html'].includes(currentConfig.type);

  const cloneConfig = useCallback((config: BackgroundConfig): BackgroundConfig => {
    return typeof structuredClone === 'function'
      ? structuredClone(config)
      : (JSON.parse(JSON.stringify(config)) as BackgroundConfig);
  }, []);

  useEffect(() => {
    if (isCustomMode) {
      lastCustomConfigRef.current[mode] = cloneConfig(currentConfig);
    }
  }, [cloneConfig, currentConfig, isCustomMode, mode]);

  // 计算当前激活的预设
  const activePreset = (() => {
    for (const [key, preset] of Object.entries(PRESET_BACKGROUNDS)) {
      // 只比较预设中定义的关键字段
      if (preset.type !== currentConfig.type) {
        continue;
      }

      // 根据类型比较对应字段
      if (preset.type === 'color' && preset.color === currentConfig.color) {
        return key;
      } else if (preset.type === 'gradient') {
        if (JSON.stringify(preset.gradient) === JSON.stringify(currentConfig.gradient)) {
          return key;
        }
      }
    }
    return null;
  })();

  const applyConfigPatch = useCallback(
    (patch: Partial<BackgroundConfig>, targetMode?: BackgroundMode) => {
      const resolvedMode = targetMode ?? modeRef.current;
      const latestSettings = settingsRef.current;
      const baseConfig = latestSettings[resolvedMode];
      onSettingsChange({
        ...latestSettings,
        [resolvedMode]: {
          ...baseConfig,
          ...patch,
        },
      });
    },
    [onSettingsChange]
  );

  const replaceConfig = useCallback(
    (nextConfig: BackgroundConfig, targetMode?: BackgroundMode) => {
      const resolvedMode = targetMode ?? modeRef.current;
      const latestSettings = settingsRef.current;
      onSettingsChange({
        ...latestSettings,
        [resolvedMode]: nextConfig,
      });
    },
    [onSettingsChange]
  );

  // 本地状态（实时UI更新）
  const [localOpacity, setLocalOpacity] = useState(currentConfig.opacity ?? 1);
  const [localBlur, setLocalBlur] = useState(currentConfig.blur ?? 0);

  // 同步外部配置到本地状态
  useEffect(() => {
    setLocalOpacity(currentConfig.opacity ?? 1);
    setLocalBlur(currentConfig.blur ?? 0);
  }, [currentConfig.opacity, currentConfig.blur]);

  // 防抖保存（用于滑块等频繁操作）
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<BackgroundConfig> | null>(null);
  const pendingModeRef = useRef<BackgroundMode | null>(null);

  const debouncedUpdateConfig = useCallback(
    (config: Partial<BackgroundConfig>) => {
      const modeSnapshot = modeRef.current;
      pendingModeRef.current = modeSnapshot;
      pendingPatchRef.current = {
        ...(pendingPatchRef.current ?? {}),
        ...config,
      };
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // 延迟保存到 localStorage
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        const patch = pendingPatchRef.current;
        const mode = pendingModeRef.current ?? modeSnapshot;
        pendingPatchRef.current = null;
        pendingModeRef.current = null;
        if (!patch) return;
        applyConfigPatch(patch, mode);
      }, 300); // 300ms 防抖
    },
    [applyConfigPatch]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      const patch = pendingPatchRef.current;
      const mode = pendingModeRef.current;
      pendingPatchRef.current = null;
      pendingModeRef.current = null;
      if (patch) {
        applyConfigPatch(patch, mode ?? modeRef.current);
      }
    };
  }, [applyConfigPatch]);

  // 应用预设背景
  const applyPreset = useCallback(
    (presetKey: string) => {
      const preset = PRESET_BACKGROUNDS[presetKey];
      if (preset) {
        applyConfigPatch(preset);
      }
    },
    [applyConfigPatch]
  );

  // 处理透明度调整（立即更新UI + 防抖保存）
  const handleOpacityChange = useCallback(
    (opacity: number) => {
      setLocalOpacity(opacity); // 立即更新 UI
      debouncedUpdateConfig({ opacity }); // 防抖保存
    },
    [debouncedUpdateConfig]
  );

  // 处理模糊度调整（立即更新UI + 防抖保存）
  const handleBlurChange = useCallback(
    (blur: number) => {
      setLocalBlur(blur); // 立即更新 UI
      debouncedUpdateConfig({ blur }); // 防抖保存
    },
    [debouncedUpdateConfig]
  );

  // 处理类型切换（切换到非自定义类型时关闭自定义窗口）
  const handleTypeChange = useCallback(
    async (type: 'color' | 'gradient') => {
      // 关闭自定义背景窗口（如果打开）
      try {
        const { closeEditorWindow } = await import('../../utils/editorWindows');
        await closeEditorWindow('custom-background');
      } catch (error) {
        // 窗口可能没打开，忽略错误
      }

      // 切换类型
      applyConfigPatch({ type });
    },
    [applyConfigPatch]
  );

  // 处理颜色更改
  const handleColorChange = useCallback(
    (color: string) => {
      applyConfigPatch({ type: 'color', color });
    },
    [applyConfigPatch]
  );

  // 处理渐变类型更改
  const handleGradientTypeChange = useCallback(
    (gradientType: 'linear' | 'radial') => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      applyConfigPatch({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          type: gradientType,
        },
      });
    },
    [currentConfig.gradient, applyConfigPatch]
  );

  // 处理渐变颜色更改
  const handleGradientColorChange = useCallback(
    (index: number, color: string) => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      const newColors = [...currentGradient.colors];
      newColors[index] = color;
      applyConfigPatch({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          colors: newColors,
        },
      });
    },
    [currentConfig.gradient, applyConfigPatch]
  );

  // 添加渐变颜色
  const handleAddGradientColor = useCallback(() => {
    const currentGradient = currentConfig.gradient || {
      type: 'linear',
      colors: ['#667eea', '#764ba2'],
      angle: 135,
    };
    if (currentGradient.colors.length < 5) {
      applyConfigPatch({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          colors: [...currentGradient.colors, '#ffffff'],
        },
      });
    }
  }, [currentConfig.gradient, applyConfigPatch]);

  // 删除渐变颜色
  const handleRemoveGradientColor = useCallback(
    (index: number) => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      if (currentGradient.colors.length > 2) {
        const newColors = currentGradient.colors.filter((_, i) => i !== index);
        applyConfigPatch({
          type: 'gradient',
          gradient: {
            ...currentGradient,
            colors: newColors,
          },
        });
      }
    },
    [currentConfig.gradient, applyConfigPatch]
  );

  // 处理渐变角度更改
  const handleGradientAngleChange = useCallback(
    (angle: number) => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      applyConfigPatch({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          angle,
        },
      });
    },
    [currentConfig.gradient, applyConfigPatch]
  );

  // 处理自定义类型按钮点击（只切换类型，不打开窗口）
  const handleCustomTypeClick = useCallback(() => {
    if (!isCustomMode) {
      const remembered = lastCustomConfigRef.current[mode];
      if (remembered) {
        replaceConfig(remembered, mode);
        return;
      }

      // 首次进入自定义类型：设置默认的图片类型（纯黑背景）
      applyConfigPatch({
        type: 'image',
        image: {
          url: '', // 空 URL，在 Background 组件中会显示纯黑
          fit: 'cover',
          position: 'center center',
          repeat: 'no-repeat',
        },
        opacity: 1,
      });
    }
  }, [isCustomMode, mode, applyConfigPatch, replaceConfig]);

  // 打开自定义背景编辑窗口
  const handleOpenCustomEditor = useCallback(async () => {
    try {
      await dispatchRequiredCommand(
        commands,
        'app:open-custom-background-editor-window',
        'Custom background editor command service is not available.'
      );
      telemetry.info('editor.background.custom-window.open.completed');
    } catch (error) {
      telemetry.error('editor.background.custom-window.open.failed', {
        message: getErrorMessage(error),
      });
      alert(t('editor.background-manager.error.openCustomEditorFailed', { message: String(error) }));
    }
  }, [commands, t]);

  // 处理禁用模式按钮点击（触发故障效果）
  const handleDisabledModeClick = useCallback(() => {
    setGlitchEffect(true);
    setTimeout(() => setGlitchEffect(false), 500);
  }, []);

  // 处理预设按钮点击
  const handlePresetClick = useCallback(
    (presetKey: string) => {
      const preset = PRESET_BACKGROUNDS[presetKey];
      if (preset && preset.type === currentConfig.type) {
        applyPreset(presetKey);
      } else {
        // 类型不匹配，触发故障效果
        setGlitchPreset(presetKey);
        setTimeout(() => setGlitchPreset(null), 500);
      }
    },
    [currentConfig.type, applyPreset]
  );

  // 保存当前配置到历史记录
  const handleSaveToHistory = useCallback(() => {
    const newItem: HistoryItem = {
      id: `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      config: cloneConfig(currentConfig),
      timestamp: Date.now(),
    };
    setHistory((prev) => [newItem, ...prev].slice(0, 20)); // 最多保存20条
  }, [cloneConfig, currentConfig]);

  // 从历史记录恢复配置
  const handleRestoreFromHistory = useCallback(
    (item: HistoryItem) => {
      replaceConfig(item.config);
    },
    [replaceConfig]
  );

  const tryGetManagedMediaRelPath = useCallback((url: string | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith('data:')) return null;
    if ((url.startsWith('http://') || url.startsWith('https://')) && !isTauriLocalhostHttpUrl(url)) {
      return null;
    }

    const candidates = [url];
    try {
      candidates.push(decodeURIComponent(url));
    } catch {
      // ignore
    }

    for (const candidate of candidates) {
      const normalized = candidate.split('\\').join('/');
      const markerIndex = normalized.lastIndexOf('/background-media/');
      if (markerIndex === -1) continue;
      const tail = normalized.slice(markerIndex + '/background-media/'.length);
      const fileName = tail.split('?')[0].split('#')[0].split('/')[0];
      if (!fileName || !fileName.startsWith('background-')) continue;
      return `background-media/${fileName}`;
    }

    return null;
  }, []);

  const getConfigMediaRelPath = useCallback(
    (config: BackgroundConfig): string | null => {
      if (config.type === 'image') {
        return tryGetManagedMediaRelPath(config.image?.url);
      }
      if (config.type === 'video') {
        return tryGetManagedMediaRelPath(config.video?.url);
      }
      return null;
    },
    [tryGetManagedMediaRelPath]
  );

  const runMediaGc = useCallback(async () => {
    if (maintenanceBusy) return;
    setMaintenanceBusy(true);
    setMaintenanceMessage(t('editor.background-manager.maintenance.gcRunning'));

    try {
      const fs = await import('@tauri-apps/api/fs');

      const referenced = new Set<string>();
      for (const item of history) {
        const rel = getConfigMediaRelPath(item.config);
        if (rel) referenced.add(rel);
      }
      const currentMax = getConfigMediaRelPath(settingsRef.current.maximized);
      if (currentMax) referenced.add(currentMax);
      const currentWin = getConfigMediaRelPath(settingsRef.current.windowed);
      if (currentWin) referenced.add(currentWin);

      const allowDelete = referenced.size > 0;
      let removed = 0;
      let scanned = 0;
      let entries: Array<import('@tauri-apps/api/fs').FileEntry> = [];
      try {
        entries = await fs.readDir('background-media', {
          dir: fs.BaseDirectory.AppData,
          recursive: false,
        });
      } catch {
        entries = [];
      }

      for (const entry of entries) {
        const normalized = entry.path.split('\\').join('/');
        const name = normalized.split('/').pop() || '';
        if (!name) continue;
        scanned += 1;
        if (!allowDelete) continue;
        const rel = `background-media/${name}`;
        if (referenced.has(rel)) continue;
        try {
          await fs.removeFile(rel, { dir: fs.BaseDirectory.AppData });
          removed += 1;
        } catch (error) {
          telemetry.warn('editor.background.media-gc.remove-orphan.failed', {
            message: getErrorMessage(error),
            fields: {
              rel,
            },
          });
        }
      }

      setMaintenanceMessage(
        t('editor.background-manager.maintenance.gcDone', { scanned, removed })
      );
    } catch (error) {
      telemetry.error('editor.background.media-gc.failed', {
        message: getErrorMessage(error),
      });
      setMaintenanceMessage(t('editor.background-manager.maintenance.gcFailed'));
    } finally {
      setMaintenanceBusy(false);
    }
  }, [getConfigMediaRelPath, history, maintenanceBusy, t]);

  const deleteHistoryNow = useCallback(
    (id: string) => {
      const nextHistory = history.filter((item) => item.id !== id);
      setHistory(nextHistory);
    },
    [history]
  );

  const clearHistoryNow = useCallback(() => {
    setHistory([]);
  }, []);

  const handleDeleteHistory = useCallback((id: string) => {
    setConfirmDialog({ type: 'delete-history', historyId: id });
  }, []);

  const handleClearHistory = useCallback(() => {
    setConfirmDialog({ type: 'clear-history' });
  }, []);

  // 生成历史记录项的可视化样式
  const getHistoryItemStyle = useCallback((config: BackgroundConfig): React.CSSProperties => {
    switch (config.type) {
      case 'color':
        return {
          background: config.color || '#000000',
        };
      case 'gradient':
        if (config.gradient) {
          const { type, colors, angle } = config.gradient;
          if (type === 'linear') {
            return {
              background: `linear-gradient(${angle || 135}deg, ${colors.join(', ')})`,
            };
          } else {
            return {
              background: `radial-gradient(circle, ${colors.join(', ')})`,
            };
          }
        }
        return {};
      case 'image':
        return {
          background: '#1a1a1a',
        };
      case 'video':
        // 视频类型显示特殊图标样式
        return {
          background:
            'linear-gradient(135deg, rgba(102, 126, 234, 0.3) 0%, rgba(118, 75, 162, 0.3) 100%)',
          position: 'relative',
        };
      case 'html':
        // HTML 类型显示特殊图标样式
        return {
          background:
            'linear-gradient(135deg, rgba(240, 147, 251, 0.3) 0%, rgba(245, 87, 108, 0.3) 100%)',
        };
      default:
        return {};
    }
  }, []);

  // 获取历史记录项的类型标签
  const getHistoryTypeLabel = useCallback((config: BackgroundConfig): string => {
    switch (config.type) {
      case 'color':
        return t('editor.background-manager.history.type.color');
      case 'gradient':
        return config.gradient?.type === 'linear'
          ? t('editor.background-manager.history.type.gradientLinear')
          : t('editor.background-manager.history.type.gradientRadial');
      case 'image':
        return t('editor.background-manager.history.type.image');
      case 'video':
        return t('editor.background-manager.history.type.video');
      case 'html':
        return t('editor.background-manager.history.type.html');
      default:
        return t('editor.background-manager.history.type.unknown');
    }
  }, [t]);

  const confirmDialogContent = useMemo(() => {
    if (!confirmDialog) return null;

    switch (confirmDialog.type) {
      case 'delete-history':
        return {
          title: t('editor.background-manager.confirm.deleteHistory.title'),
          message: t('editor.background-manager.confirm.deleteHistory.message'),
          confirmText: t('editor.background-manager.confirm.deleteHistory.confirmText'),
        };
      case 'clear-history':
        return {
          title: t('editor.background-manager.confirm.clearHistory.title'),
          message: t('editor.background-manager.confirm.clearHistory.message'),
          confirmText: t('editor.background-manager.confirm.clearHistory.confirmText'),
        };
      case 'gc-media':
        return {
          title: t('editor.background-manager.confirm.gcMedia.title'),
          message: t('editor.background-manager.confirm.gcMedia.message'),
          confirmText: t('editor.background-manager.confirm.gcMedia.confirmText'),
        };
    }
  }, [confirmDialog, t]);

  const handleConfirmDialogConfirm = useCallback(() => {
    if (!confirmDialog) return;
    const action = confirmDialog;
    setConfirmDialog(null);

    if (action.type === 'delete-history') {
      deleteHistoryNow(action.historyId);
      return;
    }
    if (action.type === 'clear-history') {
      clearHistoryNow();
      return;
    }
    if (action.type === 'gc-media') {
      void runMediaGc();
    }
  }, [clearHistoryNow, confirmDialog, deleteHistoryNow, runMediaGc]);

  return (
    <div className="background-manager">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('editor.background-manager.title')}
        </span>
      </div>

      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 顶部固定：模式选择 */}
        <div className="bg-header-fixed">
          <div className="bg-mode-selector">
            <button
              className={`mode-btn ${mode === 'maximized' ? 'active' : ''} ${currentWindowMode !== 'maximized' ? 'disabled' : ''} ${glitchEffect && currentWindowMode !== 'maximized' ? 'glitch' : ''}`}
              data-text={t('editor.background-manager.mode.maximized')}
              onClick={() => {
                if (currentWindowMode === 'maximized') {
                  setMode('maximized');
                } else {
                  handleDisabledModeClick();
                }
              }}
            >
              {t('editor.background-manager.mode.maximized')}
            </button>
            <button
              className={`mode-btn ${mode === 'windowed' ? 'active' : ''} ${currentWindowMode !== 'windowed' ? 'disabled' : ''} ${glitchEffect && currentWindowMode !== 'windowed' ? 'glitch' : ''}`}
              data-text={t('editor.background-manager.mode.windowed')}
              onClick={() => {
                if (currentWindowMode === 'windowed') {
                  setMode('windowed');
                } else {
                  handleDisabledModeClick();
                }
              }}
            >
              {t('editor.background-manager.mode.windowed')}
            </button>
          </div>
        </div>

        {/* 滚动内容区域 */}
        <div className="bg-content-scroll">
          {/* 背景类型选择 */}
          <div className="bg-section">
            <div className="section-title">{t('editor.background-manager.section.backgroundType')}</div>
            <div className="type-buttons">
              <button
                className={`type-btn ${currentConfig.type === 'color' ? 'active' : ''}`}
                onClick={() => handleTypeChange('color')}
              >
                {t('editor.background-manager.type.color')}
              </button>
              <button
                className={`type-btn ${currentConfig.type === 'gradient' ? 'active' : ''}`}
                onClick={() => handleTypeChange('gradient')}
              >
                {t('editor.background-manager.type.gradient')}
              </button>
              <button
                className={`type-btn ${isCustomMode ? 'active' : ''}`}
                onClick={handleCustomTypeClick}
              >
                {t('editor.background-manager.type.custom')}
              </button>
            </div>
          </div>

          {/* 透明度控制 */}
          <div className="bg-section">
            <div className="section-title">{t('editor.background-manager.section.opacity')}</div>
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="100"
                value={localOpacity * 100}
                onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                className="opacity-slider"
              />
              <span className="slider-value">{Math.round(localOpacity * 100)}%</span>
            </div>
          </div>

          {/* 模糊效果 */}
          <div className="bg-section">
            <div className="section-title">{t('editor.background-manager.section.blur')}</div>
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="20"
                value={localBlur}
                onChange={(e) => handleBlurChange(Number(e.target.value))}
                className="blur-slider"
              />
              <span className="slider-value">{localBlur}px</span>
            </div>
          </div>

          {/* 只在自定义模式下显示打开编辑器按钮 */}
          {isCustomMode && (
            <div className="bg-section">
              <div className="section-title">{t('editor.background-manager.section.customEdit')}</div>
              <button className="open-custom-editor-btn" onClick={handleOpenCustomEditor}>
                {t('editor.background-manager.action.openCustomEditor')}
              </button>
            </div>
          )}

          {/* 只在非自定义模式下显示预设背景 */}
          {!isCustomMode && (
            <div className="bg-section">
              <div className="section-title">{t('editor.background-manager.section.presets')}</div>
              <div className="preset-grid">
                {Object.keys(PRESET_BACKGROUNDS).map((key) => {
                  const preset = PRESET_BACKGROUNDS[key];
                  const isDisabled = preset.type !== currentConfig.type;
                  const isGlitching = glitchPreset === key;

                  return (
                    <button
                      key={key}
                      className={`preset-btn ${activePreset === key ? 'active' : ''} ${isDisabled ? 'disabled' : ''} ${isGlitching ? 'glitch' : ''}`}
                      data-text={key}
                      onClick={() => handlePresetClick(key)}
                    >
                      {key}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 只在非自定义模式下显示颜色设置 */}
          {!isCustomMode && currentConfig.type === 'color' && (
            <div className="bg-section">
              <div className="section-title">{t('editor.background-manager.section.color')}</div>
              <div className="color-input-container">
                <input
                  type="color"
                  value={currentConfig.color ?? '#000000'}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="color-picker"
                />
                <input
                  type="text"
                  value={currentConfig.color ?? '#000000'}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="color-text"
                  placeholder="#000000"
                />
              </div>
            </div>
          )}

          {/* 渐变设置 */}
          {!isCustomMode && currentConfig.type === 'gradient' && (
            <>
              <div className="bg-section">
                <div className="section-title">{t('editor.background-manager.section.gradientType')}</div>
                <div className="type-buttons">
                  <button
                    className={`type-btn ${currentConfig.gradient?.type === 'linear' ? 'active' : ''}`}
                    onClick={() => handleGradientTypeChange('linear')}
                  >
                    {t('editor.background-manager.gradient.type.linear')}
                  </button>
                  <button
                    className={`type-btn ${currentConfig.gradient?.type === 'radial' ? 'active' : ''}`}
                    onClick={() => handleGradientTypeChange('radial')}
                  >
                    {t('editor.background-manager.gradient.type.radial')}
                  </button>
                </div>
              </div>

              <div className="bg-section">
                <div className="section-title">{t('editor.background-manager.section.gradientColors')}</div>
                {currentConfig.gradient?.colors.map((color, index) => (
                  <div key={index} className="gradient-color-row">
                    <span className="color-label">
                      {t('editor.background-manager.gradient.colorSwatch', { index: index + 1 })}
                    </span>
                    <div className="color-input-container">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => handleGradientColorChange(index, e.target.value)}
                        className="color-picker"
                      />
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => handleGradientColorChange(index, e.target.value)}
                        className="color-text"
                        placeholder="#000000"
                      />
                      {(currentConfig.gradient?.colors.length ?? 0) > 2 && (
                        <button
                          className="remove-color-btn"
                          onClick={() => handleRemoveGradientColor(index)}
                          title={t('editor.background-manager.gradient.removeColorTitle')}
                        >
                          ○
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(currentConfig.gradient?.colors.length ?? 0) < 5 && (
                  <button className="add-color-btn" onClick={handleAddGradientColor}>
                    {t('editor.background-manager.gradient.addColor')}
                  </button>
                )}
              </div>

              {currentConfig.gradient?.type === 'linear' && (
                <div className="bg-section">
                  <div className="section-title">{t('editor.background-manager.section.gradientAngle')}</div>
                  <div className="slider-container">
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={currentConfig.gradient?.angle ?? 135}
                      onChange={(e) => handleGradientAngleChange(Number(e.target.value))}
                      className="angle-slider"
                    />
                    <span className="slider-value">{currentConfig.gradient?.angle ?? 135}°</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 保存到历史记录 */}
          <div className="bg-section">
            <div className="section-title">{t('editor.background-manager.section.saveConfig')}</div>
            <button className="save-history-btn" onClick={handleSaveToHistory}>
              {t('editor.background-manager.action.saveCurrent')}
            </button>
          </div>

          {/* 历史记录 */}
          {history.length > 0 && (
            <div className="bg-section">
              <div className="section-title-with-actions">
                <span>{t('editor.background-manager.section.history')}</span>
                <button className="clear-history-btn" onClick={handleClearHistory}>
                  {t('common.action.clear')}
                </button>
              </div>
              <div className="history-list">
                {history.map((item) => (
                  <div key={item.id} className="history-item">
                    <div
                      className="history-preview"
                      style={getHistoryItemStyle(item.config)}
                      onClick={() => handleRestoreFromHistory(item)}
                      title={t('editor.background-manager.history.restoreTitle')}
                    >
                      {item.config.type === 'image' && item.config.image?.url && (
                        <img
                          className="history-image"
                          src={item.config.image.url}
                          alt=""
                          draggable={false}
                          style={{
                            objectFit: item.config.image.fit,
                            objectPosition: item.config.image.position || 'center center',
                            opacity: item.config.image.opacity ?? 1,
                          }}
                        />
                      )}
                      {/* 视频和HTML类型显示特殊图标 */}
                      {item.config.type === 'video' && (
                        <div className="history-media-icon">
                          <span className="media-icon-symbol">▶</span>
                          <span className="media-icon-label">VIDEO</span>
                        </div>
                      )}
                      {item.config.type === 'html' && (
                        <div className="history-media-icon">
                          <span className="media-icon-symbol">&lt;/&gt;</span>
                          <span className="media-icon-label">HTML</span>
                        </div>
                      )}
                      <div className="history-overlay">
                        <span className="history-type">{getHistoryTypeLabel(item.config)}</span>
                      </div>
                    </div>
                    <button
                      className="history-delete-btn"
                      onClick={() => handleDeleteHistory(item.id)}
                      title={t('common.action.delete')}
                    >
                      <span className="history-delete-btn-symbol">X</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-section">
            <div className="section-title">{t('editor.background-manager.section.maintenance')}</div>
            <div className="maintenance-actions">
              <button
                className="maintenance-btn maintenance-btn-danger"
                disabled={maintenanceBusy}
                onClick={() => setConfirmDialog({ type: 'gc-media' })}
                title={t('editor.background-manager.maintenance.gcTitle')}
              >
                {t('editor.background-manager.maintenance.gc')}
              </button>
            </div>
            {maintenanceMessage && <div className="maintenance-message">{maintenanceMessage}</div>}
          </div>

          {historyPersistError && <div className="history-persist-error">{t(historyPersistError)}</div>}
        </div>
      </div>

      {confirmDialogContent && (
        <div className="cyber-confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="cyber-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cyber-confirm-header">
              <span className="confirm-icon">▲</span>
              <span className="confirm-title">{confirmDialogContent.title}</span>
            </div>
            <div className="cyber-confirm-body">
              <div className="confirm-message">{confirmDialogContent.message}</div>
            </div>
            <div className="cyber-confirm-footer">
              <button className="confirm-btn confirm-cancel" onClick={() => setConfirmDialog(null)}>
                {t('editor.background-manager.confirm.cancelButton')}
              </button>
              <button
                className="confirm-btn confirm-ok"
                onClick={handleConfirmDialogConfirm}
                disabled={maintenanceBusy && confirmDialog?.type === 'gc-media'}
              >
                {confirmDialogContent.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
