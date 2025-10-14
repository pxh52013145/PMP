import { useState, useCallback, memo, useEffect, useRef } from 'react';
import { BackgroundConfig, BackgroundSettings, PRESET_BACKGROUNDS } from '../../types/background';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
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

export const BackgroundManager = memo(function BackgroundManager({
  settings,
  onSettingsChange,
  currentWindowMode,
}: BackgroundManagerProps) {
  const [mode, setMode] = useState<BackgroundMode>(currentWindowMode);
  const [glitchEffect, setGlitchEffect] = useState(false);
  const [glitchPreset, setGlitchPreset] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BACKGROUND_HISTORY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 当 currentWindowMode 改变时，同步 mode
  useEffect(() => {
    setMode(currentWindowMode);
  }, [currentWindowMode]);

  // 保存历史记录到 localStorage（使用统一的 STORAGE_KEYS）
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_HISTORY, JSON.stringify(history));
  }, [history]);

  const currentConfig = settings[mode];
  const isCustomMode = ['image', 'video', 'html'].includes(currentConfig.type);

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

  // 更新当前模式的背景配置
  const updateConfig = useCallback(
    (config: Partial<BackgroundConfig>) => {
      const newSettings = {
        ...settings,
        [mode]: {
          ...currentConfig,
          ...config,
        },
      };
      onSettingsChange(newSettings);
    },
    [settings, mode, currentConfig, onSettingsChange]
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
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedUpdateConfig = useCallback(
    (config: Partial<BackgroundConfig>) => {
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // 延迟保存到 localStorage
      saveTimeoutRef.current = setTimeout(() => {
        const newSettings = {
          ...settings,
          [mode]: {
            ...currentConfig,
            ...config,
          },
        };
        onSettingsChange(newSettings);
      }, 300); // 300ms 防抖
    },
    [settings, mode, currentConfig, onSettingsChange]
  );

  // 应用预设背景
  const applyPreset = useCallback(
    (presetKey: string) => {
      const preset = PRESET_BACKGROUNDS[presetKey];
      if (preset) {
        updateConfig(preset);
      }
    },
    [updateConfig]
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
      updateConfig({ type });
    },
    [updateConfig]
  );

  // 处理颜色更改
  const handleColorChange = useCallback(
    (color: string) => {
      updateConfig({ type: 'color', color });
    },
    [updateConfig]
  );

  // 处理渐变类型更改
  const handleGradientTypeChange = useCallback(
    (gradientType: 'linear' | 'radial') => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      updateConfig({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          type: gradientType,
        },
      });
    },
    [currentConfig.gradient, updateConfig]
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
      updateConfig({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          colors: newColors,
        },
      });
    },
    [currentConfig.gradient, updateConfig]
  );

  // 添加渐变颜色
  const handleAddGradientColor = useCallback(() => {
    const currentGradient = currentConfig.gradient || {
      type: 'linear',
      colors: ['#667eea', '#764ba2'],
      angle: 135,
    };
    if (currentGradient.colors.length < 5) {
      updateConfig({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          colors: [...currentGradient.colors, '#ffffff'],
        },
      });
    }
  }, [currentConfig.gradient, updateConfig]);

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
        updateConfig({
          type: 'gradient',
          gradient: {
            ...currentGradient,
            colors: newColors,
          },
        });
      }
    },
    [currentConfig.gradient, updateConfig]
  );

  // 处理渐变角度更改
  const handleGradientAngleChange = useCallback(
    (angle: number) => {
      const currentGradient = currentConfig.gradient || {
        type: 'linear',
        colors: ['#667eea', '#764ba2'],
        angle: 135,
      };
      updateConfig({
        type: 'gradient',
        gradient: {
          ...currentGradient,
          angle,
        },
      });
    },
    [currentConfig.gradient, updateConfig]
  );

  // 处理自定义类型按钮点击（只切换类型，不打开窗口）
  const handleCustomTypeClick = useCallback(() => {
    if (!isCustomMode) {
      // 切换到自定义类型，设置默认的图片类型（纯黑背景）
      updateConfig({
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
  }, [isCustomMode, updateConfig]);

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
      config: { ...currentConfig },
      timestamp: Date.now(),
    };
    setHistory((prev) => [newItem, ...prev].slice(0, 20)); // 最多保存20条
  }, [currentConfig]);

  // 从历史记录恢复配置
  const handleRestoreFromHistory = useCallback(
    (item: HistoryItem) => {
      updateConfig(item.config);
    },
    [updateConfig]
  );

  // 删除历史记录
  const handleDeleteHistory = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // 清空历史记录
  const handleClearHistory = useCallback(() => {
    if (confirm('确定要清空所有历史记录吗？')) {
      setHistory([]);
    }
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
        if (config.image?.url) {
          return {
            backgroundImage: `url(${config.image.url})`,
            backgroundSize: config.image.fit || 'cover',
            backgroundPosition: config.image.position || 'center center',
            backgroundRepeat: config.image.repeat || 'no-repeat',
          };
        }
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
        </div>
      </div>
    </div>
  );
});
