import { memo, useState, useCallback, useEffect } from 'react';
import './StyleEditor.css';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastSignal } from '../../utils/windowCommunication';
import { readJson, readString, writeJson, writeString } from '../../modules/storage';

/**
 * Pixel 形状预设
 */
interface PixelShapePreset {
  id: string;
  name: string;
  shape: 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';
  description: string;
}

const PIXEL_SHAPE_PRESETS: PixelShapePreset[] = [
  {
    id: 'circle',
    name: '圆形 (默认)',
    shape: 'circle',
    description: '经典的圆形像素点',
  },
  {
    id: 'square',
    name: '方形',
    shape: 'square',
    description: '像素艺术风格的方块',
  },
  {
    id: 'rounded-square',
    name: '圆角方形',
    shape: 'rounded-square',
    description: '现代感的圆角矩形',
  },
  {
    id: 'diamond',
    name: '菱形',
    shape: 'diamond',
    description: '旋转45度的菱形',
  },
  {
    id: 'hexagon',
    name: '六边形',
    shape: 'hexagon',
    description: '蜂窝状的六边形',
  },
];

/**
 * 背景效果预设
 */
interface BackgroundEffectPreset {
  id: string;
  name: string;
  description: string;
}

const BACKGROUND_EFFECT_PRESETS: BackgroundEffectPreset[] = [
  {
    id: 'glow-pulse',
    name: '光晕脉冲',
    description: '窗口整体呼吸灯效果',
  },
  {
    id: 'scan-line',
    name: '扫描线',
    description: '科幻扫描线效果',
  },
  {
    id: 'matrix-rain',
    name: '字符雨',
    description: '黑客帝国数字雨',
  },
  {
    id: 'particles',
    name: '粒子星空',
    description: '密集浮动光点',
  },
  {
    id: 'none',
    name: '无效果',
    description: '关闭背景效果',
  },
];

/**
 * 边框效果预设
 */
interface BorderEffectPreset {
  id: string;
  name: string;
  description: string;
}

const BORDER_EFFECT_PRESETS: BorderEffectPreset[] = [
  {
    id: 'standard',
    name: '标准',
    description: '应用主题颜色',
  },
  {
    id: 'pulse',
    name: '脉冲',
    description: '呼吸灯效果',
  },
  {
    id: 'glitch',
    name: '故障',
    description: '赛博朋克闪烁',
  },
  {
    id: 'none',
    name: '无效果',
    description: '关闭边框效果',
  },
];

/**
 * 颜色主题预设
 */
interface ColorThemePreset {
  id: string;
  name: string;
  rgb: [number, number, number];
}

const COLOR_THEME_PRESETS: ColorThemePreset[] = [
  { id: 'cyan', name: '青色', rgb: [0, 255, 136] },
  { id: 'red', name: '红色', rgb: [255, 59, 48] },
  { id: 'blue', name: '蓝色', rgb: [10, 132, 255] },
  { id: 'purple', name: '紫色', rgb: [191, 90, 242] },
  { id: 'gold', name: '金色', rgb: [255, 204, 0] },
  { id: 'rainbow', name: '彩虹', rgb: [0, 255, 136] }, // 基础色是青色，但会进行色相循环
];

export const StyleEditor = memo(function StyleEditor() {
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
          name: '自定义',
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
  }, []);

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
            Pixel 形状
          </h3>
          <p className="section-description">自定义 Pixel 点阵的形状样式</p>

          <div className="preset-grid">
            {PIXEL_SHAPE_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card preset-card-icon-only ${selectedPixelShape === preset.id ? 'active' : ''}`}
                onClick={() => applyPixelShape(preset.id)}
                title={preset.name}
              >
                <span className="preset-shape-preview" data-shape={preset.shape}></span>
                {selectedPixelShape === preset.id && <span className="preset-badge">✓</span>}
              </div>
            ))}
          </div>

          {/* Pixel 尺寸调整 */}
          <div className="pixel-size-control">
            <label className="size-label">
              <span>Pixel 尺寸</span>
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
              <span>Pixel 透明度</span>
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

        {/* 背景效果 */}
        <section className="style-section">
          <h3 className="section-title">
            <span className="section-icon">◫</span>
            背景效果
          </h3>
          <p className="section-description">为主窗口添加全屏背景效果</p>

          <div className="preset-grid">
            {BACKGROUND_EFFECT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${selectedBackgroundEffect === preset.id ? 'active' : ''}`}
                onClick={() => applyBackgroundEffect(preset.id)}
              >
                <div className="preset-header">
                  <span className="preset-name">{preset.name}</span>
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
                title={theme.name}
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
              title="自定义颜色"
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
            边框效果
          </h3>
          <p className="section-description">为窗口边框添加动态效果</p>

          <div className="preset-grid">
            {BORDER_EFFECT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${selectedBorderEffect === preset.id ? 'active' : ''}`}
                onClick={() => applyBorderEffect(preset.id)}
              >
                <div className="preset-header">
                  <span className="preset-name">{preset.name}</span>
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
                title={theme.name}
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
              title="自定义颜色"
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
});
