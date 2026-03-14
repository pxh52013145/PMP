import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n';
import { listRegisteredMagnetRenderers, type MagnetRendererDefinition } from '../../magnet-system/registry';
import { listMagnetVariants } from '../../magnet-system/variantRegistry';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import type { ThemeBindingId } from '../../themes/types/theme';
import { useThemeBindingEditor } from '../../themes/useThemeBindingEditor';
import { ThemeBindingEditorPanel } from '../theme/ThemeBindingEditorPanel';
import { BackButton } from '../magnet/BackButton';
import { DebugButton } from '../magnet/DebugButton';
import { MusicLibraryButton } from '../magnet/MusicLibraryButton';
import { PlaylistsButton } from '../magnet/PlaylistsButton';
import { PlayModeButton } from '../magnet/PlayModeButton';
import { PlayPauseButton, PreviousButton, NextButton } from '../magnet/PlaybackControls';
import { PlayQueueButton } from '../magnet/PlayQueueButton';
import { ProgressBar } from '../magnet/progressBar/ProgressBar';
import { TrackInfo } from '../magnet/trackInfo/TrackInfo';
import { VolumeControl } from '../magnet/VolumeControl';
import { WindowPinButton } from '../magnet/WindowPinButton';
import { PmpButton, PmpChoiceButton } from '../primitives';

import './ThemeDebugPage.css';

type MaterialChannel = {
  property: string;
  slot: string;
  alpha: number;
};

type ThemeDebugMagnetOption = {
  id: string;
  label: string;
  description: string | null;
  groupId: string;
  groupLabel: string;
};

const DEBUG_MAGNET_LABEL_KEYS: Record<string, string> = {
  'track-info': 'editor.theme-debug.component.option.track-info',
  'progress-bar': 'editor.theme-debug.component.option.progress-bar',
  'btn-play-pause': 'editor.theme-debug.component.option.btn-play-pause',
  'btn-previous': 'editor.theme-debug.component.option.btn-previous',
  'btn-next': 'editor.theme-debug.component.option.btn-next',
  'btn-mode': 'editor.theme-debug.component.option.btn-mode',
  'btn-volume': 'editor.theme-debug.component.option.btn-volume',
  'btn-music-library': 'editor.theme-debug.component.option.btn-music-library',
  'btn-playlists': 'editor.theme-debug.component.option.btn-playlists',
  'btn-play-queue': 'editor.theme-debug.component.option.btn-play-queue',
  'btn-back': 'editor.theme-debug.component.option.btn-back',
  'btn-window-pin': 'editor.theme-debug.component.option.btn-window-pin',
  'btn-debug': 'editor.theme-debug.component.option.btn-debug',
};

const DEBUG_MAGNET_MATERIAL_CHANNELS: Record<string, MaterialChannel[]> = {
  'track-info': [
    { property: 'backgroundColor', slot: 'secondary', alpha: 0.85 },
    { property: 'titleColor', slot: 'detail', alpha: 1.0 },
    { property: 'subtitleColor', slot: 'detail', alpha: 0.7 },
    { property: 'coverBorder', slot: 'primary', alpha: 1.0 },
  ],
  'progress-bar': [
    { property: 'trackBackground', slot: 'secondary', alpha: 0.3 },
    { property: 'fillColor', slot: 'primary', alpha: 1.0 },
    { property: 'thumbColor', slot: 'accent', alpha: 1.0 },
  ],
  'btn-play-pause': [
    { property: 'backgroundColor', slot: 'secondary', alpha: 0.8 },
    { property: 'borderColor', slot: 'primary', alpha: 1.0 },
    { property: 'iconColor', slot: 'accent', alpha: 1.0 },
  ],
};

