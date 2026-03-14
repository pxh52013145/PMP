import { invoke } from '@tauri-apps/api/tauri';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton, PmpChoiceButton } from '../primitives';

type NativeDspEqBandKind = 'peaking' | 'low-shelf' | 'high-shelf';

type NativeDspEqBand = {
  kind: NativeDspEqBandKind;
  frequencyHz: number;
  q: number;
  gainDb: number;
};

type NativeDspNodeConfig =
  | { type: 'gain'; db: number }
  | { type: 'eq'; bands: NativeDspEqBand[] }
  | { type: 'limiter'; thresholdDb: number };

type DspState = {
  gainDb: number;
  eqBands: NativeDspEqBand[];
  limiterEnabled: boolean;
  limiterThresholdDb: number;
};

const DEFAULT_EQ_BANDS: NativeDspEqBand[] = [
  { kind: 'low-shelf', frequencyHz: 120, q: 1, gainDb: 0 },
  { kind: 'peaking', frequencyHz: 1000, q: 1, gainDb: 0 },
  { kind: 'high-shelf', frequencyHz: 8000, q: 1, gainDb: 0 },
];

const DEFAULT_DSP_STATE: DspState = {
  gainDb: 0,
  eqBands: DEFAULT_EQ_BANDS,
  limiterEnabled: false,
  limiterThresholdDb: -1,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parsePersistedDspState(raw: unknown): DspState {
  if (!Array.isArray(raw)) {
    return {
      ...DEFAULT_DSP_STATE,
      eqBands: DEFAULT_EQ_BANDS.map((band) => ({ ...band })),
    };
  }

  let gainDb = DEFAULT_DSP_STATE.gainDb;
  let limiterEnabled = DEFAULT_DSP_STATE.limiterEnabled;
  let limiterThresholdDb = DEFAULT_DSP_STATE.limiterThresholdDb;
  let eqBands = DEFAULT_EQ_BANDS.map((band) => ({ ...band }));

  const gainNode = raw.find((node): node is { type: 'gain'; db: number } => {
    const record = asRecord(node);
    return record?.type === 'gain' && typeof record.db === 'number';
  });
  if (gainNode) {
    gainDb = clampNumber(gainNode.db, -24, 24);
  }

  const eqNode = raw.find((node): node is { type: 'eq'; bands: unknown[] } => {
    const record = asRecord(node);
    return record?.type === 'eq' && Array.isArray(record.bands);
  });
  if (eqNode) {
    const parsed: NativeDspEqBand[] = [];
    for (const band of eqNode.bands) {
      const bandRecord = asRecord(band);
      if (!bandRecord) continue;
      const kind = bandRecord.kind as NativeDspEqBandKind | undefined;
      const frequencyHz = typeof bandRecord.frequencyHz === 'number' ? bandRecord.frequencyHz : null;
      const q = typeof bandRecord.q === 'number' ? bandRecord.q : null;
      const gainDbValue = typeof bandRecord.gainDb === 'number' ? bandRecord.gainDb : null;
      if (!kind || frequencyHz === null || q === null || gainDbValue === null) continue;
      if (kind !== 'peaking' && kind !== 'low-shelf' && kind !== 'high-shelf') continue;
      parsed.push({
        kind,
        frequencyHz,
        q,
        gainDb: clampNumber(gainDbValue, -18, 18),
      });
    }
    if (parsed.length > 0) {
      eqBands = parsed;
    }
  }

  const limiterNode = raw.find((node): node is { type: 'limiter'; thresholdDb: number } => {
    const record = asRecord(node);
    return record?.type === 'limiter' && typeof record.thresholdDb === 'number';
  });
  if (limiterNode) {
    limiterEnabled = true;
    limiterThresholdDb = clampNumber(limiterNode.thresholdDb, -24, 0);
  }

  return {
    gainDb,
    eqBands,
    limiterEnabled,
    limiterThresholdDb,
  };
}

function buildDspChain(state: DspState): NativeDspNodeConfig[] {
  const chain: NativeDspNodeConfig[] = [
    { type: 'gain', db: state.gainDb },
    { type: 'eq', bands: state.eqBands },
  ];
  if (state.limiterEnabled) {
    chain.push({ type: 'limiter', thresholdDb: state.limiterThresholdDb });
  }
  return chain;
}

export function AudioDspSettingsPanel() {
  const t = useT();
  const { isNativeAvailable } = useAudioEngine();
  const canUseBackend = isTauriRuntime() && isNativeAvailable;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dsp, setDsp] = useState<DspState>(() =>
    parsePersistedDspState(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN))
  );

  const chainPreview = useMemo(() => {
    const limiterText = dsp.limiterEnabled
      ? `${t('common.state.on')} @ ${dsp.limiterThresholdDb.toFixed(1)} dB`
      : t('common.state.off');
    return t('settings.audioDsp.badge', {
      gain: dsp.gainDb.toFixed(1),
      low: dsp.eqBands[0]?.gainDb.toFixed(1) ?? '0.0',
      mid: dsp.eqBands[1]?.gainDb.toFixed(1) ?? '0.0',
      high: dsp.eqBands[2]?.gainDb.toFixed(1) ?? '0.0',
      limiter: limiterText,
    });
  }, [dsp, t]);

  const loadPersisted = useCallback(() => {
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN);
    setDsp(parsePersistedDspState(persisted));
  }, []);

  useEffect(() => {
    if (!canUseBackend) return;
    loadPersisted();
  }, [canUseBackend, loadPersisted]);

  const applyChain = useCallback(
    async (next: DspState) => {
      if (!canUseBackend || busy) return;
      setBusy(true);
      setError(null);
      try {
        const chain = buildDspChain(next);
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN,
          chain,
          TAURI_EVENTS.NATIVE_AUDIO_DSP_CHAIN_UPDATED
        );
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
          next.gainDb,
          TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
        );
        await invoke('native_audio_set_dsp_chain', { chain });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, canUseBackend]
  );

  const setEqBandGain = useCallback((index: number, gainDb: number) => {
    setDsp((prev) => ({
      ...prev,
      eqBands: prev.eqBands.map((band, bandIndex) =>
        bandIndex === index ? { ...band, gainDb: clampNumber(gainDb, -18, 18) } : band
      ),
    }));
  }, []);

  const resetAll = useCallback(() => {
    setDsp({
      gainDb: 0,
      eqBands: DEFAULT_EQ_BANDS.map((band) => ({ ...band })),
      limiterEnabled: false,
      limiterThresholdDb: -1,
    });
  }, []);

  return (
    <div className="settings-audio-panel">
      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">DSP CORE</p>
          <h3 className="settings-param-title">{t('settings.audioDsp.gain.title')}</h3>
          <p className="settings-param-subtitle">Master Gain & Headroom</p>
        </div>
        <p className="settings-card-note">{chainPreview}</p>

        {!canUseBackend ? (
          <>
            <p className="settings-card-note">{t('settings.audioDsp.note.requireNative')}</p>
          </>
        ) : (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioDsp.gain.db')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={-24}
                  max={24}
                  step={0.1}
                  value={dsp.gainDb}
                  onChange={(e) =>
                    setDsp((prev) => ({
                      ...prev,
                      gainDb: clampNumber(Number(e.target.value), -24, 24),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioDsp.gain.presets')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <PmpChoiceButton
                  type="button"
                  className="settings-choice-btn"
                  active={Math.abs(dsp.gainDb + 6) <= 0.05}
                  onClick={() => setDsp((prev) => ({ ...prev, gainDb: -6 }))}
                  disabled={busy}
                >
                  {t('settings.audioDsp.gain.preset.minus6')}
                </PmpChoiceButton>
                <PmpChoiceButton
                  type="button"
                  className="settings-choice-btn"
                  active={Math.abs(dsp.gainDb) <= 0.05}
                  onClick={() => setDsp((prev) => ({ ...prev, gainDb: 0 }))}
                  disabled={busy}
                >
                  {t('settings.audioDsp.gain.preset.zero')}
                </PmpChoiceButton>
                <PmpChoiceButton
                  type="button"
                  className="settings-choice-btn"
                  active={Math.abs(dsp.gainDb - 6) <= 0.05}
                  onClick={() => setDsp((prev) => ({ ...prev, gainDb: 6 }))}
                  disabled={busy}
                >
                  {t('settings.audioDsp.gain.preset.plus6')}
                </PmpChoiceButton>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">EQ MATRIX</p>
          <h3 className="settings-param-title">{t('settings.audioDsp.eq.title')}</h3>
          <p className="settings-param-subtitle">Three-Band Tonal Balance</p>
        </div>
        {!canUseBackend ? (
          <>
            <p className="settings-card-note">{t('settings.audioDsp.note.requireNative')}</p>
          </>
        ) : (
          <>
            <div className="settings-row-desc-list">
              {dsp.eqBands.map((band, index) => {
                const label =
                  band.kind === 'low-shelf'
                    ? t('settings.audioDsp.eq.band.low')
                    : band.kind === 'high-shelf'
                      ? t('settings.audioDsp.eq.band.high')
                      : t('settings.audioDsp.eq.band.mid');
                return (
                  <div key={`${band.kind}-${index}`} className="settings-inline-row">
                    <div className="settings-inline-row-copy">
                      <p className="settings-inline-row-title">
                        {label} · {Math.round(band.frequencyHz)} Hz
                      </p>
                    </div>
                    <div className="settings-inline-row-controls">
                      <input
                        className="settings-number-input"
                        type="number"
                        min={-18}
                        max={18}
                        step={0.1}
                        value={band.gainDb}
                        onChange={(e) => setEqBandGain(index, Number(e.target.value))}
                        disabled={busy}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="settings-card-note">{t('settings.audioDsp.eq.gainDb')}</p>

            <div className="settings-section-controls">
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() =>
                  setDsp((prev) => ({
                    ...prev,
                    eqBands: prev.eqBands.map((band) => ({ ...band, gainDb: 0 })),
                  }))
                }
                disabled={busy}
              >
                {t('common.action.reset')}
              </PmpButton>
            </div>
          </>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">LIMITER</p>
          <h3 className="settings-param-title">{t('settings.audioDsp.limiter.title')}</h3>
          <p className="settings-param-subtitle">Peak Ceiling Guard</p>
        </div>
        {!canUseBackend ? (
          <>
            <p className="settings-card-note">{t('settings.audioDsp.note.requireNative')}</p>
          </>
        ) : (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <PmpChoiceButton
                  type="button"
                  className="settings-choice-btn"
                  active={!dsp.limiterEnabled}
                  onClick={() => setDsp((prev) => ({ ...prev, limiterEnabled: false }))}
                  disabled={busy}
                >
                  {t('settings.audioDsp.limiter.disable')}
                </PmpChoiceButton>
                <PmpChoiceButton
                  type="button"
                  className="settings-choice-btn"
                  active={dsp.limiterEnabled}
                  onClick={() => setDsp((prev) => ({ ...prev, limiterEnabled: true }))}
                  disabled={busy}
                >
                  {t('settings.audioDsp.limiter.enable')}
                </PmpChoiceButton>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioDsp.limiter.thresholdDb')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={-24}
                  max={0}
                  step={0.1}
                  value={dsp.limiterThresholdDb}
                  onChange={(e) =>
                    setDsp((prev) => ({
                      ...prev,
                      limiterThresholdDb: clampNumber(Number(e.target.value), -24, 0),
                    }))
                  }
                  disabled={busy || !dsp.limiterEnabled}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {canUseBackend && (
        <div className="settings-section-controls">
          <PmpButton
            type="button"
            className="settings-action-btn"
            variant="default"
            onClick={() => void applyChain(dsp)}
            disabled={busy}
          >
            {t('common.action.apply')}
          </PmpButton>
          <PmpButton
            type="button"
            className="settings-action-btn"
            variant="default"
            onClick={() => {
              resetAll();
            }}
            disabled={busy}
          >
            {t('common.action.reset')}
          </PmpButton>
          <PmpButton
            type="button"
            className="settings-action-btn"
            variant="default"
            onClick={loadPersisted}
            disabled={busy}
          >
            {t('common.action.refresh')}
          </PmpButton>
        </div>
      )}

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
