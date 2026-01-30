import { memo, useState, useCallback, useEffect } from 'react';
import './StyleEditor.css';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, broadcastSignal } from '../../utils/windowCommunication';
import { readJson, readString, writeJson, writeString } from '../../modules/storage';
import { useT } from '../../i18n';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import type { DynamicColorConfig, DynamicColorEffect } from '../../themes/types/theme';
import { isTauriRuntime } from '../../utils/tauriRuntime';

/**
 * Pixel 形状预设
 */
interface PixelShapePreset {
  id: string;
  nameKey: string;
  shape: 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';
  descriptionKey: string;
}

const PIXEL_SHAPE_PRESETS: PixelShapePreset[] = [
  {
    id: 'circle',
    nameKey: 'editor.style-editor.pixelShape.circle.name',
    shape: 'circle',
    descriptionKey: 'editor.style-editor.pixelShape.circle.desc',
  },
  {
    id: 'square',
    nameKey: 'editor.style-editor.pixelShape.square.name',
    shape: 'square',
    descriptionKey: 'editor.style-editor.pixelShape.square.desc',
  },
  {
    id: 'rounded-square',
    nameKey: 'editor.style-editor.pixelShape.rounded-square.name',
    shape: 'rounded-square',
    descriptionKey: 'editor.style-editor.pixelShape.rounded-square.desc',
  },
  {
    id: 'diamond',
    nameKey: 'editor.style-editor.pixelShape.diamond.name',
    shape: 'diamond',
    descriptionKey: 'editor.style-editor.pixelShape.diamond.desc',
  },
  {
    id: 'hexagon',
    nameKey: 'editor.style-editor.pixelShape.hexagon.name',
    shape: 'hexagon',
    descriptionKey: 'editor.style-editor.pixelShape.hexagon.desc',
  },
];

/**
 * 背景效果预设
 */
interface BackgroundEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

const BACKGROUND_EFFECT_PRESETS: BackgroundEffectPreset[] = [
  {
    id: 'glow-pulse',
    nameKey: 'editor.style-editor.backgroundEffect.glow-pulse.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.glow-pulse.desc',
  },
  {
    id: 'scan-line',
    nameKey: 'editor.style-editor.backgroundEffect.scan-line.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.scan-line.desc',
  },
  {
    id: 'matrix-rain',
    nameKey: 'editor.style-editor.backgroundEffect.matrix-rain.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.matrix-rain.desc',
  },
  {
    id: 'particles',
    nameKey: 'editor.style-editor.backgroundEffect.particles.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.particles.desc',
  },
  {
    id: 'none',
    nameKey: 'editor.style-editor.backgroundEffect.none.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.none.desc',
  },
];

/**
 * 边框效果预设
 */
interface BorderEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

const BORDER_EFFECT_PRESETS: BorderEffectPreset[] = [
  {
    id: 'standard',
    nameKey: 'editor.style-editor.borderEffect.standard.name',
    descriptionKey: 'editor.style-editor.borderEffect.standard.desc',
  },
  {
    id: 'pulse',
    nameKey: 'editor.style-editor.borderEffect.pulse.name',
    descriptionKey: 'editor.style-editor.borderEffect.pulse.desc',
  },
  {
    id: 'glitch',
    nameKey: 'editor.style-editor.borderEffect.glitch.name',
    descriptionKey: 'editor.style-editor.borderEffect.glitch.desc',
  },
  {
    id: 'none',
    nameKey: 'editor.style-editor.borderEffect.none.name',
    descriptionKey: 'editor.style-editor.borderEffect.none.desc',
  },
];

/**
 * 颜色主题预设
 */
interface ColorThemePreset {
  id: string;
  nameKey: string;
  rgb: [number, number, number];
}

const COLOR_THEME_PRESETS: ColorThemePreset[] = [
  { id: 'cyan', nameKey: 'editor.style-editor.colorTheme.cyan', rgb: [0, 255, 136] },
  { id: 'red', nameKey: 'editor.style-editor.colorTheme.red', rgb: [255, 59, 48] },
  { id: 'blue', nameKey: 'editor.style-editor.colorTheme.blue', rgb: [10, 132, 255] },
  { id: 'purple', nameKey: 'editor.style-editor.colorTheme.purple', rgb: [191, 90, 242] },
  { id: 'gold', nameKey: 'editor.style-editor.colorTheme.gold', rgb: [255, 204, 0] },
  { id: 'rainbow', nameKey: 'editor.style-editor.colorTheme.rainbow', rgb: [0, 255, 136] }, // 基础色是青色，但会进行色相循环
];

