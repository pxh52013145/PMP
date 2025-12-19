import { useState, useCallback, memo, useEffect, useMemo, useRef } from 'react';
import { BackgroundConfig, BackgroundSettings, PRESET_BACKGROUNDS } from '../../types/background';
import { setupStorageListener, STORAGE_KEYS } from '../../utils/windowCommunication';
import { readJson, readString, tryWriteJson, writeString } from '../../modules/storage';
import './BackgroundManager.css';

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
  | { type: 'gc-media' }
  | { type: 'migrate-legacy' };

export const BackgroundManager = memo(function BackgroundManager({
  settings,
  onSettingsChange,
  currentWindowMode,
}: BackgroundManagerProps) {
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
  const migrationRunningRef = useRef(false);

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

    setHistoryPersistError('历史记录保存失败（可能是存储空间不足）。当前会话可用，但重启后可能丢失。');
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

  const hasLegacyDataUrls = useMemo(() => {
    const hasDataUrl = (url: string | undefined): boolean => !!url && url.startsWith('data:');

    if (settings.maximized.type === 'image' && hasDataUrl(settings.maximized.image?.url)) return true;
    if (settings.maximized.type === 'video' && hasDataUrl(settings.maximized.video?.url)) return true;
    if (settings.windowed.type === 'image' && hasDataUrl(settings.windowed.image?.url)) return true;
    if (settings.windowed.type === 'video' && hasDataUrl(settings.windowed.video?.url)) return true;

    for (const item of history) {
      if (item.config.type === 'image' && hasDataUrl(item.config.image?.url)) return true;
      if (item.config.type === 'video' && hasDataUrl(item.config.video?.url)) return true;
    }

    return false;
  }, [history, settings.maximized, settings.windowed]);

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

  const debouncedUpdateConfig = useCallback(
    (config: Partial<BackgroundConfig>) => {
      const modeSnapshot = modeRef.current;
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // 延迟保存到 localStorage
      saveTimeoutRef.current = setTimeout(() => {
        applyConfigPatch(config, modeSnapshot);
      }, 300); // 300ms 防抖
    },
    [applyConfigPatch]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

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
      const { openEditorWindow, calculateWindowPosition } = await import(
        '../../utils/editorWindows'
      );
      const position = await calculateWindowPosition('custom-background');
      console.log('Opening custom background window at:', position);
      await openEditorWindow({ type: 'custom-background', ...position });
      console.log('Custom background window opened successfully');
    } catch (error) {
      console.error('Failed to open custom background window:', error);
      alert('打开自定义背景窗口失败：' + error);
    }
  }, []);

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
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
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

  const decodeBase64ToBytes = useCallback((base64: string): Uint8Array => {
    const normalized = base64.replace(/\s/g, '');
    const chunkChars = 1_048_576; // must be divisible by 4
    const parts: Uint8Array[] = [];

    for (let offset = 0; offset < normalized.length; offset += chunkChars) {
      const slice = normalized.slice(offset, offset + chunkChars);
      const binary = atob(slice);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      parts.push(bytes);
    }

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let writeOffset = 0;
    for (const part of parts) {
      merged.set(part, writeOffset);
      writeOffset += part.length;
    }
    return merged;
  }, []);

  const writeManagedMediaFromDataUrl = useCallback(
    async (dataUrl: string, fallbackKind: 'image' | 'video'): Promise<string> => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('Invalid data URL');
      const mimeType = match[1];
      const base64 = match[2];

      const mimeToExt: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/bmp': 'bmp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/ogg': 'ogg',
        'video/quicktime': 'mov',
      };
      const ext = mimeToExt[mimeType] || (fallbackKind === 'image' ? 'png' : 'mp4');

      const fs = await import('@tauri-apps/api/fs');
      const pathApi = await import('@tauri-apps/api/path');
      const tauri = await import('@tauri-apps/api/tauri');

      const bytes = decodeBase64ToBytes(base64);
      const fileName = `background-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const relativePath = `background-media/${fileName}`;
      await fs.createDir('background-media', { dir: fs.BaseDirectory.AppData, recursive: true });
      await fs.writeBinaryFile({ path: relativePath, contents: bytes }, { dir: fs.BaseDirectory.AppData });

      const appDataDir = await pathApi.appDataDir();
      const fullPath = await pathApi.join(appDataDir, 'background-media', fileName);
      return tauri.convertFileSrc(fullPath);
    },
    [decodeBase64ToBytes]
  );

  const migrateConfigIfNeeded = useCallback(
    async (config: BackgroundConfig): Promise<BackgroundConfig | null> => {
      if (config.type === 'image' && config.image?.url?.startsWith('data:')) {
        try {
          const migratedUrl = await writeManagedMediaFromDataUrl(config.image.url, 'image');
          return { ...config, image: { ...config.image, url: migratedUrl } };
        } catch (error) {
          console.warn('[BackgroundManager] Failed to migrate image data URL:', error);
          return { type: 'image', image: { url: '', fit: 'cover', position: 'center center', repeat: 'no-repeat' } };
        }
      }

      if (config.type === 'video' && config.video?.url?.startsWith('data:')) {
        try {
          const migratedUrl = await writeManagedMediaFromDataUrl(config.video.url, 'video');
          return { ...config, video: { ...config.video, url: migratedUrl } };
        } catch (error) {
          console.warn('[BackgroundManager] Failed to migrate video data URL:', error);
          return { type: 'color', color: '#000000', opacity: 1 };
        }
      }

      return null;
    },
    [writeManagedMediaFromDataUrl]
  );

  const runLegacyMigration = useCallback(async () => {
    if (maintenanceBusy || migrationRunningRef.current) return;
    migrationRunningRef.current = true;
    setMaintenanceBusy(true);
    setMaintenanceMessage('正在迁移旧版背景数据…');

    try {
      let changedSettings = false;
      const nextSettings: BackgroundSettings = {
        maximized: settingsRef.current.maximized,
        windowed: settingsRef.current.windowed,
      };

      const migratedMax = await migrateConfigIfNeeded(nextSettings.maximized);
      if (migratedMax) {
        nextSettings.maximized = migratedMax;
        changedSettings = true;
      }
      const migratedWin = await migrateConfigIfNeeded(nextSettings.windowed);
      if (migratedWin) {
        nextSettings.windowed = migratedWin;
        changedSettings = true;
      }

      if (changedSettings) {
        onSettingsChange(nextSettings);
      }

      const nextHistory: HistoryItem[] = [];
      let dropped = 0;
      for (const item of history) {
        const migrated = await migrateConfigIfNeeded(item.config);
        if (migrated) {
          nextHistory.push({ ...item, config: migrated });
          continue;
        }

        const stillLegacy =
          (item.config.type === 'image' && item.config.image?.url?.startsWith('data:')) ||
          (item.config.type === 'video' && item.config.video?.url?.startsWith('data:'));
        if (stillLegacy) {
          dropped += 1;
          continue;
        }

        nextHistory.push(item);
      }

      setHistory(nextHistory);
      writeString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1, '1');
      setMaintenanceMessage(
        dropped > 0 ? `迁移完成（已移除 ${dropped} 条无法迁移的旧记录）` : '迁移完成'
      );
    } catch (error) {
      console.error('[BackgroundManager] Legacy migration failed:', error);
      setMaintenanceMessage('迁移失败：请重试或重新选择背景文件');
    } finally {
      migrationRunningRef.current = false;
      setMaintenanceBusy(false);
    }
  }, [history, maintenanceBusy, migrateConfigIfNeeded, onSettingsChange]);

  const runMediaGc = useCallback(async () => {
    if (maintenanceBusy) return;
    setMaintenanceBusy(true);
    setMaintenanceMessage('正在清理未使用的背景文件…');

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
        const rel = `background-media/${name}`;
        if (referenced.has(rel)) continue;
        try {
          await fs.removeFile(rel, { dir: fs.BaseDirectory.AppData });
          removed += 1;
        } catch (error) {
          console.warn('[BackgroundManager] Failed to remove orphan file:', rel, error);
        }
      }

      setMaintenanceMessage(`清理完成：扫描 ${scanned} 个文件，删除 ${removed} 个未使用文件`);
    } catch (error) {
      console.error('[BackgroundManager] Media GC failed:', error);
      setMaintenanceMessage('清理失败：请重试');
    } finally {
      setMaintenanceBusy(false);
    }
  }, [getConfigMediaRelPath, history, maintenanceBusy]);

  useEffect(() => {
    const migrated = readString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1) === '1';
    if (migrated) return;
    if (!hasLegacyDataUrls) return;
    void runLegacyMigration();
  }, [hasLegacyDataUrls, runLegacyMigration]);

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
        return '纯色';
      case 'gradient':
        return config.gradient?.type === 'linear' ? '线性渐变' : '径向渐变';
      case 'image':
        return '图片';
      case 'video':
        return '视频';
      case 'html':
        return 'HTML';
      default:
        return '未知';
    }
  }, []);

  const confirmDialogContent = useMemo(() => {
    if (!confirmDialog) return null;

    switch (confirmDialog.type) {
      case 'delete-history':
        return {
          title: '删除历史记录',
          message: '确定要删除这条历史记录吗？（文件会在下次启动时自动清理，或手动点“清理未使用文件”。）',
          confirmText: '[删除] DELETE',
        };
      case 'clear-history':
        return {
          title: '清空历史记录',
          message: '确定要清空所有历史记录吗？（文件会在下次启动时自动清理，或手动点“清理未使用文件”。）',
          confirmText: '[清空] CLEAR',
        };
      case 'gc-media':
        return {
          title: '清理未使用文件',
          message: '将扫描本地 background-media 目录并删除未被历史记录或当前背景引用的文件，确定继续吗？',
          confirmText: '[清理] GC',
        };
      case 'migrate-legacy':
        return {
          title: '迁移旧数据',
          message:
            '将把旧版 data:base64 背景数据迁移为本地文件存储，并自动清理无法迁移的旧记录，确定继续吗？',
          confirmText: '[迁移] MIGRATE',
        };
    }
  }, [confirmDialog]);

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
      return;
    }
    if (action.type === 'migrate-legacy') {
      void runLegacyMigration();
    }
  }, [clearHistoryNow, confirmDialog, deleteHistoryNow, runLegacyMigration, runMediaGc]);

  return (
    <div className="background-manager">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 顶部固定：模式选择 */}
        <div className="bg-header-fixed">
          <div className="bg-mode-selector">
            <button
              className={`mode-btn ${mode === 'maximized' ? 'active' : ''} ${currentWindowMode !== 'maximized' ? 'disabled' : ''} ${glitchEffect && currentWindowMode !== 'maximized' ? 'glitch' : ''}`}
              data-text="最大化背景"
              onClick={() => {
                if (currentWindowMode === 'maximized') {
                  setMode('maximized');
                } else {
                  handleDisabledModeClick();
                }
              }}
            >
              最大化背景
            </button>
            <button
              className={`mode-btn ${mode === 'windowed' ? 'active' : ''} ${currentWindowMode !== 'windowed' ? 'disabled' : ''} ${glitchEffect && currentWindowMode !== 'windowed' ? 'glitch' : ''}`}
              data-text="窗口背景"
              onClick={() => {
                if (currentWindowMode === 'windowed') {
                  setMode('windowed');
                } else {
                  handleDisabledModeClick();
                }
              }}
            >
              窗口背景
            </button>
          </div>
        </div>

        {/* 滚动内容区域 */}
        <div className="bg-content-scroll">
          {/* 背景类型选择 */}
          <div className="bg-section">
            <div className="section-title">背景类型</div>
            <div className="type-buttons">
              <button
                className={`type-btn ${currentConfig.type === 'color' ? 'active' : ''}`}
                onClick={() => handleTypeChange('color')}
              >
                纯色
              </button>
              <button
                className={`type-btn ${currentConfig.type === 'gradient' ? 'active' : ''}`}
                onClick={() => handleTypeChange('gradient')}
              >
                渐变
              </button>
              <button
                className={`type-btn ${isCustomMode ? 'active' : ''}`}
                onClick={handleCustomTypeClick}
              >
                自定义
              </button>
            </div>
          </div>

          {/* 透明度控制 */}
          <div className="bg-section">
            <div className="section-title">透明度</div>
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
            <div className="section-title">模糊效果</div>
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
              <div className="section-title">自定义编辑</div>
              <button className="open-custom-editor-btn" onClick={handleOpenCustomEditor}>
                打开自定义窗口
              </button>
            </div>
          )}

          {/* 只在非自定义模式下显示预设背景 */}
          {!isCustomMode && (
            <div className="bg-section">
              <div className="section-title">预设背景</div>
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
              <div className="section-title">颜色设置</div>
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
                <div className="section-title">渐变类型</div>
                <div className="type-buttons">
                  <button
                    className={`type-btn ${currentConfig.gradient?.type === 'linear' ? 'active' : ''}`}
                    onClick={() => handleGradientTypeChange('linear')}
                  >
                    线性
                  </button>
                  <button
                    className={`type-btn ${currentConfig.gradient?.type === 'radial' ? 'active' : ''}`}
                    onClick={() => handleGradientTypeChange('radial')}
                  >
                    径向
                  </button>
                </div>
              </div>

              <div className="bg-section">
                <div className="section-title">渐变颜色</div>
                {currentConfig.gradient?.colors.map((color, index) => (
                  <div key={index} className="gradient-color-row">
                    <span className="color-label">色块 {index + 1}</span>
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
                          title="删除颜色"
                        >
                          ○
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(currentConfig.gradient?.colors.length ?? 0) < 5 && (
                  <button className="add-color-btn" onClick={handleAddGradientColor}>
                    + 添加颜色
                  </button>
                )}
              </div>

              {currentConfig.gradient?.type === 'linear' && (
                <div className="bg-section">
                  <div className="section-title">渐变角度</div>
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
            <div className="section-title">保存配置</div>
            <button className="save-history-btn" onClick={handleSaveToHistory}>
              保存当前背景
            </button>
          </div>

          {/* 历史记录 */}
          {history.length > 0 && (
            <div className="bg-section">
              <div className="section-title-with-actions">
                <span>历史记录</span>
                <button className="clear-history-btn" onClick={handleClearHistory}>
                  清空
                </button>
              </div>
              <div className="history-list">
                {history.map((item) => (
                  <div key={item.id} className="history-item">
                    <div
                      className="history-preview"
                      style={getHistoryItemStyle(item.config)}
                      onClick={() => handleRestoreFromHistory(item)}
                      title="点击恢复此配置"
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
                      title="删除"
                    >
                      <span className="history-delete-btn-symbol">X</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-section">
            <div className="section-title">存储维护</div>
            <div className="maintenance-actions">
              <button
                className="maintenance-btn"
                disabled={!hasLegacyDataUrls || maintenanceBusy}
                onClick={() => setConfirmDialog({ type: 'migrate-legacy' })}
                title={hasLegacyDataUrls ? '迁移旧版 base64 背景数据' : '未检测到旧版数据'}
              >
                迁移旧数据
              </button>
              <button
                className="maintenance-btn maintenance-btn-danger"
                disabled={maintenanceBusy}
                onClick={() => setConfirmDialog({ type: 'gc-media' })}
                title="清理未被引用的 background-media 文件"
              >
                清理未使用文件
              </button>
            </div>
            {maintenanceMessage && <div className="maintenance-message">{maintenanceMessage}</div>}
          </div>

          {historyPersistError && <div className="history-persist-error">{historyPersistError}</div>}
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
                [取消] CANCEL
              </button>
              <button
                className="confirm-btn confirm-ok"
                onClick={handleConfirmDialogConfirm}
                disabled={maintenanceBusy && (confirmDialog?.type === 'gc-media' || confirmDialog?.type === 'migrate-legacy')}
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