function ButtonPreview({ children }: React.PropsWithChildren) {
  return (
    <div
      className="button-preview"
      style={{
        width: '36px',
        height: '36px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {children}
    </div>
  );
}

function renderButtonPreview(children: React.ReactNode) {
  return <ButtonPreview>{children}</ButtonPreview>;
}

const DEBUG_MAGNET_PREVIEW_RENDERERS: Record<string, () => React.ReactNode> = {
  'track-info': () => (
    <div className="real-component-preview">
      <TrackInfo />
    </div>
  ),
  'progress-bar': () => (
    <div className="real-component-preview">
      <ProgressBar />
    </div>
  ),
  'btn-play-pause': () => renderButtonPreview(<PlayPauseButton />),
  'btn-previous': () => renderButtonPreview(<PreviousButton />),
  'btn-next': () => renderButtonPreview(<NextButton />),
  'btn-mode': () => renderButtonPreview(<PlayModeButton />),
  'btn-volume': () => renderButtonPreview(<VolumeControl />),
  'btn-play-queue': () => renderButtonPreview(<PlayQueueButton />),
  'btn-playlists': () => renderButtonPreview(<PlaylistsButton />),
  'btn-music-library': () => renderButtonPreview(<MusicLibraryButton />),
  'btn-back': () => renderButtonPreview(<BackButton />),
  'btn-window-pin': () => renderButtonPreview(<WindowPinButton />),
  'btn-debug': () => renderButtonPreview(<DebugButton />),
};

function resolveRendererPreview(renderer: MagnetRendererDefinition | null): React.ReactNode {
  if (!renderer?.preview) {
    return null;
  }
  return typeof renderer.preview === 'function' ? renderer.preview() : renderer.preview;
}

function formatRendererSource(
  t: (key: string, params?: Record<string, unknown>) => string,
  value: string | null | undefined
) {
  if (value === 'builtin') return t('common.source.builtin');
  if (value === 'plugin') return t('common.source.plugin');
  if (value === 'runtime') return t('common.source.runtime');
  return value || t('common.source.builtin');
}

function formatRendererGroup(
  t: (key: string, params?: Record<string, unknown>) => string,
  value: string | null | undefined
) {
  if (!value) return t('editor.theme-debug.renderers.defaultGroup');
  const key = `magnet.groups.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

export const ThemeDebugPage: React.FC = () => {
  const t = useT();
  const { theme, applyTheme } = useTheme();
  const [selectedTheme] = useState<string>('default');
  const [selectedMagnet, setSelectedMagnet] = useState<string>('track-info');
  const [configMode, setConfigMode] = useState<'global' | 'component'>('component');
  const [themeJson, setThemeJson] = useState<string>(JSON.stringify(theme, null, 2));
  const [rendererList, setRendererList] = useState(() => listRegisteredMagnetRenderers());
  const rendererById = useMemo(
    () => new Map(rendererList.map((renderer) => [renderer.id, renderer])),
    [rendererList]
  );
  const selectedRenderer = useMemo(
    () => rendererById.get(selectedMagnet) ?? null,
    [rendererById, selectedMagnet]
  );
  const magnetOptions = useMemo(() => {
    const ids = new Set<string>();
    const addMagnetId = (value: string) => {
      const normalized = value.trim();
      if (normalized) {
        ids.add(normalized);
      }
    };

    addMagnetId(selectedMagnet);
    for (const renderer of rendererList) {
      addMagnetId(renderer.id);
    }
    for (const bindingId of Object.keys(theme.bindings ?? {})) {
      if (bindingId.startsWith('magnet.')) {
        addMagnetId(bindingId.slice('magnet.'.length));
      }
    }
    for (const surfaceId of Object.keys(theme.surfaces ?? {})) {
      if (surfaceId.startsWith('magnet.')) {
        addMagnetId(surfaceId.slice('magnet.'.length));
      }
    }

    return [...ids]
      .map((id) => {
        const renderer = rendererById.get(id) ?? null;
        const labelKey = DEBUG_MAGNET_LABEL_KEYS[id];
        const translatedLabel = labelKey ? t(labelKey) : id;
        return {
          id,
          label: translatedLabel === labelKey ? id : translatedLabel,
          description: renderer?.description ?? null,
          groupId: renderer?.group?.trim() ?? '',
          groupLabel: formatRendererGroup(t, renderer?.group),
        } satisfies ThemeDebugMagnetOption;
      })
      .sort(
        (a, b) =>
          a.groupLabel.localeCompare(b.groupLabel) ||
          a.label.localeCompare(b.label) ||
          a.id.localeCompare(b.id)
      );
  }, [rendererById, rendererList, selectedMagnet, t, theme.bindings, theme.surfaces]);
  const magnetOptionGroups = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; items: ThemeDebugMagnetOption[] }>();

    for (const option of magnetOptions) {
      const key = option.groupId || '__default__';
      const group = grouped.get(key);
      if (group) {
        group.items.push(option);
        continue;
      }

      grouped.set(key, {
        id: key,
        label: option.groupLabel,
        items: [option],
      });
    }

    return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [magnetOptions]);

  const selectedBindingId = useMemo(
    () => `magnet.${selectedMagnet}` as ThemeBindingId,
    [selectedMagnet]
  );
  const selectedMagnetVariantOptions = useMemo(() => listMagnetVariants(selectedMagnet), [selectedMagnet]);
  const bindingEditor = useThemeBindingEditor({
    bindingId: selectedBindingId,
    rendererSuggestions: rendererList.map((renderer) => renderer.id),
  });

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

  const handleImportTheme = useCallback(async () => {
    try {
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
        await applyTheme(JSON.parse(text));
        return;
      }

      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: t('editor.theme-debug.actions.filePicker.themeFiles'), extensions: ['pmpt', 'json'] }],
      });
      if (selected && typeof selected === 'string') {
        const { readTextFile } = await import('@tauri-apps/api/fs');
        const text = await readTextFile(selected);
        await applyTheme(JSON.parse(text));
      }
    } catch (error) {
      console.error('[ThemeDebug] Failed to import theme', error);
    }
  }, [applyTheme, t]);

  const handleExportTheme = useCallback(() => {
    const configStr = JSON.stringify(theme, null, 2);
    const blob = new Blob([configStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `theme-${theme.id}-${Date.now()}.pmpt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [theme]);

  const handleResetSelected = useCallback(async () => {
    await bindingEditor.clearBinding();
    if (bindingEditor.surfaceDocumentId === selectedBindingId && bindingEditor.surfaceDocument) {
      await bindingEditor.clearSurfaceTheme();
    }
  }, [bindingEditor, selectedBindingId]);

  return (
    <div className="editor-debug">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          鈰嫯
        </span>
      </div>

      <div className="editor-window-content editor-debug-content">
        <div className="debug-title">
          <h2>{t('editor.theme-debug.title')}</h2>
          <p className="debug-subtitle">{t('editor.theme-debug.subtitle')}</p>
        </div>

        <div className="debug-main">
          <div className="debug-control-panel">
            <div className="control-section">
              <h2>{t('editor.theme-debug.mode.title')}</h2>
              <div className="mode-selector">
                <PmpChoiceButton
                  type="button"
                  className="mode-btn"
                  active={configMode === 'global'}
                  onClick={() => setConfigMode('global')}
                >
                  {t('editor.theme-debug.mode.global')}
                </PmpChoiceButton>
                <PmpChoiceButton
                  type="button"
                  className="mode-btn"
                  active={configMode === 'component'}
                  onClick={() => setConfigMode('component')}
                >
                  {t('editor.theme-debug.mode.component')}
                </PmpChoiceButton>
              </div>
            </div>

            {configMode === 'global' ? (
              <div className="control-section">
                <h2>{t('editor.theme-debug.global.title')}</h2>
                <textarea
                  className="theme-json-editor"
                  value={themeJson}
                  onChange={(event) => setThemeJson(event.target.value)}
                  spellCheck={false}
                />
                <div className="theme-json-actions">
                  <label className="theme-file-upload">
                    {t('editor.theme-debug.global.importFile')}
                    <input type="file" accept="application/json" onChange={handleThemeFileUpload} />
                  </label>
                  <PmpButton type="button" variant="default" onClick={() => navigator.clipboard.writeText(themeJson)}>
                    {t('editor.theme-debug.global.copyJson')}
                  </PmpButton>
                  <PmpButton type="button" variant="primary" onClick={handleApplyThemeJson}>
                    {t('editor.theme-debug.global.applyJson')}
                  </PmpButton>
                </div>
              </div>
            ) : (
              <>
                <div className="control-section">
                  <h2>{t('editor.theme-debug.component.selectTitle')}</h2>
                  <select
                    className="magnet-selector"
                    value={selectedMagnet}
                    onChange={(event) => setSelectedMagnet(event.target.value)}
                  >
                    {magnetOptionGroups.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.items.map((option) => (
                          <option key={option.id} value={option.id} title={option.description ?? undefined}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="control-section">
                  <h2>{t('editor.theme-debug.component.configTitle')}</h2>
                  <ThemeBindingEditorPanel
                    bindingId={selectedBindingId}
                    bindingEditor={bindingEditor}
                    variantInput={{
                      kind: 'select',
                      options: selectedMagnetVariantOptions,
                      emptyLabel: '(inherit)',
                    }}
                    renderActionButton={(button) => (
                      <PmpButton
                        type="button"
                        variant={button.kind === 'primary' ? 'primary' : 'default'}
                        className="action-btn"
                        onClick={button.onClick}
                      >
                        {button.label}
                      </PmpButton>
                    )}
                  />
                </div>

                <div className="control-section">
                  <h2>{t('editor.theme-debug.actions.title')}</h2>
                  <div className="action-buttons">
                    <PmpButton
                      type="button"
                      variant="primary"
                      className="action-btn primary"
                      onClick={() => void handleImportTheme()}
                    >
                      {t('editor.theme-debug.actions.importTheme')}
                    </PmpButton>
                    <PmpButton
                      type="button"
                      variant="default"
                      className="action-btn"
                      onClick={handleExportTheme}
                    >
                      {t('editor.theme-debug.actions.exportTheme')}
                    </PmpButton>
                    <PmpButton
                      type="button"
                      variant="default"
                      className="action-btn"
                      onClick={() => void handleResetSelected()}
                    >
                      {t('editor.theme-debug.actions.resetSelected')}
                    </PmpButton>
                  </div>
                </div>
              </>
            )}

            <div className="control-section">
              <h2>{t('editor.theme-debug.renderers.title')}</h2>
              <PmpButton type="button" variant="default" className="refresh-btn" onClick={refreshRenderers}>
                {t('common.action.refresh')}
              </PmpButton>
              <div className="renderer-list">
                {rendererList.map((renderer) => (
                  <div key={renderer.id} className="renderer-item">
                    <div className="renderer-id">{renderer.id}</div>
                    <div className="renderer-meta">
                      <span>{formatRendererGroup(t, renderer.group)}</span>
                      <span>{formatRendererSource(t, renderer.source)}</span>
                    </div>
                    <div className="renderer-desc">{renderer.description}</div>
                  </div>
                ))}
                {rendererList.length === 0 ? (
                  <div className="renderer-empty">{t('editor.theme-debug.renderers.empty')}</div>
                ) : null}
              </div>
            </div>
          </div>

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
              <ComponentPreviewArea selectedMagnet={selectedMagnet} renderer={selectedRenderer} />
            </div>

            <div className="preview-info">
              <h3>{t('editor.theme-debug.preview.currentConfig')}</h3>
              <div className="config-display">
                <pre>
                  {JSON.stringify(
                    {
                      theme: selectedTheme,
                      component: selectedMagnet,
                      bindingId: selectedBindingId,
                      binding: bindingEditor.bindingPreview,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ComponentPreviewAreaProps {
  selectedMagnet: string;
  renderer: MagnetRendererDefinition | null;
}

const ComponentPreviewArea: React.FC<ComponentPreviewAreaProps> = ({ selectedMagnet, renderer }) => {
  const t = useT();
  const explicitPreview = DEBUG_MAGNET_PREVIEW_RENDERERS[selectedMagnet]?.() ?? null;
  const fallbackPreview = resolveRendererPreview(renderer);

  return (
    <div className="preview-container">
      <div className="preview-stage">
        <div className="preview-bg">
          {explicitPreview ?? (
            <div className="real-component-preview">
              <div className="renderer-preview-fallback">
                <div className="renderer-preview-fallback-id">{selectedMagnet}</div>
                {fallbackPreview ? (
                  <div className="renderer-preview-fallback-node">{fallbackPreview}</div>
                ) : null}
                <div className="renderer-preview-fallback-description">
                  {renderer?.description ?? t('editor.theme-debug.renderers.empty')}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="preview-channels">
        <h4>{t('editor.theme-debug.materialMapping.title')}</h4>
        <MaterialChannelDisplay selectedMagnet={selectedMagnet} />
      </div>
    </div>
  );
};

interface MaterialChannelDisplayProps {
  selectedMagnet: string;
}

const MaterialChannelDisplay: React.FC<MaterialChannelDisplayProps> = ({ selectedMagnet }) => {
  const channels = DEBUG_MAGNET_MATERIAL_CHANNELS[selectedMagnet] ?? [];

  return (
    <div className="channel-list">
      {channels.length === 0 ? <div className="channel-empty">No documented material channels</div> : null}
      {channels.map((channel, index) => (
        <div key={index} className="channel-item">
          <span className="channel-property">{channel.property}</span>
          <span className="channel-arrow">-&gt;</span>
          <span className="channel-slot">
            {channel.slot} {channel.alpha < 1 ? `(alpha: ${channel.alpha})` : ''}
          </span>
        </div>
      ))}
    </div>
  );
};
