import React, { useState } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { TrackInfo } from '../magnet/trackInfo/TrackInfo';
import './ThemeDebugPage.css';

/**
 * 主题系统调试页面
 * 用于测试和开发主题、着色器系统
 */
export const ThemeDebugPage: React.FC = () => {
  const { theme, applyTheme, updateComponentTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<string>('default');
  const [selectedMagnet, setSelectedMagnet] = useState<string>('track-info');
  const [selectedShader, setSelectedShader] = useState<string>('shader-default');
  const [configMode, setConfigMode] = useState<'global' | 'component'>('component');
  const [trackInfoVariant, setTrackInfoVariant] = useState<string>(
    theme.componentThemes?.['track-info']?.variant || 'default'
  );

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
              <div className="config-placeholder-box">
                <p className="placeholder-title">🚧 全局主题功能</p>
                <p className="placeholder-desc">主题切换、着色器系统等功能开发中</p>
                <p className="placeholder-hint">当前请使用"单独配置"模式测试组件变体</p>
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
                    <option value="btn-play-pause">PlayPauseButton - 播放按钮</option>
                  </optgroup>
                  <optgroup label="导航组件">
                    <option value="btn-music-library">MusicLibraryButton</option>
                    <option value="btn-playlists">PlaylistsButton</option>
                    <option value="btn-play-queue">PlayQueueButton</option>
                  </optgroup>
                </select>
              </div>

              <div className="control-section">
                <h2>组件配置</h2>
                <ComponentConfigPanel
                  selectedMagnet={selectedMagnet}
                  trackInfoVariant={trackInfoVariant}
                  onTrackInfoVariantChange={(variant) => {
                    setTrackInfoVariant(variant);
                    // 使用新的 updateComponentTheme 方法（会自动同步到主窗口）
                    updateComponentTheme('track-info', {
                      ...theme.componentThemes?.['track-info'],
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
                        applyTheme(importedTheme);
                        setTrackInfoVariant(
                          importedTheme.componentThemes?.['track-info']?.variant || 'spinning-vinyl'
                        );
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
                          applyTheme(importedTheme);
                          setTrackInfoVariant(
                            importedTheme.componentThemes?.['track-info']?.variant ||
                              'spinning-vinyl'
                          );
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
                    updateComponentTheme('track-info', {
                      variant: 'spinning-vinyl',
                      dynamicColor: {
                        extractFromCover: true,
                        applyMode: 'full',
                      },
                    });
                    setTrackInfoVariant('spinning-vinyl');
                  }}
                >
                  🔄 重置
                </button>
              </div>
            </div>
          )}
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
            <ComponentPreviewArea
              selectedMagnet={selectedMagnet}
              selectedTheme={selectedTheme}
              configMode={configMode}
            />
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

/**
 * 着色器预览网格
 */
interface ShaderPreviewGridProps {
  selectedShader: string;
  onSelectShader: (shaderId: string) => void;
}

const ShaderPreviewGrid: React.FC<ShaderPreviewGridProps> = ({
  selectedShader,
  onSelectShader,
}) => {
  const shaders = [
    { id: 'shader-default', name: 'Default', color: '#00ff88' },
    { id: 'shader-cyberpunk', name: 'Cyberpunk', color: '#ff00ff' },
    { id: 'shader-nord', name: 'Nord', color: '#88c0d0' },
    { id: 'shader-neon', name: 'Neon', color: '#39ff14' },
    { id: 'shader-retro', name: 'Retro', color: '#f4a261' },
    { id: 'shader-monochrome', name: 'Monochrome', color: '#808080' },
  ];

  return (
    <div className="shader-grid">
      {shaders.map((shader) => (
        <div
          key={shader.id}
          className={`shader-card ${selectedShader === shader.id ? 'selected' : ''}`}
          style={{ background: shader.color }}
          onClick={() => onSelectShader(shader.id)}
        >
          <span>{shader.name}</span>
        </div>
      ))}
    </div>
  );
};

interface ComponentConfigPanelProps {
  selectedMagnet: string;
  trackInfoVariant: string;
  onTrackInfoVariantChange: (variant: string) => void;
}

const ComponentConfigPanel: React.FC<ComponentConfigPanelProps> = ({
  selectedMagnet,
  trackInfoVariant,
  onTrackInfoVariantChange,
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
            <option value="spinning-vinyl">旋转唱片</option>
            <option value="card">卡片式</option>
            <option value="minimal">极简</option>
          </select>
        </div>

        <div className="config-info">
          <p className="info-text">✅ 变体切换功能已实现</p>
          <p className="info-text disabled">🔧 更多配置选项开发中...</p>
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
  selectedTheme: string;
  configMode: 'global' | 'component';
}

const ComponentPreviewArea: React.FC<ComponentPreviewAreaProps> = ({
  selectedMagnet,
  selectedTheme,
  configMode,
}) => {
  return (
    <div className="preview-container">
      <div className="preview-stage">
        <div className="preview-bg">
          {/* TrackInfo 实时预览 - 使用真实组件 */}
          {selectedMagnet === 'track-info' && (
            <div className="real-component-preview">
              <TrackInfo />
            </div>
          )}

          {/* ProgressBar 预览 */}
          {selectedMagnet === 'progress-bar' && (
            <div className="preview-progress">
              <div className="preview-track"></div>
              <div className="preview-fill" style={{ width: '60%' }}></div>
              <div className="preview-thumb" style={{ left: '60%' }}></div>
            </div>
          )}

          {/* PlayPauseButton 预览 */}
          {selectedMagnet === 'btn-play-pause' && <div className="preview-button">▶</div>}
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
