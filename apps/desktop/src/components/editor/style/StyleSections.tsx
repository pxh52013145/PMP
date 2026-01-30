import { memo } from 'react';
import { useT } from '../../../i18n';
import type { StyleEditorModel } from './useStyleEditorModel';
import {
  BACKGROUND_EFFECT_PRESETS,
  BORDER_EFFECT_PRESETS,
  COLOR_THEME_PRESETS,
  COVER_COLOR_EFFECT_PRESETS,
  PIXEL_SHAPE_PRESETS,
} from './stylePresets';

export const PixelSection = memo(function PixelSection({ model }: { model: StyleEditorModel }) {
  const t = useT();
  return (
    <section className="style-section">
      <h3 className="section-title">{t('editor.style-editor.section.pixelShape.title')}</h3>
      <p className="section-description">{t('editor.style-editor.section.pixelShape.desc')}</p>

      <div className="preset-grid">
        {PIXEL_SHAPE_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card preset-card-icon-only ${model.selectedPixelShape === preset.id ? 'active' : ''}`}
            onClick={() => void model.applyPixelShape(preset.id)}
            title={t(preset.nameKey)}
          >
            <span className="preset-shape-preview" data-shape={preset.shape}></span>
            {model.selectedPixelShape === preset.id && <span className="preset-badge">✓</span>}
          </div>
        ))}
      </div>

      <div className="pixel-size-control">
        <label className="size-label">
          <span>{t('editor.style-editor.pixelSize.label')}</span>
          <span className="size-value">{model.pixelSize}%</span>
        </label>
        <input type="range" min="50" max="100" value={model.pixelSize} onChange={model.handlePixelSizeChange} className="size-slider" />
        <div className="size-hints">
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="pixel-size-control">
        <label className="size-label">
          <span>{t('editor.style-editor.pixelOpacity.label')}</span>
          <span className="size-value">{model.pixelOpacity}%</span>
        </label>
        <input type="range" min="0" max="100" value={model.pixelOpacity} onChange={model.handlePixelOpacityChange} className="size-slider" />
        <div className="size-hints">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
    </section>
  );
});

export const CoverColorSection = memo(function CoverColorSection({ model }: { model: StyleEditorModel }) {
  const t = useT();
  return (
    <section className="style-section">
      <h3 className="section-title">{t('editor.style-editor.section.coverColor.title')}</h3>
      <p className="section-description">{t('editor.style-editor.section.coverColor.desc')}</p>

      <div
        className={`preset-card ${model.coverColorEnabled ? 'active' : ''}`}
        onClick={() => void model.applyCoverColorConfig({ extractFromCover: !model.coverColorEnabled })}
      >
        <div className="preset-header">
          <span className="preset-name">{t('editor.style-editor.coverColor.enable')}</span>
        </div>
      </div>

      <div className="preset-grid">
        {COVER_COLOR_EFFECT_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card ${model.coverColorEffect === preset.id ? 'active' : ''}`}
            onClick={() => void model.applyCoverColorConfig({ effect: preset.id })}
            title={t(preset.descriptionKey)}
          >
            <div className="preset-header">
              <span className="preset-name">{t(preset.nameKey)}</span>
            </div>
          </div>
        ))}
      </div>

      {(model.coverColorEffect === 'gradient' || model.coverColorEffect === 'dynamic') && (
        <div className="pixel-size-control">
          <label className="size-label">
            <span>{t('editor.style-editor.coverColor.gradientAngle.label')}</span>
            <span className="size-value">{Math.round(model.coverColorGradientAngle)}°</span>
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={Math.round(model.coverColorGradientAngle)}
            onChange={(e) => void model.applyCoverColorConfig({ gradientAngle: parseInt(e.target.value, 10) })}
            className="size-slider"
          />
          <div className="size-hints">
            <span>0°</span>
            <span>360°</span>
          </div>
        </div>
      )}

      {model.coverColorEffect === 'dynamic' && (
        <div className="pixel-size-control">
          <label className="size-label">
            <span>{t('editor.style-editor.coverColor.dynamicSpeed.label')}</span>
            <span className="size-value">{model.coverColorDynamicSpeed.toFixed(1)}s</span>
          </label>
          <input
            type="range"
            min="2"
            max="20"
            step="0.5"
            value={model.coverColorDynamicSpeed}
            onChange={(e) => void model.applyCoverColorConfig({ dynamicSpeed: parseFloat(e.target.value) })}
            className="size-slider"
          />
          <div className="size-hints">
            <span>2s</span>
            <span>20s</span>
          </div>
        </div>
      )}
    </section>
  );
});

export const BackgroundEffectSection = memo(function BackgroundEffectSection({ model }: { model: StyleEditorModel }) {
  const t = useT();
  return (
    <section className="style-section">
      <h3 className="section-title">{t('editor.style-editor.section.backgroundEffect.title')}</h3>
      <p className="section-description">{t('editor.style-editor.section.backgroundEffect.desc')}</p>

      <div className="preset-grid">
        {BACKGROUND_EFFECT_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card ${model.selectedBackgroundEffect === preset.id ? 'active' : ''}`}
            onClick={() => void model.applyBackgroundEffect(preset.id)}
            title={t(preset.descriptionKey)}
          >
            <div className="preset-header">
              <span className="preset-name">{t(preset.nameKey)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="color-theme-selector">
        {COLOR_THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`color-theme-btn ${preset.id === 'rainbow' ? 'rainbow-theme' : ''} ${model.backgroundThemeColor.id === preset.id ? 'active' : ''}`}
            style={preset.id === 'rainbow' ? undefined : { background: `rgb(${preset.rgb.join(',')})` }}
            onClick={() => void model.applyBackgroundThemeColor(preset)}
            title={t(preset.nameKey)}
          />
        ))}
        <button
          type="button"
          className="color-theme-btn color-picker-btn"
          onClick={(e) => void model.openColorPicker('background', e)}
          title={t('editor.style-editor.colorTheme.custom')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1z"
            />
          </svg>
        </button>
      </div>
    </section>
  );
});

export const BorderEffectSection = memo(function BorderEffectSection({ model }: { model: StyleEditorModel }) {
  const t = useT();
  return (
    <section className="style-section">
      <h3 className="section-title">{t('editor.style-editor.section.borderEffect.title')}</h3>
      <p className="section-description">{t('editor.style-editor.section.borderEffect.desc')}</p>

      <div className="preset-grid">
        {BORDER_EFFECT_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card ${model.selectedBorderEffect === preset.id ? 'active' : ''}`}
            onClick={() => void model.applyBorderEffect(preset.id)}
            title={t(preset.descriptionKey)}
          >
            <div className="preset-header">
              <span className="preset-name">{t(preset.nameKey)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="color-theme-selector">
        {COLOR_THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`color-theme-btn ${preset.id === 'rainbow' ? 'rainbow-theme' : ''} ${model.borderThemeColor.id === preset.id ? 'active' : ''}`}
            style={preset.id === 'rainbow' ? undefined : { background: `rgb(${preset.rgb.join(',')})` }}
            onClick={() => void model.applyBorderThemeColor(preset)}
            title={t(preset.nameKey)}
          />
        ))}
        <button
          type="button"
          className="color-theme-btn color-picker-btn"
          onClick={(e) => void model.openColorPicker('border', e)}
          title={t('editor.style-editor.colorTheme.custom')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1z"
            />
          </svg>
        </button>
      </div>
    </section>
  );
});
