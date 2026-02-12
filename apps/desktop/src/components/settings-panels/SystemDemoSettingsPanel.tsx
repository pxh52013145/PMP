import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useT } from '../../i18n';

type LayoutMode = 'balanced' | 'focus' | 'compact';
type VisualTone = 'default' | 'accent' | 'minimal';
type AAMethod = 'off' | 'fxaa' | 'taa' | 'dlss';
type DevicePreset = 'default' | 'studio' | 'gaming';
type TransportMode = 'shared' | 'exclusive';

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
    </div>
  );
}

export function SystemDemoSettingsPanel() {
  const t = useT();
  const scaleInputRef = useRef<HTMLInputElement | null>(null);
  const marginInputRef = useRef<HTMLInputElement | null>(null);
  const frameCapInputRef = useRef<HTMLInputElement | null>(null);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  const [visualTone, setVisualTone] = useState<VisualTone>('default');
  const [preset, setPreset] = useState('baseline');
  const [scalePercent, setScalePercent] = useState(100);
  const [marginScale, setMarginScale] = useState(100);
  const [aaMethod, setAaMethod] = useState<AAMethod>('dlss');
  const [devicePreset, setDevicePreset] = useState<DevicePreset>('default');
  const [streamRawEnabled, setStreamRawEnabled] = useState(true);
  const [softLimiterEnabled, setSoftLimiterEnabled] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportMode>('shared');
  const [fov, setFov] = useState(90);
  const [frameCap, setFrameCap] = useState('144');

  const applyFrameCap = () => {
    const parsed = Number.parseInt(frameCap, 10);
    if (!Number.isFinite(parsed)) {
      setFrameCap('144');
      return;
    }
    const clamped = Math.max(0, Math.min(360, parsed));
    setFrameCap(String(clamped));
  };

  const handleNumberFocusSelect = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };

  const resolveWheelAdjustedValue = (input: HTMLInputElement, deltaY: number, currentValue: number) => {
    const stepAttr = input.step;
    const parsedStep = stepAttr && stepAttr !== 'any' ? Number(stepAttr) : 1;
    const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
    const direction = deltaY < 0 ? 1 : -1;

    let next = currentValue + direction * step;
    if (input.min !== '') {
      const min = Number(input.min);
      if (Number.isFinite(min)) next = Math.max(min, next);
    }
    if (input.max !== '') {
      const max = Number(input.max);
      if (Number.isFinite(max)) next = Math.min(max, next);
    }

    const stepDecimals = step.toString().includes('.') ? step.toString().split('.')[1]?.length ?? 0 : 0;
    return Number(next.toFixed(stepDecimals));
  };

  useEffect(() => {
    const bindings: Array<{ element: HTMLInputElement | null; apply: (next: number) => void }> = [
      {
        element: scaleInputRef.current,
        apply: (next) => setScalePercent(next),
      },
      {
        element: marginInputRef.current,
        apply: (next) => setMarginScale(next),
      },
      {
        element: frameCapInputRef.current,
        apply: (next) => setFrameCap(String(next)),
      },
    ];

    const disposers: Array<() => void> = [];

    for (const binding of bindings) {
      const input = binding.element;
      if (!input) continue;

      const handler = (event: globalThis.WheelEvent) => {
        if (document.activeElement !== input) return;
        event.preventDefault();
        event.stopPropagation();

        const parsedCurrent = Number(input.value);
        const safeCurrent = Number.isFinite(parsedCurrent) ? parsedCurrent : 0;
        const next = resolveWheelAdjustedValue(input, event.deltaY, safeCurrent);
        binding.apply(next);
      };

      input.addEventListener('wheel', handler, { passive: false });
      disposers.push(() => input.removeEventListener('wheel', handler));
    }

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, []);

  return (
    <div className="settings-audio-panel settings-demo-panel">
      <DemoParamBlock
        eyebrow="STYLE PREVIEW"
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
        eyebrow="FORM PARAMETERS"
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
                  ref={scaleInputRef}
                  className="settings-number-input"
                  type="number"
                  min={75}
                  max={150}
                  step={1}
                  value={scalePercent}
                  onFocus={handleNumberFocusSelect}
                  onChange={(event) => setScalePercent(Number(event.target.value))}
                />
              </label>

              <label className="settings-number-item settings-demo-number-item">
                <span>{t('settings.systemDemo.form.marginScale')}</span>
                <input
                  ref={marginInputRef}
                  className="settings-number-input"
                  type="number"
                  min={70}
                  max={160}
                  step={1}
                  value={marginScale}
                  onFocus={handleNumberFocusSelect}
                  onChange={(event) => setMarginScale(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
        }
      />

      <DemoParamBlock
        eyebrow="AUDIO PIPELINE"
        title={t('settings.systemDemo.pipeline.title')}
        subtitle={t('settings.systemDemo.pipeline.subtitle')}
        note={t('settings.systemDemo.pipeline.note', {
          aa: t(`settings.systemDemo.pipeline.aaLabel.${aaMethod}`),
          transport: t(`settings.systemDemo.pipeline.transportLabel.${transportMode}`),
          raw: streamRawEnabled ? t('settings.systemDemo.pipeline.switch.on') : t('settings.systemDemo.pipeline.switch.off'),
        })}
        controls={
          <div className="settings-demo-control-stack settings-demo-pipeline-controls">
            <div className="settings-demo-control-row settings-demo-control-row--stretch">
              <select
                className="settings-select"
                value={aaMethod}
                onChange={(event) => setAaMethod(event.target.value as AAMethod)}
                aria-label={t('settings.systemDemo.pipeline.aaMethod')}
              >
                <option value="off">{t('settings.systemDemo.pipeline.aaOff')}</option>
                <option value="fxaa">{t('settings.systemDemo.pipeline.aaFxaa')}</option>
                <option value="taa">{t('settings.systemDemo.pipeline.aaTaa')}</option>
                <option value="dlss">{t('settings.systemDemo.pipeline.aaDlss')}</option>
              </select>
            </div>

            <div className="settings-demo-control-row settings-demo-control-row--stretch">
              <select
                className="settings-select"
                value={devicePreset}
                onChange={(event) => setDevicePreset(event.target.value as DevicePreset)}
                aria-label={t('settings.systemDemo.pipeline.devicePreset')}
              >
                <option value="default">{t('settings.systemDemo.pipeline.deviceDefault')}</option>
                <option value="studio">{t('settings.systemDemo.pipeline.deviceStudio')}</option>
                <option value="gaming">{t('settings.systemDemo.pipeline.deviceGaming')}</option>
              </select>
            </div>

            <div className="settings-demo-pipeline-switches">
              <div className="settings-demo-pipeline-switch-row">
                <span className="settings-demo-pipeline-switch-title">
                  {t('settings.systemDemo.pipeline.streamRaw')}
                </span>
                <div className="settings-demo-pipeline-switch-right">
                  <label className="settings-demo-switch" aria-label={t('settings.systemDemo.pipeline.streamRaw')}>
                    <input
                      type="checkbox"
                      checked={streamRawEnabled}
                      onChange={(event) => setStreamRawEnabled(event.target.checked)}
                    />
                    <span className="settings-demo-switch-track">
                      <span className="settings-demo-switch-thumb" />
                    </span>
                  </label>
                  <span className="settings-demo-switch-label settings-demo-switch-label--dim">
                    {streamRawEnabled
                      ? t('settings.systemDemo.pipeline.switch.on')
                      : t('settings.systemDemo.pipeline.switch.off')}
                  </span>
                </div>
              </div>

              <div className="settings-demo-pipeline-switch-row">
                <span className="settings-demo-pipeline-switch-title">
                  {t('settings.systemDemo.pipeline.softLimiter')}
                </span>
                <div className="settings-demo-pipeline-switch-right">
                  <label className="settings-demo-switch" aria-label={t('settings.systemDemo.pipeline.softLimiter')}>
                    <input
                      type="checkbox"
                      checked={softLimiterEnabled}
                      onChange={(event) => setSoftLimiterEnabled(event.target.checked)}
                    />
                    <span className="settings-demo-switch-track">
                      <span className="settings-demo-switch-thumb" />
                    </span>
                  </label>
                  <span className="settings-demo-switch-label settings-demo-switch-label--dim">
                    {softLimiterEnabled
                      ? t('settings.systemDemo.pipeline.switch.on')
                      : t('settings.systemDemo.pipeline.switch.off')}
                  </span>
                </div>
              </div>
            </div>

            <div
              className="settings-demo-control-row settings-demo-pipeline-transport"
              role="radiogroup"
              aria-label={t('settings.systemDemo.pipeline.transportMode')}
            >
              <button
                type="button"
                className="settings-choice-btn"
                data-active={transportMode === 'shared'}
                onClick={() => setTransportMode('shared')}
              >
                {t('settings.systemDemo.pipeline.transportShared')}
              </button>
              <button
                type="button"
                className="settings-choice-btn"
                data-active={transportMode === 'exclusive'}
                onClick={() => setTransportMode('exclusive')}
              >
                {t('settings.systemDemo.pipeline.transportExclusive')}
              </button>
            </div>
          </div>
        }
      />

      <DemoParamBlock
        eyebrow="REALTIME TUNING"
        title={t('settings.systemDemo.tuning.title')}
        subtitle={t('settings.systemDemo.tuning.subtitle')}
        note={t('settings.systemDemo.tuning.note', {
          fov: String(fov),
          cap: frameCap,
        })}
        controls={
          <div className="settings-demo-control-stack">
            <div className="settings-demo-control-row settings-demo-control-row--stretch">
              <div className="settings-demo-slider-wrap">
                <input
                  type="range"
                  min={60}
                  max={120}
                  value={fov}
                  className="settings-demo-range"
                  onChange={(event) => setFov(Number(event.target.value))}
                  aria-label={t('settings.systemDemo.tuning.fov')}
                />
                <span className="settings-demo-slider-value">{fov}</span>
              </div>
            </div>

            <div className="settings-demo-control-row settings-demo-control-row--stretch">
              <div className="settings-demo-input-group">
                <input
                  ref={frameCapInputRef}
                  className="settings-number-input settings-demo-inline-input"
                  type="number"
                  min={0}
                  max={360}
                  step={1}
                  value={frameCap}
                  onFocus={handleNumberFocusSelect}
                  onChange={(event) => setFrameCap(event.target.value)}
                  aria-label={t('settings.systemDemo.tuning.frameCap')}
                />
                <button type="button" className="settings-action-btn" onClick={applyFrameCap}>
                  {t('settings.systemDemo.tuning.apply')}
                </button>
              </div>
            </div>
          </div>
        }
      />

      <DemoParamBlock
        eyebrow="ACTION ROUTING"
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
