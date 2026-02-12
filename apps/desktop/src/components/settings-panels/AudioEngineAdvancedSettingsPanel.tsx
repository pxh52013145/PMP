import { invoke } from '@tauri-apps/api/tauri';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';

type ReplayGainMode = 'track' | 'album';
type NativeAudioSrcMode = 'source-native' | 'match-output' | 'target-rate';
type NativeAudioSrcBackend = 'rubato' | 'linear-simd';
type NativeAudioOutputQuantizationMode = 'round' | 'tpdf';
type AudioPolicyPresetId = 'reference' | 'hifi' | 'balanced' | 'stable' | 'low-power';

type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

type DynamicSrcSettings = {
  enabled: boolean;
  adaptiveEnabled: boolean;
  learningEnabled: boolean;
  restoreDebounceMs: number;
  minSwitchIntervalMs: number;
  seekHoldMs: number;
  underrunHoldMs: number;
  sharedStressHoldMs: number;
  outputErrorHoldMs: number;
};

type EnginePolicyState = {
  transportMode: 'robust' | 'transport-exact';
  srcMode: NativeAudioSrcMode;
  srcBackend: NativeAudioSrcBackend;
  srcTargetSampleRate: number | null;
  outputQuantizationMode: NativeAudioOutputQuantizationMode;
};

const DEFAULT_REPLAYGAIN: ReplayGainSettings = {
  enabled: true,
  mode: 'track',
  preampDb: 0,
};

const DEFAULT_CROSSFADE: CrossfadeSettings = {
  enabled: false,
  durationMs: 1200,
};

const DEFAULT_DYNAMIC_SRC: DynamicSrcSettings = {
  enabled: true,
  adaptiveEnabled: true,
  learningEnabled: true,
  restoreDebounceMs: 4000,
  minSwitchIntervalMs: 600,
  seekHoldMs: 2000,
  underrunHoldMs: 12000,
  sharedStressHoldMs: 8000,
  outputErrorHoldMs: 10000,
};

const DEFAULT_ENGINE_POLICY: EnginePolicyState = {
  transportMode: 'robust',
  srcMode: 'match-output',
  srcBackend: 'rubato',
  srcTargetSampleRate: 96000,
  outputQuantizationMode: 'round',
};

