import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton, PmpChoiceButton, PmpSegmented } from '../primitives';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

type StreamingBufferSettings = {
  startOrSeekSeconds: number | null;
  crossfadeSeconds: number | null;
  decodeMode: 'streaming' | 'full-track';
  interactiveProfile: 'fast' | 'balanced' | 'stable';
};

type NativeAudioComponentsState = {
  outputBackendId: string | null;
  outputSampleRate: number | null;
};

function clampSeconds(value: number, maxSeconds = 10): number {
  const safe = typeof value === 'number' && isFinite(value) ? value : 0;
  return Math.max(0, Math.min(maxSeconds, safe));
}

function parseSecondsOrNull(value: unknown): number | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return clampSeconds(value);
}

function parseDecodeMode(value: unknown): 'streaming' | 'full-track' | null {
  if (typeof value !== 'string') return null;
  if (value === 'streaming' || value === 'full-track') return value;
  return null;
}

function parseInteractiveProfile(value: unknown): 'fast' | 'balanced' | 'stable' {
  if (value === 'fast' || value === 'balanced' || value === 'stable') return value;
  return 'balanced';
}

function parseStreamingBufferSettings(payload: unknown): StreamingBufferSettings {
  const record = asRecord(payload);
  return {
    startOrSeekSeconds: parseSecondsOrNull(record?.startOrSeekSeconds),
    crossfadeSeconds: parseSecondsOrNull(record?.crossfadeSeconds),
    decodeMode: parseDecodeMode(record?.decodeMode) ?? 'streaming',
    interactiveProfile: parseInteractiveProfile(record?.interactiveProfile),
  };
}

function parseNativeAudioComponentsState(payload: unknown): NativeAudioComponentsState {
  const record = asRecord(payload);
  const outputBackendId = typeof record?.outputBackendId === 'string' ? record.outputBackendId : null;
  const outputSampleRate = typeof record?.outputSampleRate === 'number' ? record.outputSampleRate : null;
  return { outputBackendId, outputSampleRate };
}

function estimateMiB(seconds: number, sampleRate: number, channels: number): number {
  const bytes = seconds * sampleRate * channels * 4;
  return bytes / (1024 * 1024);
}

