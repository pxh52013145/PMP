import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

type StreamingBufferSettings = {
  startOrSeekSeconds: number | null;
  crossfadeSeconds: number | null;
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

function parseStreamingBufferSettings(payload: unknown): StreamingBufferSettings {
  const record = asRecord(payload);
  return {
    startOrSeekSeconds: parseSecondsOrNull(record?.startOrSeekSeconds),
    crossfadeSeconds: parseSecondsOrNull(record?.crossfadeSeconds),
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
      startOrSeekSeconds: isWasapiExclusive ? 3 : 2,
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

        void broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
          latest,
          TAURI_EVENTS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED
        );

        if (!canUseBackend) return;
        void invoke('native_audio_set_streaming_buffer_settings', {
          startOrSeekSeconds: latest.startOrSeekSeconds,
          crossfadeSeconds: latest.crossfadeSeconds,
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
    scheduleApply({ startOrSeekSeconds: null, crossfadeSeconds: null });
  }, [scheduleApply]);

  const sampleRate = componentsState.outputSampleRate && isFinite(componentsState.outputSampleRate) ? componentsState.outputSampleRate : 48_000;
  const channels = 2;
  const estimatedStartMiB = estimateMiB(effectiveStartOrSeekSeconds, sampleRate, channels);
  const estimatedCrossfadeMiB = estimateMiB(effectiveCrossfadeSeconds, sampleRate, channels);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.audioBuffer.title')}</p>
          <p className="settings-card-desc">{t('settings.audioBuffer.desc')}</p>
        </div>
        <span className="settings-card-badge">{badge}</span>
      </div>

      {!canUseBackend && <p className="settings-card-note">{t('settings.audioBuffer.note.requireNative')}</p>}

      {canUseBackend && (
        <>
          <div style={{ marginTop: 18 }}>
            <p className="settings-card-label" style={{ fontSize: 14 }}>
              {t('settings.audioBuffer.startOrSeek.label')}
            </p>
            <p className="settings-card-desc">{t('settings.audioBuffer.startOrSeek.desc')}</p>

            <div className="settings-toggle" style={{ marginTop: 12 }}>
              <button
                type="button"
                data-active={settings.startOrSeekSeconds === null}
                onClick={() => handleStartOrSeekMode('auto')}
              >
                {t('settings.audioBuffer.mode.auto')}
              </button>
              <button
                type="button"
                data-active={settings.startOrSeekSeconds !== null}
                onClick={() => handleStartOrSeekMode('custom')}
              >
                {t('settings.audioBuffer.mode.custom')}
              </button>
            </div>

            {settings.startOrSeekSeconds !== null && (
              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.05}
                  value={settings.startOrSeekSeconds}
                  onChange={(e) => handleStartOrSeekSeconds(Number(e.target.value))}
                  style={{ flex: '1 1 280px' }}
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.05}
                  value={settings.startOrSeekSeconds}
                  onChange={(e) => handleStartOrSeekSeconds(Number(e.target.value))}
                  style={{ width: 96 }}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <p className="settings-card-label" style={{ fontSize: 14 }}>
              {t('settings.audioBuffer.crossfade.label')}
            </p>
            <p className="settings-card-desc">{t('settings.audioBuffer.crossfade.desc')}</p>

            <div className="settings-toggle" style={{ marginTop: 12 }}>
              <button
                type="button"
                data-active={settings.crossfadeSeconds === null}
                onClick={() => handleCrossfadeMode('auto')}
              >
                {t('settings.audioBuffer.mode.auto')}
              </button>
              <button
                type="button"
                data-active={settings.crossfadeSeconds !== null}
                onClick={() => handleCrossfadeMode('custom')}
              >
                {t('settings.audioBuffer.mode.custom')}
              </button>
            </div>

            {settings.crossfadeSeconds !== null && (
              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.05}
                  value={settings.crossfadeSeconds}
                  onChange={(e) => handleCrossfadeSeconds(Number(e.target.value))}
                  style={{ flex: '1 1 280px' }}
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.05}
                  value={settings.crossfadeSeconds}
                  onChange={(e) => handleCrossfadeSeconds(Number(e.target.value))}
                  style={{ width: 96 }}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="settings-action-btn" onClick={() => void refreshComponentsState()}>
              {t('common.action.refresh')}
            </button>
            <button type="button" className="settings-action-btn" onClick={handleReset}>
              {t('common.action.reset')}
            </button>
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
  );
}
