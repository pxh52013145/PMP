import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { useT } from '../../i18n';
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

function resolveVariantFromTheme(themeValue: unknown, componentId: string, fallback: string): string {
  type ThemeLike = { componentThemes?: Record<string, { variant?: unknown }> };
  const componentThemes = (themeValue as ThemeLike | null | undefined)?.componentThemes;

  const direct = componentThemes?.[componentId]?.variant;
  if (typeof direct === 'string') return direct;

  const legacyKeys = LEGACY_THEME_KEYS[componentId] ?? [];
  for (const legacyKey of legacyKeys) {
    const legacyVariant = componentThemes?.[legacyKey]?.variant;
    if (typeof legacyVariant === 'string') return legacyVariant;
  }

  return fallback;
}

/**
 * 主题系统调试页面
 * 用于测试和开发主题、着色器系统
 */
export const ThemeDebugPage: React.FC = () => {
  const t = useT();
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
      alert(t('editor.theme-debug.alert.invalidThemeJson'));
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
      alert(t('editor.theme-debug.alert.themeFileLoaded', { name: file.name }));
    } catch (error) {
      alert(t('editor.theme-debug.alert.themeFileLoadFailed'));
      console.error('[ThemeDebug] Failed to load theme file', error);
    }
  };

  const formatRendererSource = (value: string | null | undefined) => {
    if (value === 'builtin') return t('common.source.builtin');
    if (value === 'plugin') return t('common.source.plugin');
    if (value === 'runtime') return t('common.source.runtime');
    return value || t('common.source.builtin');
  };

  const formatRendererGroup = (value: string | null | undefined) => {
    if (!value) return t('editor.theme-debug.renderers.defaultGroup');
    const key = `magnet.groups.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  return (
    <div className="editor-debug">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      <div className="editor-window-content editor-debug-content">
        <div className="debug-title">
          <h2>{t('editor.theme-debug.title')}</h2>
          <p className="debug-subtitle">{t('editor.theme-debug.subtitle')}</p>
        </div>

        <div className="debug-main">
        {/* 左侧：控制面板 */}
        <div className="debug-control-panel">
          <div className="control-section">
            <h2>{t('editor.theme-debug.mode.title')}</h2>
            <div className="mode-selector">
              <button
                className={`mode-btn ${configMode === 'global' ? 'active' : ''}`}
                onClick={() => setConfigMode('global')}
              >
                {t('editor.theme-debug.mode.global')}
              </button>
              <button
                className={`mode-btn ${configMode === 'component' ? 'active' : ''}`}
                onClick={() => setConfigMode('component')}
              >
                {t('editor.theme-debug.mode.component')}
              </button>
            </div>
          </div>

          {/* 全局主题配置 */}
          {configMode === 'global' && (
            <div className="control-section">
              <h2>{t('editor.theme-debug.global.title')}</h2>
              <textarea
                className="theme-json-editor"
                value={themeJson}
                onChange={(e) => setThemeJson(e.target.value)}
                spellCheck={false}
              ></textarea>
              <div className="theme-json-actions">
                <label className="theme-file-upload">
                  {t('editor.theme-debug.global.importFile')}
                  <input type="file" accept="application/json" onChange={handleThemeFileUpload} />
                </label>
                <button onClick={() => navigator.clipboard.writeText(themeJson)}>{t('editor.theme-debug.global.copyJson')}</button>
                <button onClick={handleApplyThemeJson}>{t('editor.theme-debug.global.applyJson')}</button>
              </div>
            </div>
          )}

          {/* 单独配置模式 */}
          {configMode === 'component' && (
            <>
              <div className="control-section">
                <h2>{t('editor.theme-debug.component.selectTitle')}</h2>
                <select
                  className="magnet-selector"
                  value={selectedMagnet}
                  onChange={(e) => setSelectedMagnet(e.target.value)}
                >
                  <optgroup label={t('editor.theme-debug.component.group.core')}>
                    <option value="track-info">{t('editor.theme-debug.component.option.track-info')}</option>
                    <option value="progress-bar">{t('editor.theme-debug.component.option.progress-bar')}</option>
                  </optgroup>
                  <optgroup label={t('editor.theme-debug.component.group.playback')}>
                    <option value="btn-play-pause">{t('editor.theme-debug.component.option.btn-play-pause')}</option>
                    <option value="btn-previous">{t('editor.theme-debug.component.option.btn-previous')}</option>
                    <option value="btn-next">{t('editor.theme-debug.component.option.btn-next')}</option>
                    <option value="btn-mode">{t('editor.theme-debug.component.option.btn-mode')}</option>
                    <option value="btn-volume">{t('editor.theme-debug.component.option.btn-volume')}</option>
                  </optgroup>
                  <optgroup label={t('editor.theme-debug.component.group.library')}>
                    <option value="btn-music-library">{t('editor.theme-debug.component.option.btn-music-library')}</option>
                    <option value="btn-playlists">{t('editor.theme-debug.component.option.btn-playlists')}</option>
                    <option value="btn-play-queue">{t('editor.theme-debug.component.option.btn-play-queue')}</option>
                  </optgroup>
                  <optgroup label={t('editor.theme-debug.component.group.navigation')}>
                    <option value="btn-back">{t('editor.theme-debug.component.option.btn-back')}</option>
                  </optgroup>
                  <optgroup label={t('editor.theme-debug.component.group.system')}>
                    <option value="btn-window-pin">{t('editor.theme-debug.component.option.btn-window-pin')}</option>
                    <option value="btn-debug">{t('editor.theme-debug.component.option.btn-debug')}</option>
                  </optgroup>
                </select>
              </div>

              <div className="control-section">
                <h2>{t('editor.theme-debug.component.configTitle')}</h2>
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
              <h2>{t('editor.theme-debug.actions.title')}</h2>
              <div className="action-buttons">
                <button
                  className="action-btn primary"
	                  onClick={async () => {
	                    try {
	                      // 使用 File System Access API
	                      const showOpenFilePicker = (window as unknown as {
	                        showOpenFilePicker?: (options: {
	                          types?: Array<{
	                            description?: string;
	                            accept?: Record<string, string[]>;
	                          }>;
	                        }) => Promise<Array<{ getFile: () => Promise<File> }>>;
	                      }).showOpenFilePicker;
	                      if (showOpenFilePicker) {
	                        const [fileHandle] = await showOpenFilePicker({
	                          types: [
	                            {
	                              description: t('editor.theme-debug.actions.filePicker.themeFiles'),
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
                          filters: [{ name: t('editor.theme-debug.actions.filePicker.themeFiles'), extensions: ['pmpt', 'json'] }],
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
                  {t('editor.theme-debug.actions.importTheme')}
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
                  {t('editor.theme-debug.actions.exportTheme')}
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
                  {t('editor.theme-debug.actions.resetSelected')}
                </button>
              </div>
            </div>
          )}

          <div className="control-section">
            <h2>{t('editor.theme-debug.renderers.title')}</h2>
            <button className="refresh-btn" onClick={refreshRenderers}>
              {t('common.action.refresh')}
            </button>
            <div className="renderer-list">
              {rendererList.map((renderer) => (
                <div key={renderer.id} className="renderer-item">
                  <div className="renderer-id">{renderer.id}</div>
                  <div className="renderer-meta">
                    <span>{formatRendererGroup(renderer.group)}</span>
                    <span>{formatRendererSource(renderer.source)}</span>
                  </div>
                  <div className="renderer-desc">{renderer.description}</div>
                </div>
              ))}
              {rendererList.length === 0 && (
                <div className="renderer-empty">{t('editor.theme-debug.renderers.empty')}</div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：预览区域 */}
        <div className="debug-preview-panel">
          <div className="preview-header">
            <h2>{t('editor.theme-debug.preview.title')}</h2>
            <span className="preview-subtitle">
              {configMode === 'global'
                ? t('editor.theme-debug.preview.subtitle.theme', { name: selectedTheme })
                : t('editor.theme-debug.preview.subtitle.component', { id: selectedMagnet })}
            </span>
          </div>

          <div className="preview-content">
            <ComponentPreviewArea selectedMagnet={selectedMagnet} />
          </div>

          {/* 预览信息 */}
          <div className="preview-info">
            <h3>{t('editor.theme-debug.preview.currentConfig')}</h3>
            <div className="config-display">
              <pre>
                {JSON.stringify({ theme: selectedTheme, component: selectedMagnet }, null, 2)}
              </pre>
            </div>
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
  const t = useT();

  // TrackInfo 专用配置
  if (selectedMagnet === 'track-info') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text disabled">{t('editor.theme-debug.config.info.moreOptionsTodo')}</p>
        </div>
      </div>
    );
  }

  // ProgressBar 专用配置
  if (selectedMagnet === 'progress-bar') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text disabled">{t('editor.theme-debug.config.info.moreOptionsTodo')}</p>
        </div>
      </div>
    );
  }

  // 播放/暂停按钮配置
  if (selectedMagnet === 'btn-play-pause') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.playPause.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.playPause.rounded')}</p>
        </div>
      </div>
    );
  }

  // 上一首按钮配置
  if (selectedMagnet === 'btn-previous') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.previous.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.previous.rounded')}</p>
        </div>
      </div>
    );
  }

  // 下一首按钮配置
  if (selectedMagnet === 'btn-next') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.next.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.next.rounded')}</p>
        </div>
      </div>
    );
  }

  // 播放模式按钮配置
  if (selectedMagnet === 'btn-mode') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.playMode.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.playMode.minimal')}</p>
        </div>
      </div>
    );
  }

  // 返回按钮配置
  if (selectedMagnet === 'btn-back') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.back.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.back.rounded')}</p>
        </div>
      </div>
    );
  }

  // 音量控制配置
  if (selectedMagnet === 'btn-volume') {
    return (
      <div className="component-config">
        <div className="config-group">
          <label>{t('editor.theme-debug.variant.label')}</label>
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
          <p className="info-text">{t('editor.theme-debug.config.info.variantImplemented')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.volume.standard')}</p>
          <p className="info-text">{t('editor.theme-debug.desc.volume.cyber')}</p>
        </div>
      </div>
    );
  }

  // 其他组件的通用配置
  return (
    <div className="component-config">
      <p className="config-placeholder">
        {t('editor.theme-debug.config.placeholder', { id: selectedMagnet })}
      </p>
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
  const t = useT();

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
        <h4>{t('editor.theme-debug.materialMapping.title')}</h4>
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