interface CoverColorEffectPreset {
  id: DynamicColorEffect;
  nameKey: string;
  descriptionKey: string;
}

const COVER_COLOR_EFFECT_PRESETS: CoverColorEffectPreset[] = [
  {
    id: 'tone',
    nameKey: 'editor.style-editor.coverColor.effect.tone.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.tone.desc',
  },
  {
    id: 'gradient',
    nameKey: 'editor.style-editor.coverColor.effect.gradient.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.gradient.desc',
  },
  {
    id: 'dynamic',
    nameKey: 'editor.style-editor.coverColor.effect.dynamic.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.dynamic.desc',
  },
];

function normalizeCoverColorEffect(value: unknown): DynamicColorEffect {
  if (value === 'tone' || value === 'gradient' || value === 'dynamic') return value;
  return 'tone';
}

function normalizeCoverGradientAngle(value: unknown): number {
  const fallback = 90;
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return ((value % 360) + 360) % 360;
}

function normalizeCoverDynamicSpeed(value: unknown): number {
  const fallback = 6;
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return Math.max(2, Math.min(20, value));
}

export const StyleEditor = memo(function StyleEditor() {
  const t = useT();
  const { theme, applyTheme, getComponentTheme } = useTheme();
  const isTauri = isTauriRuntime();

  const handleOpenOrnamentsEditor = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING,
        true,
        TAURI_EVENTS.ORNAMENTS_OVERLAY_EDITING_UPDATED
      );

      const { calculateWindowPosition, openEditorWindow } = await import('../../utils/editorWindows');
      const position = await calculateWindowPosition('ornaments');
      await openEditorWindow({ type: 'ornaments', ...position });
    } catch (error) {
      console.error('[StyleEditor] Failed to open ornaments editor window:', error);
    }
  }, []);

  const currentCoverColorConfig: DynamicColorConfig = (() => {
    const trackInfoConfig = getComponentTheme('track-info').dynamicColor;
    const progressBarConfig = getComponentTheme('progress-bar').dynamicColor;
    return (trackInfoConfig ?? progressBarConfig ?? {}) as DynamicColorConfig;
  })();

  const coverColorEnabled = currentCoverColorConfig.extractFromCover !== false;
  const coverColorEffect = normalizeCoverColorEffect(currentCoverColorConfig.effect);
  const coverColorGradientAngle = normalizeCoverGradientAngle(currentCoverColorConfig.gradientAngle);
  const coverColorDynamicSpeed = normalizeCoverDynamicSpeed(currentCoverColorConfig.dynamicSpeed);

  const applyCoverColorConfig = useCallback(
    async (partial: Partial<DynamicColorConfig>) => {
      const currentTrackInfoTheme = getComponentTheme('track-info');
      const currentProgressBarTheme = getComponentTheme('progress-bar');

      const nextTheme = {
        ...theme,
        componentThemes: {
          ...(theme.componentThemes ?? {}),
          'track-info': {
            ...currentTrackInfoTheme,
            dynamicColor: {
              ...(currentTrackInfoTheme.dynamicColor ?? {}),
              ...partial,
            },
          },
          'progress-bar': {
            ...currentProgressBarTheme,
            dynamicColor: {
              ...(currentProgressBarTheme.dynamicColor ?? {}),
              ...partial,
            },
          },
        },
      };

      await applyTheme(nextTheme);
    },
    [applyTheme, getComponentTheme, theme]
  );

  // 从 localStorage 读取初始值（使用统一的 STORAGE_KEYS）
  const [selectedPixelShape, setSelectedPixelShape] = useState(() => {
    return readString(STORAGE_KEYS.PIXEL_SHAPE) || 'circle';
  });
  const [selectedBackgroundEffect, setSelectedBackgroundEffect] = useState(() => {
    return readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
  });
  const [selectedBorderEffect, setSelectedBorderEffect] = useState(() => {
    return readString(STORAGE_KEYS.BORDER_EFFECT) || 'none';
  });
  const [pixelSize, setPixelSize] = useState(() => {
    const savedSize = readString(STORAGE_KEYS.PIXEL_SIZE);
    return savedSize ? Math.round(parseFloat(savedSize) * 100) : 100;
  });
  const [pixelOpacity, setPixelOpacity] = useState(() => {
    const savedOpacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
    return savedOpacity ? Math.round(parseFloat(savedOpacity) * 100) : 100;
  });
  const [backgroundThemeColor, setBackgroundThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] });
  });
  const [borderThemeColor, setBorderThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BORDER_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] });
  });

  // 应用 Pixel 形状设置
  const applyPixelShape = async (presetId: string) => {
    setSelectedPixelShape(presetId);
    writeString(STORAGE_KEYS.PIXEL_SHAPE, presetId);

    // 触发全局事件通知主窗口更新 Pixel 形状
    await broadcastSignal(TAURI_EVENTS.PIXEL_SHAPE_UPDATED);
  };

  // 应用 Pixel 尺寸设置
  const handlePixelSizeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setPixelSize(value);

    // 转换为 0.5-1.0 的比例
    const scale = value / 100;
    writeString(STORAGE_KEYS.PIXEL_SIZE, scale.toString());

    // 触发全局事件
    await broadcastSignal(TAURI_EVENTS.PIXEL_SIZE_UPDATED);
  };

  // 应用 Pixel 透明度设置
  const handlePixelOpacityChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setPixelOpacity(value);

    // 转换为 0.0-1.0 的比例
    const opacity = value / 100;
    writeString(STORAGE_KEYS.PIXEL_OPACITY, opacity.toString());

    // 触发全局事件
    await broadcastSignal(TAURI_EVENTS.PIXEL_OPACITY_UPDATED);
  };

  // 应用背景效果设置
  const applyBackgroundEffect = async (presetId: string) => {
    setSelectedBackgroundEffect(presetId);
    writeString(STORAGE_KEYS.BACKGROUND_EFFECT, presetId);

    // 触发全局事件通知主窗口更新背景效果
    await broadcastSignal(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED);
  };

  // 应用边框效果设置
  const applyBorderEffect = async (presetId: string) => {
    setSelectedBorderEffect(presetId);
    writeString(STORAGE_KEYS.BORDER_EFFECT, presetId);

    // 触发全局事件通知主窗口更新边框效果
    await broadcastSignal(TAURI_EVENTS.BORDER_EFFECT_UPDATED);
  };

  // 应用背景颜色主题
  const applyBackgroundThemeColor = useCallback(async (theme: ColorThemePreset) => {
    const themeData = { id: theme.id, rgb: theme.rgb };
    setBackgroundThemeColor(themeData);
    writeJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, themeData);

    // 设置CSS变量
    document.documentElement.style.setProperty('--bg-theme-color-r', theme.rgb[0].toString());
    document.documentElement.style.setProperty('--bg-theme-color-g', theme.rgb[1].toString());
    document.documentElement.style.setProperty('--bg-theme-color-b', theme.rgb[2].toString());

    // 触发全局事件
    await broadcastSignal(TAURI_EVENTS.BACKGROUND_THEME_COLOR_UPDATED);
  }, []);

  // 应用边框颜色主题
  const applyBorderThemeColor = useCallback(async (theme: ColorThemePreset) => {
    const themeData = { id: theme.id, rgb: theme.rgb };
    setBorderThemeColor(themeData);
    writeJson(STORAGE_KEYS.BORDER_THEME_COLOR, themeData);

    // 设置CSS变量
    document.documentElement.style.setProperty('--border-theme-color-r', theme.rgb[0].toString());
    document.documentElement.style.setProperty('--border-theme-color-g', theme.rgb[1].toString());
    document.documentElement.style.setProperty('--border-theme-color-b', theme.rgb[2].toString());

    // 触发全局事件
    await broadcastSignal(TAURI_EVENTS.BORDER_THEME_COLOR_UPDATED);
  }, []);

  // 打开颜色选择器
  const openColorPicker = useCallback(
    async (type: 'background' | 'border', event: React.MouseEvent<HTMLButtonElement>) => {
      // 创建一个临时的input元素来触发原生颜色选择器
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-picker-input';

      // 定位在按钮位置
      const button = event.currentTarget;
      const rect = button.getBoundingClientRect();
      input.style.position = 'fixed';
      input.style.left = `${rect.left}px`;
      input.style.top = `${rect.top}px`;
      input.style.opacity = '0';
      input.style.width = '0';
      input.style.height = '0';

      // 设置当前颜色
      const currentColor = type === 'background' ? backgroundThemeColor.rgb : borderThemeColor.rgb;
      input.value = `#${currentColor.map((c: number) => c.toString(16).padStart(2, '0')).join('')}`;

      const handleColorChange = async (e: Event) => {
        const color = (e.target as HTMLInputElement).value;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        const customTheme: ColorThemePreset = {
          id: 'custom',
          nameKey: 'editor.style-editor.colorTheme.custom',
          rgb: [r, g, b],
        };

        if (type === 'background') {
          await applyBackgroundThemeColor(customTheme);
        } else {
          await applyBorderThemeColor(customTheme);
        }

        // 颜色选择完成后移除元素
        input.removeEventListener('change', handleColorChange);
        input.removeEventListener('blur', handleBlur);
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      };

      const handleBlur = () => {
        // 延迟移除，确保用户有时间选择颜色
        setTimeout(() => {
          input.removeEventListener('change', handleColorChange);
          input.removeEventListener('blur', handleBlur);
          if (document.body.contains(input)) {
            document.body.removeChild(input);
          }
        }, 100);
      };

      input.addEventListener('change', handleColorChange);
      input.addEventListener('blur', handleBlur);
      document.body.appendChild(input);

      // 使用 setTimeout 确保 input 已经添加到 DOM
      setTimeout(() => {
        input.click();
      }, 0);
    },
    [backgroundThemeColor, borderThemeColor, applyBackgroundThemeColor, applyBorderThemeColor]
  );

  // 初始化时应用颜色主题
  useEffect(() => {
    // 应用背景颜色主题
    document.documentElement.style.setProperty(
      '--bg-theme-color-r',
      backgroundThemeColor.rgb[0].toString()
    );
    document.documentElement.style.setProperty(
      '--bg-theme-color-g',
      backgroundThemeColor.rgb[1].toString()
    );
    document.documentElement.style.setProperty(
      '--bg-theme-color-b',
      backgroundThemeColor.rgb[2].toString()
    );

    // 应用边框颜色主题
    document.documentElement.style.setProperty(
      '--border-theme-color-r',
      borderThemeColor.rgb[0].toString()
    );
    document.documentElement.style.setProperty(
      '--border-theme-color-g',
      borderThemeColor.rgb[1].toString()
    );
    document.documentElement.style.setProperty(
      '--border-theme-color-b',
      borderThemeColor.rgb[2].toString()
    );
  }, [backgroundThemeColor.rgb, borderThemeColor.rgb]);

  return (
    <div className="editor-style-editor">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* Pixel 样式 */}
        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">⬡</span>
            {t('editor.style-editor.section.pixelShape.title')}
          </h3>
          <p className="section-description">{t('editor.style-editor.section.pixelShape.desc')}</p>

          <div className="preset-grid">
            {PIXEL_SHAPE_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card preset-card-icon-only ${selectedPixelShape === preset.id ? 'active' : ''}`}
                onClick={() => applyPixelShape(preset.id)}
                title={t(preset.nameKey)}
              >
                <span className="preset-shape-preview" data-shape={preset.shape}></span>
                {selectedPixelShape === preset.id && <span className="preset-badge">✓</span>}
              </div>
            ))}
          </div>

          {/* Pixel 尺寸调整 */}
          <div className="pixel-size-control">
            <label className="size-label">
              <span>{t('editor.style-editor.pixelSize.label')}</span>
              <span className="size-value">{pixelSize}%</span>
            </label>
            <input
              type="range"
              min="50"
              max="100"
              value={pixelSize}
              onChange={handlePixelSizeChange}
              className="size-slider"
            />
            <div className="size-hints">
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Pixel 透明度调整 */}
          <div className="pixel-size-control">
            <label className="size-label">
              <span>{t('editor.style-editor.pixelOpacity.label')}</span>
              <span className="size-value">{pixelOpacity}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={pixelOpacity}
              onChange={handlePixelOpacityChange}
              className="size-slider"
            />
            <div className="size-hints">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
        </section>

        {/* Cover Color */}
        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">◈</span>
            {t('editor.style-editor.section.coverColor.title')}
          </h3>
          <p className="section-description">{t('editor.style-editor.section.coverColor.desc')}</p>

          <div
            className={`preset-card ${coverColorEnabled ? 'active' : ''}`}
            onClick={() => void applyCoverColorConfig({ extractFromCover: !coverColorEnabled })}
          >
            <div className="preset-header">
              <span className="preset-name">{t('editor.style-editor.coverColor.enable')}</span>
            </div>
          </div>

          <div className="preset-grid">
            {COVER_COLOR_EFFECT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${coverColorEffect === preset.id ? 'active' : ''}`}
                onClick={() => void applyCoverColorConfig({ effect: preset.id })}
                title={t(preset.descriptionKey)}
              >
                <div className="preset-header">
                  <span className="preset-name">{t(preset.nameKey)}</span>
                </div>
              </div>
            ))}
          </div>

          {(coverColorEffect === 'gradient' || coverColorEffect === 'dynamic') && (
            <div className="pixel-size-control">
              <label className="size-label">
                <span>{t('editor.style-editor.coverColor.gradientAngle.label')}</span>
                <span className="size-value">{Math.round(coverColorGradientAngle)}°</span>
              </label>
              <input
                type="range"
                min="0"
                max="360"
                value={Math.round(coverColorGradientAngle)}
                onChange={(e) =>
                  void applyCoverColorConfig({
                    gradientAngle: parseInt(e.target.value, 10),
                  })
                }
                className="size-slider"
              />
              <div className="size-hints">
                <span>0°</span>
                <span>360°</span>
              </div>
            </div>
          )}

          {coverColorEffect === 'dynamic' && (
            <div className="pixel-size-control">
              <label className="size-label">
                <span>{t('editor.style-editor.coverColor.dynamicSpeed.label')}</span>
                <span className="size-value">{coverColorDynamicSpeed.toFixed(1)}s</span>
              </label>
              <input
                type="range"
                min="2"
                max="20"
                step="0.5"
                value={coverColorDynamicSpeed}
                onChange={(e) =>
                  void applyCoverColorConfig({
                    dynamicSpeed: parseFloat(e.target.value),
                  })
                }
                className="size-slider"
              />
              <div className="size-hints">
                <span>2s</span>
                <span>20s</span>
              </div>
            </div>
          )}
        </section>

        {/* 背景效果 */}
        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">◫</span>
            {t('editor.style-editor.section.backgroundEffect.title')}
          </h3>
          <p className="section-description">
            {t('editor.style-editor.section.backgroundEffect.desc')}
          </p>

          <div className="preset-grid">
            {BACKGROUND_EFFECT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${selectedBackgroundEffect === preset.id ? 'active' : ''}`}
                onClick={() => applyBackgroundEffect(preset.id)}
              >
                <div className="preset-header">
                  <span className="preset-name">{t(preset.nameKey)}</span>
                  {selectedBackgroundEffect === preset.id && (
                    <span className="preset-badge">✓</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 背景颜色主题选择器 */}
          <div className="color-theme-selector">
            {COLOR_THEME_PRESETS.map((theme) => (
              <button
                key={theme.id}
                className={`color-theme-btn ${theme.id === 'rainbow' ? 'rainbow-theme' : ''} ${backgroundThemeColor.id === theme.id ? 'active' : ''}`}
                onClick={() => applyBackgroundThemeColor(theme)}
                title={t(theme.nameKey)}
                style={
                  theme.id !== 'rainbow'
                    ? {
                        backgroundColor: `rgb(${theme.rgb.join(',')})`,
                      }
                    : undefined
                }
              />
            ))}
            <button
              className="color-theme-btn color-picker-btn"
              onClick={(e) => openColorPicker('background', e)}
              title={t('editor.style-editor.colorTheme.customColorTitle')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          </div>
        </section>

        {/* 边框效果 */}
        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">◻</span>
            {t('editor.style-editor.section.borderEffect.title')}
          </h3>
          <p className="section-description">{t('editor.style-editor.section.borderEffect.desc')}</p>

          <div className="preset-grid">
            {BORDER_EFFECT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${selectedBorderEffect === preset.id ? 'active' : ''}`}
                onClick={() => applyBorderEffect(preset.id)}
              >
                <div className="preset-header">
                  <span className="preset-name">{t(preset.nameKey)}</span>
                  {selectedBorderEffect === preset.id && <span className="preset-badge">✓</span>}
                </div>
              </div>
            ))}
          </div>

          {/* 边框颜色主题选择器 */}
          <div className="color-theme-selector">
            {COLOR_THEME_PRESETS.map((theme) => (
              <button
                key={theme.id}
                className={`color-theme-btn ${theme.id === 'rainbow' ? 'rainbow-theme' : ''} ${borderThemeColor.id === theme.id ? 'active' : ''}`}
                onClick={() => applyBorderThemeColor(theme)}
                title={t(theme.nameKey)}
                style={
                  theme.id !== 'rainbow'
                    ? {
                        backgroundColor: `rgb(${theme.rgb.join(',')})`,
                      }
                    : undefined
                }
              />
            ))}
            <button
              className="color-theme-btn color-picker-btn"
              onClick={(e) => openColorPicker('border', e)}
              title={t('editor.style-editor.colorTheme.customColorTitle')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          </div>
        </section>

        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">◎</span>
            {t('editor.style-editor.section.ornaments.title')}
          </h3>
          <p className="section-description">{t('editor.style-editor.section.ornaments.desc')}</p>

          <button
            type="button"
            className="preset-card style-ornaments-entry-btn"
            onClick={() => void handleOpenOrnamentsEditor()}
            disabled={!isTauri}
          >
            <div className="preset-header">
              <span className="preset-name">{t('editor.style-editor.ornaments.openEditor')}</span>
            </div>
          </button>
        </section>
      </div>
    </div>
  );
});
