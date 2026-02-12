import { useState } from 'react';
import { useT } from '../../i18n';

type LayoutMode = 'balanced' | 'focus' | 'compact';
type VisualTone = 'default' | 'accent' | 'minimal';

type BlockProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  note: string;
  controls: React.ReactNode;
};

function DemoParamBlock({ eyebrow, title, subtitle, note, controls }: BlockProps) {
  return (
    <div className="settings-audio-block settings-demo-block">
      <div className="settings-param-divider settings-param-divider--compact" />

      <div className="settings-demo-body">
        <div className="settings-demo-copy">
          <div className="settings-param-head settings-demo-head">
            <p className="settings-param-eyebrow">{eyebrow}</p>
            <h3 className="settings-param-title">{title}</h3>
            <p className="settings-param-subtitle">{subtitle}</p>
          </div>
          <p className="settings-card-note settings-demo-note">{note}</p>
        </div>

        <div className="settings-demo-controls">{controls}</div>
      </div>

      <div className="settings-param-divider settings-param-divider--compact" />
    </div>
  );
}

export function SystemDemoSettingsPanel() {
  const t = useT();

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  const [visualTone, setVisualTone] = useState<VisualTone>('default');
  const [preset, setPreset] = useState('baseline');
  const [scalePercent, setScalePercent] = useState(100);
  const [marginScale, setMarginScale] = useState(100);

  return (
    <div className="settings-audio-panel settings-demo-panel">
      <DemoParamBlock
        eyebrow={t('settings.systemDemo.preview.eyebrow')}
        title={t('settings.systemDemo.preview.title')}
        subtitle={t('settings.systemDemo.preview.subtitle')}
        note={t('settings.systemDemo.preview.note', {
          layout: t(`settings.systemDemo.preview.layoutLabel.${layoutMode}`),
          tone: t(`settings.systemDemo.preview.toneLabel.${visualTone}`),
        })}
        controls={
          <div className="settings-demo-control-stack" role="radiogroup" aria-label={t('settings.systemDemo.preview.layout')}>
            <div className="settings-demo-control-row">
              <button
                type="button"
                className="settings-choice-btn"
                data-active={layoutMode === 'balanced'}
                onClick={() => setLayoutMode('balanced')}
              >
                {t('settings.systemDemo.preview.layoutBalanced')}
              </button>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={layoutMode === 'focus'}
                onClick={() => setLayoutMode('focus')}
              >
                {t('settings.systemDemo.preview.layoutFocus')}
              </button>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={layoutMode === 'compact'}
                onClick={() => setLayoutMode('compact')}
              >
                {t('settings.systemDemo.preview.layoutCompact')}
              </button>
            </div>

            <div className="settings-demo-control-row" role="radiogroup" aria-label={t('settings.systemDemo.preview.tone')}>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={visualTone === 'default'}
                onClick={() => setVisualTone('default')}
              >
                {t('settings.systemDemo.preview.toneDefault')}
              </button>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={visualTone === 'accent'}
                onClick={() => setVisualTone('accent')}
              >
                {t('settings.systemDemo.preview.toneAccent')}
              </button>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={visualTone === 'minimal'}
                onClick={() => setVisualTone('minimal')}
              >
                {t('settings.systemDemo.preview.toneMinimal')}
              </button>
            </div>
          </div>
        }
      />

      <DemoParamBlock
        eyebrow={t('settings.systemDemo.form.eyebrow')}
        title={t('settings.systemDemo.form.title')}
        subtitle={t('settings.systemDemo.form.subtitle')}
        note={t('settings.systemDemo.form.note', {
          preset: t(`settings.systemDemo.form.presetLabel.${preset}`),
          scale: String(scalePercent),
          margin: String(marginScale),
        })}
        controls={
          <div className="settings-demo-control-stack">
            <div className="settings-demo-control-row settings-demo-control-row--stretch">
              <select
                className="settings-select"
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
                aria-label={t('settings.systemDemo.form.preset')}
              >
                <option value="baseline">{t('settings.systemDemo.form.presetBaseline')}</option>
                <option value="contrast">{t('settings.systemDemo.form.presetContrast')}</option>
                <option value="matrix">{t('settings.systemDemo.form.presetMatrix')}</option>
              </select>
            </div>

            <div className="settings-demo-control-row">
              <label className="settings-number-item settings-demo-number-item">
                <span>{t('settings.systemDemo.form.scalePercent')}</span>
                <input
                  className="settings-number-input"
                  type="number"
                  min={75}
                  max={150}
                  step={1}
                  value={scalePercent}
                  onChange={(event) => setScalePercent(Number(event.target.value))}
                />
              </label>

              <label className="settings-number-item settings-demo-number-item">
                <span>{t('settings.systemDemo.form.marginScale')}</span>
                <input
                  className="settings-number-input"
                  type="number"
                  min={70}
                  max={160}
                  step={1}
                  value={marginScale}
                  onChange={(event) => setMarginScale(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
        }
      />

      <DemoParamBlock
        eyebrow={t('settings.systemDemo.actions.eyebrow')}
        title={t('settings.systemDemo.actions.title')}
        subtitle={t('settings.systemDemo.actions.subtitle')}
        note={t('settings.systemDemo.actions.warning')}
        controls={
          <div className="settings-demo-control-row">
            <button type="button" className="settings-action-btn">
              {t('settings.systemDemo.actions.apply')}
            </button>
            <button type="button" className="settings-action-btn">
              {t('settings.systemDemo.actions.refresh')}
            </button>
            <button type="button" className="settings-danger-btn">
              {t('settings.systemDemo.actions.reset')}
            </button>
          </div>
        }
      />
    </div>
  );
}