const AUDIO_POLICY_PRESETS: Record<AudioPolicyPresetId, EnginePolicyState> = {
  reference: {
    transportMode: 'transport-exact',
    srcMode: 'source-native',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
    outputQuantizationMode: 'round',
  },
  hifi: {
    transportMode: 'robust',
    srcMode: 'target-rate',
    srcBackend: 'rubato',
    srcTargetSampleRate: 192000,
    outputQuantizationMode: 'tpdf',
  },
  balanced: {
    transportMode: 'robust',
    srcMode: 'match-output',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
    outputQuantizationMode: 'tpdf',
  },
  stable: {
    transportMode: 'robust',
    srcMode: 'match-output',
    srcBackend: 'linear-simd',
    srcTargetSampleRate: null,
    outputQuantizationMode: 'round',
  },
  'low-power': {
    transportMode: 'robust',
    srcMode: 'target-rate',
    srcBackend: 'linear-simd',
    srcTargetSampleRate: 48000,
    outputQuantizationMode: 'round',
  },
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function parseReplayGainSettings(raw: unknown): ReplayGainSettings {
  const record = toRecord(raw);
  const enabled = typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_REPLAYGAIN.enabled;
  const mode = record?.mode === 'album' ? 'album' : 'track';
  const preampDbRaw = typeof record?.preampDb === 'number' ? record.preampDb : DEFAULT_REPLAYGAIN.preampDb;
  return {
    enabled,
    mode,
    preampDb: clampNumber(preampDbRaw, -18, 18),
  };
}

function parseCrossfadeSettings(raw: unknown): CrossfadeSettings {
  const record = toRecord(raw);
  const enabled = typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_CROSSFADE.enabled;
  const durationMsRaw = typeof record?.durationMs === 'number' ? record.durationMs : DEFAULT_CROSSFADE.durationMs;
  return {
    enabled,
    durationMs: Math.floor(clampNumber(durationMsRaw, 0, 30000)),
  };
}

function parseDynamicSrcSettings(raw: unknown): DynamicSrcSettings {
  const record = toRecord(raw);
  return {
    enabled: typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_DYNAMIC_SRC.enabled,
    adaptiveEnabled:
      typeof record?.adaptiveEnabled === 'boolean'
        ? record.adaptiveEnabled
        : DEFAULT_DYNAMIC_SRC.adaptiveEnabled,
    learningEnabled:
      typeof record?.learningEnabled === 'boolean'
        ? record.learningEnabled
        : DEFAULT_DYNAMIC_SRC.learningEnabled,
    restoreDebounceMs: Math.floor(
      clampNumber(
        typeof record?.restoreDebounceMs === 'number'
          ? record.restoreDebounceMs
          : DEFAULT_DYNAMIC_SRC.restoreDebounceMs,
        500,
        30000
      )
    ),
    minSwitchIntervalMs: Math.floor(
      clampNumber(
        typeof record?.minSwitchIntervalMs === 'number'
          ? record.minSwitchIntervalMs
          : DEFAULT_DYNAMIC_SRC.minSwitchIntervalMs,
        100,
        10000
      )
    ),
    seekHoldMs: Math.floor(
      clampNumber(
        typeof record?.seekHoldMs === 'number' ? record.seekHoldMs : DEFAULT_DYNAMIC_SRC.seekHoldMs,
        500,
        20000
      )
    ),
    underrunHoldMs: Math.floor(
      clampNumber(
        typeof record?.underrunHoldMs === 'number'
          ? record.underrunHoldMs
          : DEFAULT_DYNAMIC_SRC.underrunHoldMs,
        2000,
        120000
      )
    ),
    sharedStressHoldMs: Math.floor(
      clampNumber(
        typeof record?.sharedStressHoldMs === 'number'
          ? record.sharedStressHoldMs
          : DEFAULT_DYNAMIC_SRC.sharedStressHoldMs,
        1000,
        90000
      )
    ),
    outputErrorHoldMs: Math.floor(
      clampNumber(
        typeof record?.outputErrorHoldMs === 'number'
          ? record.outputErrorHoldMs
          : DEFAULT_DYNAMIC_SRC.outputErrorHoldMs,
        1000,
        120000
      )
    ),
  };
}

function parseEnginePolicy(raw: unknown): EnginePolicyState {
  const record = toRecord(raw);

  const transportMode =
    record?.transportMode === 'transport-exact' || record?.transportMode === 'robust'
      ? record.transportMode
      : DEFAULT_ENGINE_POLICY.transportMode;

  const srcMode =
    record?.srcMode === 'source-native' ||
    record?.srcMode === 'match-output' ||
    record?.srcMode === 'target-rate'
      ? record.srcMode
      : DEFAULT_ENGINE_POLICY.srcMode;

  const srcBackend =
    record?.srcBackend === 'linear-simd' || record?.srcBackend === 'rubato'
      ? record.srcBackend
      : DEFAULT_ENGINE_POLICY.srcBackend;

  const srcTargetSampleRate =
    typeof record?.srcTargetSampleRate === 'number' && Number.isFinite(record.srcTargetSampleRate)
      ? Math.floor(clampNumber(record.srcTargetSampleRate, 8000, 768000))
      : null;

  const outputQuantizationMode: NativeAudioOutputQuantizationMode =
    record?.outputQuantizationMode === 'tpdf' || record?.outputQuantizationMode === 'round'
      ? record.outputQuantizationMode
      : DEFAULT_ENGINE_POLICY.outputQuantizationMode;

  return {
    transportMode,
    srcMode,
    srcBackend,
    srcTargetSampleRate,
    outputQuantizationMode,
  };
}

function resolvePolicyPresetId(policy: EnginePolicyState): AudioPolicyPresetId | 'custom' {
  const keys = Object.keys(AUDIO_POLICY_PRESETS) as AudioPolicyPresetId[];
  for (const key of keys) {
    const preset = AUDIO_POLICY_PRESETS[key];
    if (
      preset.transportMode === policy.transportMode &&
      preset.srcMode === policy.srcMode &&
      preset.srcBackend === policy.srcBackend &&
      preset.srcTargetSampleRate === policy.srcTargetSampleRate &&
      preset.outputQuantizationMode === policy.outputQuantizationMode
    ) {
      return key;
    }
  }
  return 'custom';
}

type SettingHelpLabelProps = {
  title: string;
  help: string;
};

function SettingHelpLabel({ title, help }: SettingHelpLabelProps) {
  return (
    <div className="settings-inline-title-wrap">
      <p className="settings-inline-row-title">{title}</p>
      <button
        type="button"
        className="settings-inline-help"
        aria-label={help}
        title={help}
      >
        ?
      </button>
    </div>
  );
}

export function AudioEngineAdvancedSettingsPanel() {
  const t = useT();
  const audioService = useAudioService();
  const { isNativeAvailable } = useAudioEngine();
  const isTauri = isTauriRuntime();
  const canUse = isTauri && isNativeAvailable;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replayGain, setReplayGain] = useState<ReplayGainSettings>(() =>
    parseReplayGainSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS))
  );
  const [crossfade, setCrossfade] = useState<CrossfadeSettings>(() =>
    parseCrossfadeSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS))
  );

  const [enginePolicy, setEnginePolicy] = useState<EnginePolicyState>(DEFAULT_ENGINE_POLICY);
  const [policyPreset, setPolicyPreset] = useState<AudioPolicyPresetId | 'custom'>('custom');
  const [dynamicSrc, setDynamicSrc] = useState<DynamicSrcSettings>(DEFAULT_DYNAMIC_SRC);

  const sourceRateChoices = useMemo(() => [44100, 48000, 88200, 96000, 176400, 192000], []);

  const refresh = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      const policyPayload = await invoke<unknown>('native_audio_get_engine_policy');
      const parsedPolicy = parseEnginePolicy(policyPayload);
      setEnginePolicy(parsedPolicy);
      setPolicyPreset(resolvePolicyPresetId(parsedPolicy));

      const getter = audioService.getDynamicSrcAutoSettings;
      if (typeof getter === 'function') {
        const settings = getter.call(audioService);
        setDynamicSrc(parseDynamicSrcSettings(settings));
      } else {
        setDynamicSrc(
          parseDynamicSrcSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS))
        );
      }

      setReplayGain(parseReplayGainSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS)));
      setCrossfade(parseCrossfadeSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPolicyPreset(resolvePolicyPresetId(enginePolicy));
  }, [enginePolicy]);

  useEffect(() => {
    if (
      enginePolicy.transportMode === 'transport-exact' &&
      enginePolicy.outputQuantizationMode !== 'round'
    ) {
      setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'round' }));
    }
  }, [enginePolicy.transportMode, enginePolicy.outputQuantizationMode]);

  const applyReplayGain = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
        replayGain,
        TAURI_EVENTS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS_UPDATED
      );

      const track = audioService.getState().currentTrack;
      const base = replayGain.mode === 'album' ? track?.replayGainAlbumGainDb : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && Number.isFinite(base);
      const effectiveDb = replayGain.enabled && hasBase ? base + replayGain.preampDb : null;
      await invoke('native_audio_set_replay_gain', {
        db: typeof effectiveDb === 'number' ? clampNumber(effectiveDb, -30, 30) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, replayGain]);

  const applyCrossfade = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
        crossfade,
        TAURI_EVENTS.NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canUse, crossfade]);

  const applyEnginePolicy = useCallback(async () => {
    if (!canUse || typeof audioService.setEnginePolicy !== 'function') return;

    setBusy(true);
    setError(null);
    try {
      await audioService.setEnginePolicy({
        transportMode: enginePolicy.transportMode,
        srcMode: enginePolicy.srcMode,
        srcBackend: enginePolicy.srcBackend,
        srcTargetSampleRate: enginePolicy.srcMode === 'target-rate' ? enginePolicy.srcTargetSampleRate : null,
        outputQuantizationMode: enginePolicy.outputQuantizationMode,
      });
      setPolicyPreset(resolvePolicyPresetId(enginePolicy));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, enginePolicy, refresh]);

  const applyPolicyPreset = useCallback(
    (presetId: AudioPolicyPresetId) => {
      setPolicyPreset(presetId);
      setEnginePolicy(AUDIO_POLICY_PRESETS[presetId]);
    },
    []
  );

  const applyDynamicSrc = useCallback(async () => {
    if (!canUse || typeof audioService.setDynamicSrcAutoSettings !== 'function') return;

    setBusy(true);
    setError(null);
    try {
      await audioService.setDynamicSrcAutoSettings(dynamicSrc);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, dynamicSrc, refresh]);

  return (
    <div className="settings-audio-panel">
      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">PLAYBACK GAIN</p>
          <h3 className="settings-param-title">{t('settings.audioAdvanced.replayGain.title')}</h3>
          <p className="settings-param-subtitle">ReplayGain & Loudness Calibration</p>
        </div>

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={replayGain.enabled}
                  onClick={() => setReplayGain((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={!replayGain.enabled}
                  onClick={() => setReplayGain((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.replayGain.mode.label')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={replayGain.mode === 'track'}
                  onClick={() => setReplayGain((prev) => ({ ...prev, mode: 'track' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.replayGain.mode.track')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={replayGain.mode === 'album'}
                  onClick={() => setReplayGain((prev) => ({ ...prev, mode: 'album' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.replayGain.mode.album')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.replayGain.preampDb')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={-18}
                  max={18}
                  step={0.5}
                  value={replayGain.preampDb}
                  onChange={(e) =>
                    setReplayGain((prev) => ({
                      ...prev,
                      preampDb: clampNumber(Number(e.target.value), -18, 18),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void applyReplayGain()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">TRANSITION</p>
          <h3 className="settings-param-title">{t('settings.audioAdvanced.crossfade.title')}</h3>
          <p className="settings-param-subtitle">Playback Transition & Fade Timing</p>
        </div>

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={crossfade.enabled}
                  onClick={() => setCrossfade((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={!crossfade.enabled}
                  onClick={() => setCrossfade((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.crossfade.durationMs')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={0}
                  max={30000}
                  step={100}
                  value={crossfade.durationMs}
                  onChange={(e) =>
                    setCrossfade((prev) => ({
                      ...prev,
                      durationMs: Math.floor(clampNumber(Number(e.target.value), 0, 30000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void applyCrossfade()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">SRC POLICY</p>
          <h3 className="settings-param-title">{t('settings.audioAdvanced.enginePolicy.title')}</h3>
          <p className="settings-param-subtitle">Transport & Sample Rate Conversion</p>
        </div>

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.presets.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.presets')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={policyPreset === 'reference'}
                  onClick={() => applyPolicyPreset('reference')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.presets.reference')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={policyPreset === 'hifi'}
                  onClick={() => applyPolicyPreset('hifi')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.presets.hifi')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={policyPreset === 'balanced'}
                  onClick={() => applyPolicyPreset('balanced')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.presets.balanced')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={policyPreset === 'stable'}
                  onClick={() => applyPolicyPreset('stable')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.presets.stable')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={policyPreset === 'low-power'}
                  onClick={() => applyPolicyPreset('low-power')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.presets.lowPower')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.transport.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.transport')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.transportMode === 'robust'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, transportMode: 'robust' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.transport.robust')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.transportMode === 'transport-exact'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, transportMode: 'transport-exact' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.transport.exact')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.srcMode.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.srcMode')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.srcMode === 'source-native'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcMode: 'source-native' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.sourceNative')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.srcMode === 'match-output'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcMode: 'match-output' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.matchOutput')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.srcMode === 'target-rate'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcMode: 'target-rate' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.targetRate')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.srcBackend.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.srcBackend')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.srcBackend === 'rubato'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcBackend: 'rubato' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcBackend.rubato')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.srcBackend === 'linear-simd'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcBackend: 'linear-simd' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcBackend.linearSimd')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.srcTargetRate.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.srcTargetRate')}
                />
              </div>
              <div className="settings-inline-row-controls">
                {sourceRateChoices.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className="settings-choice-btn"
                    data-active={enginePolicy.srcTargetSampleRate === rate}
                    onClick={() => setEnginePolicy((prev) => ({ ...prev, srcTargetSampleRate: rate }))}
                    disabled={busy || enginePolicy.srcMode !== 'target-rate'}
                  >
                    {rate / 1000}k
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.outputQuantizationMode')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.outputQuantizationMode === 'round'}
                  onClick={() =>
                    setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'round' }))
                  }
                  disabled={busy || enginePolicy.transportMode === 'transport-exact'}
                >
                  {t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.round')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={enginePolicy.outputQuantizationMode === 'tpdf'}
                  onClick={() =>
                    setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'tpdf' }))
                  }
                  disabled={busy || enginePolicy.transportMode === 'transport-exact'}
                >
                  {t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.tpdf')}
                </button>
              </div>
            </div>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void applyEnginePolicy()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">DYNAMIC SRC</p>
          <h3 className="settings-param-title">{t('settings.audioAdvanced.dynamicSrc.title')}</h3>
          <p className="settings-param-subtitle">Adaptive Stability Strategy</p>
        </div>

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={dynamicSrc.enabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.dynamicSrc.enable')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={!dynamicSrc.enabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.dynamicSrc.disable')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.adaptive')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.adaptive')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={dynamicSrc.adaptiveEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, adaptiveEnabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={!dynamicSrc.adaptiveEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, adaptiveEnabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.learning')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.learning')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={dynamicSrc.learningEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, learningEnabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </button>
                <button
                  type="button"
                  className="settings-choice-btn"
                  data-active={!dynamicSrc.learningEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, learningEnabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </button>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.restoreDebounceMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.restoreDebounceMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={500}
                  max={30000}
                  step={100}
                  value={dynamicSrc.restoreDebounceMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      restoreDebounceMs: Math.floor(clampNumber(Number(e.target.value), 500, 30000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.minSwitchIntervalMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.minSwitchIntervalMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={100}
                  max={10000}
                  step={50}
                  value={dynamicSrc.minSwitchIntervalMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      minSwitchIntervalMs: Math.floor(clampNumber(Number(e.target.value), 100, 10000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.seekHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.seekHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={500}
                  max={20000}
                  step={100}
                  value={dynamicSrc.seekHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      seekHoldMs: Math.floor(clampNumber(Number(e.target.value), 500, 20000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.underrunHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.underrunHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={2000}
                  max={120000}
                  step={500}
                  value={dynamicSrc.underrunHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      underrunHoldMs: Math.floor(clampNumber(Number(e.target.value), 2000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.sharedStressHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.sharedStressHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={90000}
                  step={500}
                  value={dynamicSrc.sharedStressHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      sharedStressHoldMs: Math.floor(clampNumber(Number(e.target.value), 1000, 90000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.outputErrorHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.outputErrorHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={120000}
                  step={500}
                  value={dynamicSrc.outputErrorHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      outputErrorHoldMs: Math.floor(clampNumber(Number(e.target.value), 1000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void applyDynamicSrc()} disabled={busy}>
                {t('common.action.apply')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => void refresh()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
