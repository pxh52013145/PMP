import { memo, useCallback, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { readJson, readString, writeString } from '../../modules/storage';
import { broadcastDataUpdate, broadcastSignal, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import type { DynamicColorConfig } from '../../themes/types/theme';
import './StyleBar.css';

type Preset = { id: string };

const BACKGROUND_EFFECT_PRESETS: Preset[] = [
  { id: 'glow-pulse' },
  { id: 'scan-line' },
  { id: 'matrix-rain' },
  { id: 'particles' },
  { id: 'none' },
];

const BORDER_EFFECT_PRESETS: Preset[] = [{ id: 'standard' }, { id: 'pulse' }, { id: 'glitch' }, { id: 'none' }];

function nextPresetId(current: string, presets: Preset[]): string {
  const idx = presets.findIndex((p) => p.id === current);
  const next = presets[(idx >= 0 ? idx + 1 : 0) % presets.length];
  return next?.id ?? presets[0]?.id ?? current;
}

export const StyleBar = memo(function StyleBar({ onOpenOrnaments }: { onOpenOrnaments: () => void }) {
  const t = useT();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { theme, applyTheme, getComponentTheme } = useTheme();

  const [pixelHintsVisible, setPixelHintsVisible] = useState<boolean>(() =>
    readJson<boolean>(STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE, false)
  );

  const [selectedBackgroundEffect, setSelectedBackgroundEffect] = useState<string>(() => {
    return readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
  });

  const [selectedBorderEffect, setSelectedBorderEffect] = useState<string>(() => {
    return readString(STORAGE_KEYS.BORDER_EFFECT) || 'none';
  });

  const coverColorEnabled = (() => {
    const trackInfoConfig = getComponentTheme('track-info').dynamicColor;
    const progressBarConfig = getComponentTheme('progress-bar').dynamicColor;
    const current = (trackInfoConfig ?? progressBarConfig ?? {}) as DynamicColorConfig;
    return current.extractFromCover !== false;
  })();

  const togglePixelHints = useCallback(() => {
    const next = !pixelHintsVisible;
    setPixelHintsVisible(next);
    void broadcastDataUpdate(
      STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE,
      next,
      TAURI_EVENTS.EDITOR_OVERLAY_PIXEL_HINTS_UPDATED
    );
  }, [pixelHintsVisible]);

  const toggleCoverColor = useCallback(() => {
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
            extractFromCover: !coverColorEnabled,
          },
        },
        'progress-bar': {
          ...currentProgressBarTheme,
          dynamicColor: {
            ...(currentProgressBarTheme.dynamicColor ?? {}),
            extractFromCover: !coverColorEnabled,
          },
        },
      },
    };

    void applyTheme(nextTheme);
  }, [applyTheme, coverColorEnabled, getComponentTheme, theme]);

  const cycleBackgroundEffect = useCallback(() => {
    const next = nextPresetId(selectedBackgroundEffect, BACKGROUND_EFFECT_PRESETS);
    setSelectedBackgroundEffect(next);
    writeString(STORAGE_KEYS.BACKGROUND_EFFECT, next);
    void broadcastSignal(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED);
  }, [selectedBackgroundEffect]);

  const cycleBorderEffect = useCallback(() => {
    const next = nextPresetId(selectedBorderEffect, BORDER_EFFECT_PRESETS);
    setSelectedBorderEffect(next);
    writeString(STORAGE_KEYS.BORDER_EFFECT, next);
    void broadcastSignal(TAURI_EVENTS.BORDER_EFFECT_UPDATED);
  }, [selectedBorderEffect]);

  return (
    <div className="style-bar-root" data-tauri-drag-region>
      <button
        type="button"
        className={`style-bar-btn ${pixelHintsVisible ? 'active' : ''}`}
        onClick={togglePixelHints}
        title={t('editor.style-bar.pixel.title')}
        aria-label={t('editor.style-bar.pixel.title')}
      >
        {t('editor.style-bar.pixel.label')}
      </button>

      <button
        type="button"
        className={`style-bar-btn ${coverColorEnabled ? 'active' : ''}`}
        onClick={toggleCoverColor}
        title={t('editor.style-bar.coverColor.title')}
        aria-label={t('editor.style-bar.coverColor.title')}
      >
        {t('editor.style-bar.coverColor.label')}
      </button>

      <button
        type="button"
        className="style-bar-btn"
        onClick={cycleBackgroundEffect}
        title={t('editor.style-bar.backgroundEffect.title')}
        aria-label={t('editor.style-bar.backgroundEffect.title')}
      >
        {t('editor.style-bar.backgroundEffect.label')}
      </button>

      <button
        type="button"
        className="style-bar-btn"
        onClick={cycleBorderEffect}
        title={t('editor.style-bar.borderEffect.title')}
        aria-label={t('editor.style-bar.borderEffect.title')}
      >
        {t('editor.style-bar.borderEffect.label')}
      </button>

      <button
        type="button"
        className="style-bar-btn style-bar-btn--ornaments"
        onClick={onOpenOrnaments}
        disabled={!isTauri}
        title={t('editor.style-bar.ornaments.title')}
        aria-label={t('editor.style-bar.ornaments.title')}
      >
        {t('editor.style-bar.ornaments.label')}
      </button>
    </div>
  );
});

