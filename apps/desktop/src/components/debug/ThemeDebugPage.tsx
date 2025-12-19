import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { TrackInfo } from '../magnet/trackInfo/TrackInfo';
import { ProgressBar } from '../magnet/progressBar/ProgressBar';
import { PlayPauseButton, PreviousButton, NextButton } from '../magnet/PlaybackControls';
import { PlayModeButton } from '../magnet/PlayModeButton';
import { VolumeControl } from '../magnet/VolumeControl';
import { PlayQueueButton } from '../magnet/PlayQueueButton';
import { PlaylistsButton } from '../magnet/PlaylistsButton';
import { MusicLibraryButton } from '../magnet/MusicLibraryButton';
import { BackButton } from '../magnet/BackButton';
import { WindowPinButton } from '../magnet/WindowPinButton';
import { DebugButton } from '../magnet/DebugButton';
import { listRegisteredMagnetRenderers } from '../../magnet-system/registry';
import { listMagnetVariants } from '../../magnet-system/variantRegistry';
import './ThemeDebugPage.css';

const LEGACY_THEME_KEYS: Record<string, string[]> = {
  'btn-play-pause': ['play-pause-button'],
  'btn-previous': ['previous-button'],
  'btn-next': ['next-button'],
  'btn-mode': ['play-mode'],
  'btn-back': ['back-button'],
  'btn-volume': ['volume-control'],
};

function resolveVariantFromTheme(themeValue: any, componentId: string, fallback: string): string {
  const direct = themeValue?.componentThemes?.[componentId]?.variant;
  if (typeof direct === 'string') return direct;

  const legacyKeys = LEGACY_THEME_KEYS[componentId] ?? [];
  for (const legacyKey of legacyKeys) {
    const legacyVariant = themeValue?.componentThemes?.[legacyKey]?.variant;
    if (typeof legacyVariant === 'string') return legacyVariant;
  }

  return fallback;
}

/**
 * 主题系统调试页面
 * 用于测试和开发主题、着色器系统
 */