export function AudioBufferSettingsPanel() {
  const t = useT();
  const { isNativeAvailable } = useAudioEngine();
  const isTauri = isTauriRuntime();
  const canUseBackend = isTauri && isNativeAvailable;

  const [componentsState, setComponentsState] = useState<NativeAudioComponentsState>({
    outputBackendId: null,
    outputSampleRate: null,
  });
  const [underrunEvents, setUnderrunEvents] = useState<number | null>(null);
  const [underrunFrames, setUnderrunFrames] = useState<number | null>(null);
  const [settings, setSettings] = useState<StreamingBufferSettings>(() =>
    parseStreamingBufferSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS))
  );
  const [error, setError] = useState<string | null>(null);

  const applyTimer = useRef<number | null>(null);
  const pendingSettingsRef = useRef<StreamingBufferSettings>(settings);
  pendingSettingsRef.current = settings;

  const isWasapiExclusive = componentsState.outputBackendId === 'wasapi-exclusive';
  const defaults = useMemo(
    () => ({
      // Keep "Auto" startup buffer low for instant click-to-play; runtime policy will still
      // raise the buffer under underruns/background/protection windows.
      startOrSeekSeconds: isWasapiExclusive ? 0.3 : 0.35,
      crossfadeSeconds: isWasapiExclusive ? 1 : 0.5,
    }),
    [isWasapiExclusive]
  );

  const effectiveStartOrSeekSeconds = settings.startOrSeekSeconds ?? defaults.startOrSeekSeconds;
  const effectiveCrossfadeSeconds = settings.crossfadeSeconds ?? defaults.crossfadeSeconds;

  const badge = useMemo(
    () =>
      t('settings.audioBuffer.badge', {
        start: effectiveStartOrSeekSeconds.toFixed(2),
        crossfade: effectiveCrossfadeSeconds.toFixed(2),
      }),
    [effectiveCrossfadeSeconds, effectiveStartOrSeekSeconds, t]
  );

  const refreshComponentsState = useCallback(async () => {
    if (!canUseBackend) return;
    try {
      const payload = await invoke<unknown>('native_audio_get_audio_components_state');
      setComponentsState(parseNativeAudioComponentsState(payload));
    } catch {
      // ignore
    }
  }, [canUseBackend]);

  useEffect(() => {
    void refreshComponentsState();
  }, [refreshComponentsState]);

  useEffect(() => {
    if (!canUseBackend) return;

    let unlisten: UnlistenFn | null = null;
    void listen('native_audio_state', (event) => {
      const payload = event.payload as Record<string, unknown> | null | undefined;
      const next = payload && 'state' in payload ? (payload.state as Record<string, unknown>) : payload;
      if (!next) return;

      const events = typeof next.underrunEvents === 'number' ? next.underrunEvents : null;
      const frames = typeof next.underrunFrames === 'number' ? next.underrunFrames : null;
      if (events !== null) setUnderrunEvents(events);
      if (frames !== null) setUnderrunFrames(frames);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [canUseBackend]);

  const scheduleApply = useCallback(
    (next: StreamingBufferSettings) => {
      setSettings(next);
      pendingSettingsRef.current = next;
      setError(null);

      if (applyTimer.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(applyTimer.current);
      }

      if (typeof window === 'undefined') return;
      applyTimer.current = window.setTimeout(() => {
        const latest = pendingSettingsRef.current;
        const persisted = { ...latest, userSetDecodeMode: true };

        void broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
          persisted,
          TAURI_EVENTS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED
        );

        if (!canUseBackend) return;
        void invoke('native_audio_set_streaming_buffer_settings', {
          startOrSeekSeconds: latest.startOrSeekSeconds,
          crossfadeSeconds: latest.crossfadeSeconds,
          decodeMode: latest.decodeMode,
          interactiveProfile: latest.interactiveProfile,
        }).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      }, 250);
    },
    [canUseBackend]
  );

  const handleStartOrSeekMode = useCallback(
    (mode: 'auto' | 'custom') => {
      if (mode === 'auto') {
        scheduleApply({ ...settings, startOrSeekSeconds: null });
        return;
      }
      scheduleApply({
        ...settings,
        startOrSeekSeconds: clampSeconds(settings.startOrSeekSeconds ?? defaults.startOrSeekSeconds),
      });
    },
    [defaults.startOrSeekSeconds, scheduleApply, settings]
  );

  const handleCrossfadeMode = useCallback(
    (mode: 'auto' | 'custom') => {
      if (mode === 'auto') {
        scheduleApply({ ...settings, crossfadeSeconds: null });
        return;
      }
      scheduleApply({
        ...settings,
        crossfadeSeconds: clampSeconds(settings.crossfadeSeconds ?? defaults.crossfadeSeconds),
      });
    },
    [defaults.crossfadeSeconds, scheduleApply, settings]
  );

  const handleStartOrSeekSeconds = useCallback(
    (value: number) => {
      scheduleApply({ ...settings, startOrSeekSeconds: clampSeconds(value) });
    },
    [scheduleApply, settings]
  );

  const handleCrossfadeSeconds = useCallback(
    (value: number) => {
      scheduleApply({ ...settings, crossfadeSeconds: clampSeconds(value) });
    },
    [scheduleApply, settings]
  );

  const handleReset = useCallback(() => {
    scheduleApply({
      startOrSeekSeconds: null,
      crossfadeSeconds: null,
      decodeMode: 'streaming',
      interactiveProfile: 'balanced',
    });
  }, [scheduleApply]);

  const handleDecodeModeChange = useCallback(
    (mode: 'streaming' | 'full-track') => {
      scheduleApply({ ...settings, decodeMode: mode });
    },
    [scheduleApply, settings]
  );

  const handleInteractiveProfileChange = useCallback(
    (profile: 'fast' | 'balanced' | 'stable') => {
      scheduleApply({ ...settings, interactiveProfile: profile });
    },
    [scheduleApply, settings]
  );

  const sampleRate = componentsState.outputSampleRate && isFinite(componentsState.outputSampleRate) ? componentsState.outputSampleRate : 48_000;
  const channels = 2;
  const estimatedStartMiB = estimateMiB(effectiveStartOrSeekSeconds, sampleRate, channels);
  const estimatedCrossfadeMiB = estimateMiB(effectiveCrossfadeSeconds, sampleRate, channels);

  return (
    <div className="settings-audio-panel">
      <div className="settings-audio-block">
        {!canUseBackend ? (
          <p className="settings-card-note">{t('settings.audioBuffer.note.requireNative')}</p>
        ) : (
          <>
            <div className="settings-rows settings-rows--audio-preprocess">
              <div className="settings-row settings-row--audio-preprocess">
                <div className="settings-row-left">
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.section.decode.title')}</div>
                  <div className="settings-row-title settings-row-title--audio-preprocess">
                    {t('settings.audioBuffer.decodeMode.label')}
                  </div>
                  <div className="settings-row-desc">{t('settings.audioBuffer.decodeMode.desc')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.decodeMode.range')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.section.decode.desc')}</div>
                  {settings.decodeMode === 'full-track' && (
                    <div className="settings-row-desc settings-row-meta settings-row-meta--warn">
                      {t('settings.audioBuffer.decodeMode.warning')}
                    </div>
                  )}
                </div>
                <div className="settings-row-right">
                  <PmpSegmented
                    className="settings-toggle settings-toggle--compact settings-toggle--audio-preprocess"
                    surfaceId="primitive.segmented.toggle"
                  >
                    <PmpChoiceButton
                      type="button"
                      active={settings.decodeMode === 'streaming'}
                      onClick={() => handleDecodeModeChange('streaming')}
                    >
                      {t('settings.audioBuffer.decodeMode.streaming')}
                    </PmpChoiceButton>
                    <PmpChoiceButton
                      type="button"
                      active={settings.decodeMode === 'full-track'}
                      onClick={() => handleDecodeModeChange('full-track')}
                    >
                      {t('settings.audioBuffer.decodeMode.fullTrack')}
                    </PmpChoiceButton>
                  </PmpSegmented>
                </div>
              </div>

              <div className="settings-row settings-row--audio-preprocess">
                <div className="settings-row-left">
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.section.interactive.title')}</div>
                  <div className="settings-row-title settings-row-title--audio-preprocess">
                    {t('settings.audioBuffer.interactiveProfile.label')}
                  </div>
                  <div className="settings-row-desc">{t('settings.audioBuffer.interactiveProfile.desc')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.interactiveProfile.fast')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.interactiveProfile.balanced')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.interactiveProfile.stable')}</div>
                </div>
                <div className="settings-row-right">
                  <PmpSegmented
                    className="settings-toggle settings-toggle--compact settings-toggle--audio-preprocess"
                    surfaceId="primitive.segmented.toggle"
                  >
                    <PmpChoiceButton
                      type="button"
                      active={settings.interactiveProfile === 'fast'}
                      onClick={() => handleInteractiveProfileChange('fast')}
                    >
                      {t('settings.audioBuffer.interactiveProfile.mode.fast')}
                    </PmpChoiceButton>
                    <PmpChoiceButton
                      type="button"
                      active={settings.interactiveProfile === 'balanced'}
                      onClick={() => handleInteractiveProfileChange('balanced')}
                    >
                      {t('settings.audioBuffer.interactiveProfile.mode.balanced')}
                    </PmpChoiceButton>
                    <PmpChoiceButton
                      type="button"
                      active={settings.interactiveProfile === 'stable'}
                      onClick={() => handleInteractiveProfileChange('stable')}
                    >
                      {t('settings.audioBuffer.interactiveProfile.mode.stable')}
                    </PmpChoiceButton>
                  </PmpSegmented>
                </div>
              </div>

              <div className="settings-row settings-row--audio-preprocess">
                <div className="settings-row-left">
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.section.prebuffer.title')}</div>
                  <div className="settings-row-title settings-row-title--audio-preprocess">
                    {t('settings.audioBuffer.startOrSeek.label')}
                  </div>
                  <div className="settings-row-desc">{t('settings.audioBuffer.startOrSeek.desc')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.startOrSeek.range')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.startOrSeek.policyRange')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.section.prebuffer.desc')}</div>
                  <div className="settings-row-desc settings-row-meta">{badge}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.note.thresholdNotCap')}</div>
                </div>
                <div className="settings-row-right">
                  <div className="settings-inline-row-controls settings-inline-row-controls--audio-preprocess">
                    <PmpChoiceButton
                      type="button"
                      className="settings-choice-btn"
                      active={settings.startOrSeekSeconds === null}
                      onClick={() => handleStartOrSeekMode('auto')}
                    >
                      {t('settings.audioBuffer.mode.auto')}
                    </PmpChoiceButton>
                    <PmpChoiceButton
                      type="button"
                      className="settings-choice-btn"
                      active={settings.startOrSeekSeconds !== null}
                      onClick={() => handleStartOrSeekMode('custom')}
                    >
                      {t('settings.audioBuffer.mode.custom')}
                    </PmpChoiceButton>
                    <input
                      className="settings-number-input"
                      type="number"
                      min={0}
                      max={10}
                      step={0.05}
                      value={effectiveStartOrSeekSeconds}
                      onChange={(e) => handleStartOrSeekSeconds(Number(e.target.value))}
                      disabled={settings.startOrSeekSeconds === null}
                    />
                  </div>
                </div>
              </div>

              <div className="settings-row settings-row--audio-preprocess">
                <div className="settings-row-left">
                  <div className="settings-row-title settings-row-title--audio-preprocess">
                    {t('settings.audioBuffer.crossfade.label')}
                  </div>
                  <div className="settings-row-desc">{t('settings.audioBuffer.crossfade.desc')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.crossfade.range')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.crossfade.policyRange')}</div>
                  <div className="settings-row-desc settings-row-meta">{t('settings.audioBuffer.note.metricsLocation')}</div>
                </div>
                <div className="settings-row-right">
                  <div className="settings-inline-row-controls settings-inline-row-controls--audio-preprocess">
                    <PmpChoiceButton
                      type="button"
                      className="settings-choice-btn"
                      active={settings.crossfadeSeconds === null}
                      onClick={() => handleCrossfadeMode('auto')}
                    >
                      {t('settings.audioBuffer.mode.auto')}
                    </PmpChoiceButton>
                    <PmpChoiceButton
                      type="button"
                      className="settings-choice-btn"
                      active={settings.crossfadeSeconds !== null}
                      onClick={() => handleCrossfadeMode('custom')}
                    >
                      {t('settings.audioBuffer.mode.custom')}
                    </PmpChoiceButton>
                    <input
                      className="settings-number-input"
                      type="number"
                      min={0}
                      max={10}
                      step={0.05}
                      value={effectiveCrossfadeSeconds}
                      onChange={(e) => handleCrossfadeSeconds(Number(e.target.value))}
                      disabled={settings.crossfadeSeconds === null}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section-controls">
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void refreshComponentsState()}
              >
                {t('common.action.refresh')}
              </PmpButton>
              <PmpButton type="button" className="settings-action-btn" variant="default" onClick={handleReset}>
                {t('common.action.reset')}
              </PmpButton>
            </div>

            <p className="settings-card-note">
              {t('settings.audioBuffer.note.defaults', {
                start: defaults.startOrSeekSeconds.toFixed(2),
                crossfade: defaults.crossfadeSeconds.toFixed(2),
                backendId: componentsState.outputBackendId ?? '',
              })}
            </p>
            <p className="settings-card-note">
              {t('settings.audioBuffer.note.estimate', {
                sampleRate: String(sampleRate),
                channels: String(channels),
                startMiB: estimatedStartMiB.toFixed(2),
                crossfadeMiB: estimatedCrossfadeMiB.toFixed(2),
              })}
            </p>
            {underrunEvents !== null && underrunFrames !== null && (
              <p className="settings-card-note">
                {t('settings.audioBuffer.note.underrun', {
                  events: String(underrunEvents),
                  frames: String(underrunFrames),
                })}
              </p>
            )}
          </>
        )}

        {error && <div className="settings-inline-error">{error}</div>}
      </div>
    </div>
  );
}