export const ThemeDebugPage: React.FC = () => {
  const { theme, applyTheme, updateComponentTheme, getComponentTheme } = useTheme();
  const [selectedTheme] = useState<string>('default');
  const [selectedMagnet, setSelectedMagnet] = useState<string>('track-info');
  const [configMode, setConfigMode] = useState<'global' | 'component'>('component');
  const [trackInfoVariant, setTrackInfoVariant] = useState<string>(
    getComponentTheme('track-info').variant || 'default'
  );
  const [progressBarVariant, setProgressBarVariant] = useState<string>(
    getComponentTheme('progress-bar').variant || 'default'
  );
  const [playPauseVariant, setPlayPauseVariant] = useState<string>(
    getComponentTheme('btn-play-pause').variant || 'default'
  );
  const [previousVariant, setPreviousVariant] = useState<string>(
    getComponentTheme('btn-previous').variant || 'default'
  );
  const [nextVariant, setNextVariant] = useState<string>(
    getComponentTheme('btn-next').variant || 'default'
  );
  const [playModeVariant, setPlayModeVariant] = useState<string>(
    getComponentTheme('btn-mode').variant || 'default'
  );
  const [backButtonVariant, setBackButtonVariant] = useState<string>(
    getComponentTheme('btn-back').variant || 'default'
  );
  const [volumeVariant, setVolumeVariant] = useState<string>(
    getComponentTheme('btn-volume').variant || 'default'
  );
  const [themeJson, setThemeJson] = useState<string>(JSON.stringify(theme, null, 2));
  const [rendererList, setRendererList] = useState(() => listRegisteredMagnetRenderers());

  useEffect(() => {
    setThemeJson(JSON.stringify(theme, null, 2));
  }, [theme]);

  const refreshRenderers = useCallback(() => {
    setRendererList(listRegisteredMagnetRenderers());
  }, []);

  const handleApplyThemeJson = () => {
    try {
      const parsed = JSON.parse(themeJson);
      applyTheme(parsed);
    } catch (error) {
      alert('主题 JSON 解析失败，请检查格式');
      console.error('[ThemeDebug] Failed to parse theme json', error);
    }
  };

  const handleThemeFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await applyTheme(parsed);
      setThemeJson(JSON.stringify(parsed, null, 2));
      alert(`已加载主题文件：${file.name}`);
    } catch (error) {
      alert('读取主题文件失败，请确认 JSON 格式');
      console.error('[ThemeDebug] Failed to load theme file', error);
    }
  };

  return (
    <div className="theme-debug-page">
      {/* 拖动区域标题栏 */}
      <div className="debug-header" data-tauri-drag-region>
        <div className="header-content" data-tauri-drag-region>
          <h1 data-tauri-drag-region>🎨 主题系统调试</h1>
          <p className="debug-subtitle" data-tauri-drag-region>
            Theme & Shader System Development Panel
          </p>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="debug-main">
        {/* 左侧：控制面板 */}
        <div className="debug-control-panel">
          <div className="control-section">
            <h2>配置模式</h2>
            <div className="mode-selector">
              <button
                className={`mode-btn ${configMode === 'global' ? 'active' : ''}`}
                onClick={() => setConfigMode('global')}
              >
                全局主题
              </button>
              <button
                className={`mode-btn ${configMode === 'component' ? 'active' : ''}`}
                onClick={() => setConfigMode('component')}
              >
                单独配置
              </button>
            </div>
          </div>

          {/* 全局主题配置 */}
          {configMode === 'global' && (
            <div className="control-section">
              <h2>主题 JSON</h2>
              <textarea
                className="theme-json-editor"
                value={themeJson}
                onChange={(e) => setThemeJson(e.target.value)}
                spellCheck={false}
              ></textarea>
              <div className="theme-json-actions">
                <label className="theme-file-upload">
                  导入文件
                  <input type="file" accept="application/json" onChange={handleThemeFileUpload} />
                </label>
                <button onClick={() => navigator.clipboard.writeText(themeJson)}>复制 JSON</button>
                <button onClick={handleApplyThemeJson}>应用 JSON</button>
              </div>
            </div>
          )}

          {/* 单独配置模式 */}
          {configMode === 'component' && (
            <>
              <div className="control-section">
                <h2>选择组件</h2>
                <select
                  className="magnet-selector"
                  value={selectedMagnet}
                  onChange={(e) => setSelectedMagnet(e.target.value)}
                >
                  <optgroup label="核心组件">
                    <option value="track-info">TrackInfo - 歌曲信息</option>
                    <option value="progress-bar">ProgressBar - 进度条</option>
                  </optgroup>
                  <optgroup label="播放控制">
                    <option value="btn-play-pause">PlayPause - 播放/暂停</option>
                    <option value="btn-previous">Previous - 上一首</option>
                    <option value="btn-next">Next - 下一首</option>
                    <option value="btn-mode">PlayMode - 播放模式</option>
                    <option value="btn-volume">Volume - 音量控制</option>
                  </optgroup>
                  <optgroup label="音乐库">
                    <option value="btn-music-library">MusicLibrary - 音乐库</option>
                    <option value="btn-playlists">Playlists - 歌单</option>
                    <option value="btn-play-queue">PlayQueue - 播放列表</option>
                  </optgroup>
                  <optgroup label="导航">
                    <option value="btn-back">Back - 返回按钮</option>
                  </optgroup>
                  <optgroup label="系统">
                    <option value="btn-window-pin">WindowPin - 窗口置顶</option>
                    <option value="btn-debug">Debug - 调试按钮</option>
                  </optgroup>
                </select>
              </div>

              <div className="control-section">
                <h2>组件配置</h2>
                <ComponentConfigPanel
                  selectedMagnet={selectedMagnet}
                  trackInfoVariant={trackInfoVariant}
                  progressBarVariant={progressBarVariant}
                  playPauseVariant={playPauseVariant}
                  previousVariant={previousVariant}
                  nextVariant={nextVariant}
                  playModeVariant={playModeVariant}
                  backButtonVariant={backButtonVariant}
                  volumeVariant={volumeVariant}
                  onTrackInfoVariantChange={(variant) => {
                    setTrackInfoVariant(variant);
                    updateComponentTheme('track-info', {
                      ...getComponentTheme('track-info'),
                      variant,
                    });
                  }}
                  onProgressBarVariantChange={(variant) => {
                    setProgressBarVariant(variant);
                    updateComponentTheme('progress-bar', {
                      ...getComponentTheme('progress-bar'),
                      variant,
                    });
                  }}
                  onPlayPauseVariantChange={(variant) => {
                    setPlayPauseVariant(variant);
                    updateComponentTheme('btn-play-pause', {
                      ...getComponentTheme('btn-play-pause'),
                      variant,
                    });
                  }}
                  onPreviousVariantChange={(variant) => {
                    setPreviousVariant(variant);
                    updateComponentTheme('btn-previous', {
                      ...getComponentTheme('btn-previous'),
                      variant,
                    });
                  }}
                  onNextVariantChange={(variant) => {
                    setNextVariant(variant);
                    updateComponentTheme('btn-next', {
                      ...getComponentTheme('btn-next'),
                      variant,
                    });
                  }}
                  onPlayModeVariantChange={(variant) => {
                    setPlayModeVariant(variant);
                    updateComponentTheme('btn-mode', {
                      ...getComponentTheme('btn-mode'),
                      variant,
                    });
                  }}
                  onBackButtonVariantChange={(variant) => {
                    setBackButtonVariant(variant);
                    updateComponentTheme('btn-back', {
                      ...getComponentTheme('btn-back'),
                      variant,
                    });
                  }}
                  onVolumeVariantChange={(variant) => {
                    setVolumeVariant(variant);
                    updateComponentTheme('btn-volume', {
                      ...getComponentTheme('btn-volume'),
                      variant,
                    });
                  }}
                />
              </div>
            </>
          )}

          {/* 操作按钮 - 只保留有效功能 */}
          {configMode === 'component' && (
            <div className="control-section">
              <h2>操作</h2>
              <div className="action-buttons">
                <button
                  className="action-btn primary"
                  onClick={async () => {
                    try {
                      // 使用 File System Access API
                      // @ts-ignore
                      if (window.showOpenFilePicker) {
                        // @ts-ignore
                        const [fileHandle] = await window.showOpenFilePicker({
                          types: [
                            {
                              description: 'Theme Files',
                              accept: { 'application/json': ['.pmpt', '.json'] },
                            },
                          ],
                        });
                         const file = await fileHandle.getFile();
                         const text = await file.text();
                         const importedTheme = JSON.parse(text);
                         await applyTheme(importedTheme);
                         setTrackInfoVariant(resolveVariantFromTheme(importedTheme, 'track-info', 'spinning-vinyl'));
                         setProgressBarVariant(resolveVariantFromTheme(importedTheme, 'progress-bar', 'standard'));
                         setPlayPauseVariant(resolveVariantFromTheme(importedTheme, 'btn-play-pause', 'standard'));
                         setPreviousVariant(resolveVariantFromTheme(importedTheme, 'btn-previous', 'standard'));
                         setNextVariant(resolveVariantFromTheme(importedTheme, 'btn-next', 'standard'));
                         setPlayModeVariant(resolveVariantFromTheme(importedTheme, 'btn-mode', 'standard'));
                         setBackButtonVariant(resolveVariantFromTheme(importedTheme, 'btn-back', 'standard'));
                         setVolumeVariant(resolveVariantFromTheme(importedTheme, 'btn-volume', 'standard'));
                       } else {
                        // 降级到 Tauri dialog
                        const { open } = await import('@tauri-apps/api/dialog');
                        const selected = await open({
                          multiple: false,
                          filters: [{ name: 'Theme Files', extensions: ['pmpt', 'json'] }],
                        });
                        if (selected && typeof selected === 'string') {
                           const { readTextFile } = await import('@tauri-apps/api/fs');
                           const text = await readTextFile(selected);
                           const importedTheme = JSON.parse(text);
                           await applyTheme(importedTheme);
                           setTrackInfoVariant(resolveVariantFromTheme(importedTheme, 'track-info', 'spinning-vinyl'));
                           setProgressBarVariant(resolveVariantFromTheme(importedTheme, 'progress-bar', 'standard'));
                           setPlayPauseVariant(resolveVariantFromTheme(importedTheme, 'btn-play-pause', 'standard'));
                           setPreviousVariant(resolveVariantFromTheme(importedTheme, 'btn-previous', 'standard'));
                           setNextVariant(resolveVariantFromTheme(importedTheme, 'btn-next', 'standard'));
                           setPlayModeVariant(resolveVariantFromTheme(importedTheme, 'btn-mode', 'standard'));
                           setBackButtonVariant(resolveVariantFromTheme(importedTheme, 'btn-back', 'standard'));
                           setVolumeVariant(resolveVariantFromTheme(importedTheme, 'btn-volume', 'standard'));
                         }
                       }
                     } catch (error) {
                      console.error('Failed to import theme:', error);
                    }
                  }}
                >
                  📂 导入主题
                </button>
                <button
                  className="action-btn"
                  onClick={() => {
                    const configStr = JSON.stringify(theme, null, 2);
                    const blob = new Blob([configStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `theme-${theme.id}-${Date.now()}.pmpt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  📥 导出主题
                </button>
                <button
                  className="action-btn"
                  onClick={() => {
                    // 重置当前选中的组件
                    if (selectedMagnet === 'track-info') {
                      updateComponentTheme('track-info', {
                        variant: 'spinning-vinyl',
                        dynamicColor: {
                          extractFromCover: true,
                          applyMode: 'full',
                        },
                      });
                      setTrackInfoVariant('spinning-vinyl');
                    } else if (selectedMagnet === 'progress-bar') {
                      updateComponentTheme('progress-bar', {
                        variant: 'standard',
                      });
                      setProgressBarVariant('standard');
                    }
                  }}
                >
                  🔄 重置
                </button>
              </div>
            </div>
          )}

          <div className="control-section">
            <h2>Renderer 列表</h2>
            <button className="refresh-btn" onClick={refreshRenderers}>
              刷新
            </button>
            <div className="renderer-list">
              {rendererList.map((renderer) => (
                <div key={renderer.id} className="renderer-item">
                  <div className="renderer-id">{renderer.id}</div>
                  <div className="renderer-meta">
                    <span>{renderer.group || 'general'}</span>
                    <span>{renderer.source || 'builtin'}</span>
                  </div>
                  <div className="renderer-desc">{renderer.description}</div>
                </div>
              ))}
              {rendererList.length === 0 && (
                <div className="renderer-empty">暂无注册 renderer</div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：预览区域 */}
        <div className="debug-preview-panel">
          <div className="preview-header">
            <h2>实时预览</h2>
            <span className="preview-subtitle">
              {configMode === 'global' ? `主题: ${selectedTheme}` : `组件: ${selectedMagnet}`}
            </span>
          </div>

          <div className="preview-content">
            <ComponentPreviewArea selectedMagnet={selectedMagnet} />
          </div>

          {/* 预览信息 */}
          <div className="preview-info">
            <h3>当前配置</h3>
            <div className="config-display">
              <pre>
                {JSON.stringify({ theme: selectedTheme, component: selectedMagnet }, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
interface ComponentConfigPanelProps {
  selectedMagnet: string;
  trackInfoVariant: string;
  progressBarVariant: string;
  playPauseVariant: string;
  previousVariant: string;
  nextVariant: string;
  playModeVariant: string;
  backButtonVariant: string;
  volumeVariant: string;
  onTrackInfoVariantChange: (variant: string) => void;
  onProgressBarVariantChange: (variant: string) => void;
  onPlayPauseVariantChange: (variant: string) => void;
  onPreviousVariantChange: (variant: string) => void;
  onNextVariantChange: (variant: string) => void;
  onPlayModeVariantChange: (variant: string) => void;
  onBackButtonVariantChange: (variant: string) => void;
  onVolumeVariantChange: (variant: string) => void;
}

const ComponentConfigPanel: React.FC<ComponentConfigPanelProps> = ({
  selectedMagnet,
  trackInfoVariant,
  progressBarVariant,
  playPauseVariant,
  previousVariant,
  nextVariant,
  playModeVariant,
  backButtonVariant,
  volumeVariant,
  onTrackInfoVariantChange,
  onProgressBarVariantChange,
  onPlayPauseVariantChange,
  onPreviousVariantChange,
  onNextVariantChange,
  onPlayModeVariantChange,
  onBackButtonVariantChange,
  onVolumeVariantChange,
}) => {
  // TrackInfo 专用配置
  if (selectedMagnet === 'track-info') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={trackInfoVariant}
            onChange={(e) => onTrackInfoVariantChange(e.target.value)}
          >
            {listMagnetVariants('track-info').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text disabled">🔧 更多配置选项开发中...</p>
        </div>
      </div>
    );
  }

  // ProgressBar 专用配置
  if (selectedMagnet === 'progress-bar') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={progressBarVariant}
            onChange={(e) => onProgressBarVariantChange(e.target.value)}
          >
            {listMagnetVariants('progress-bar').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text disabled">🔧 更多配置选项开发中...</p>
        </div>
      </div>
    );
  }

  // 播放/暂停按钮配置
  if (selectedMagnet === 'btn-play-pause') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={playPauseVariant}
            onChange={(e) => onPlayPauseVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-play-pause').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 方形，简洁高效</p>
          <p className="info-text">🎯 Rounded: 霓虹圆形，旋转光晕</p>
        </div>
      </div>
    );
  }

  // 上一首按钮配置
  if (selectedMagnet === 'btn-previous') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={previousVariant}
            onChange={(e) => onPreviousVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-previous').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 方形，简洁高效</p>
          <p className="info-text">🎯 Rounded: 青色霓虹，360°旋转</p>
        </div>
      </div>
    );
  }

  // 下一首按钮配置
  if (selectedMagnet === 'btn-next') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={nextVariant}
            onChange={(e) => onNextVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-next').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 方形，简洁高效</p>
          <p className="info-text">🎯 Rounded: 青色霓虹，360°旋转</p>
        </div>
      </div>
    );
  }

  // 播放模式按钮配置
  if (selectedMagnet === 'btn-mode') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={playModeVariant}
            onChange={(e) => onPlayModeVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-mode').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 方形，简洁背景</p>
          <p className="info-text">🎯 Minimal: 彩虹光环，脉冲波纹</p>
        </div>
      </div>
    );
  }

  // 返回按钮配置
  if (selectedMagnet === 'btn-back') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={backButtonVariant}
            onChange={(e) => onBackButtonVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-back').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 方形，简单平移</p>
          <p className="info-text">🎯 Rounded: 时空漩涡，残影轨迹</p>
        </div>
      </div>
    );
  }

  // 音量控制配置
  if (selectedMagnet === 'btn-volume') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>变体选择</label>
          <select
            className="config-select"
            value={volumeVariant}
            onChange={(e) => onVolumeVariantChange(e.target.value)}
          >
            {listMagnetVariants('btn-volume').map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text">🎯 Standard: 简洁弹窗滑块</p>
          <p className="info-text">🎯 Cyber: 能量条+赛博数字显示</p>
        </div>
      </div>
    );
  }

  // 其他组件的通用配置
  return (
    <div className="component-config">
      <p className="config-placeholder">选择 {selectedMagnet} 的配置选项（待实现）</p>
    </div>
  );
};

/**
 * 组件预览区域
 */
interface ComponentPreviewAreaProps {
  selectedMagnet: string;
}

const ComponentPreviewArea: React.FC<ComponentPreviewAreaProps> = ({ selectedMagnet }) => {
  return (
    <div className="preview-container">
      <div className="preview-stage">
        <div className="preview-bg">
          {/* TrackInfo 实时预览 */}
          {selectedMagnet === 'track-info' && (
            <div className="real-component-preview">
              <TrackInfo />
            </div>
          )}

          {/* ProgressBar 实时预览 */}
          {selectedMagnet === 'progress-bar' && (
            <div className="real-component-preview">
              <ProgressBar />
            </div>
          )}

          {/* 播放控制按钮预览 */}
          {selectedMagnet === 'btn-play-pause' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <PlayPauseButton />
            </div>
          )}
          {selectedMagnet === 'btn-previous' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <PreviousButton />
            </div>
          )}
          {selectedMagnet === 'btn-next' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <NextButton />
            </div>
          )}
          {selectedMagnet === 'btn-mode' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <PlayModeButton />
            </div>
          )}
          {selectedMagnet === 'btn-volume' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <VolumeControl />
            </div>
          )}

          {/* 音乐库按钮预览 */}
          {selectedMagnet === 'btn-play-queue' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <PlayQueueButton />
            </div>
          )}
          {selectedMagnet === 'btn-playlists' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <PlaylistsButton />
            </div>
          )}
          {selectedMagnet === 'btn-music-library' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <MusicLibraryButton />
            </div>
          )}

          {/* 导航按钮预览 */}
          {selectedMagnet === 'btn-back' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <BackButton />
            </div>
          )}

          {/* 系统按钮预览 */}
          {selectedMagnet === 'btn-window-pin' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <WindowPinButton />
            </div>
          )}
          {selectedMagnet === 'btn-debug' && (
            <div
              className="button-preview"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <DebugButton />
            </div>
          )}
        </div>
      </div>

      {/* 材质通道信息 */}
      <div className="preview-channels">
        <h4>材质通道映射</h4>
        <MaterialChannelDisplay selectedMagnet={selectedMagnet} />
      </div>
    </div>
  );
};

/**
 * 材质通道显示
 */
interface MaterialChannelDisplayProps {
  selectedMagnet: string;
}

const MaterialChannelDisplay: React.FC<MaterialChannelDisplayProps> = ({ selectedMagnet }) => {
  const getChannelsForMagnet = (magnetId: string) => {
    switch (magnetId) {
      case 'track-info':
        return [
          { property: 'backgroundColor', slot: 'secondary', alpha: 0.85 },
          { property: 'titleColor', slot: 'detail', alpha: 1.0 },
          { property: 'subtitleColor', slot: 'detail', alpha: 0.7 },
          { property: 'coverBorder', slot: 'primary', alpha: 1.0 },
        ];
      case 'progress-bar':
        return [
          { property: 'trackBackground', slot: 'secondary', alpha: 0.3 },
          { property: 'fillColor', slot: 'primary', alpha: 1.0 },
          { property: 'thumbColor', slot: 'accent', alpha: 1.0 },
        ];
      case 'btn-play-pause':
        return [
          { property: 'backgroundColor', slot: 'secondary', alpha: 0.8 },
          { property: 'borderColor', slot: 'primary', alpha: 1.0 },
          { property: 'iconColor', slot: 'accent', alpha: 1.0 },
        ];
      default:
        return [];
    }
  };

  const channels = getChannelsForMagnet(selectedMagnet);

  return (
    <div className="channel-list">
      {channels.map((channel, index) => (
        <div key={index} className="channel-item">
          <span className="channel-property">{channel.property}</span>
          <span className="channel-arrow">→</span>
          <span className="channel-slot">
            {channel.slot} {channel.alpha < 1 && `(α: ${channel.alpha})`}
          </span>
        </div>
      ))}
    </div>
  );
};
