import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

type NativeAudioComponentsState = {
  outputBackendId: string | null;
  outputDevice: string | null;
  outputSampleRate: number | null;
  preferredInputId: string | null;
  activeInputId: string | null;
};

type OutputBackendOption = {
  id: string;
  title: string;
  desc: string;
  warning?: string;
  disabled?: boolean;
};

function parseNativeAudioComponentsState(payload: unknown): NativeAudioComponentsState {
  const record = asRecord(payload);
  const outputBackendId = typeof record?.outputBackendId === 'string' ? record.outputBackendId : null;
  const outputDevice = typeof record?.outputDevice === 'string' ? record.outputDevice : null;
  const outputSampleRate = typeof record?.outputSampleRate === 'number' ? record.outputSampleRate : null;
  const preferredInputId = typeof record?.preferredInputId === 'string' ? record.preferredInputId : null;
  const activeInputId = typeof record?.activeInputId === 'string' ? record.activeInputId : null;

  return { outputBackendId, outputDevice, outputSampleRate, preferredInputId, activeInputId };
}

export function AudioComponentsSettingsPanel() {
  const t = useT();
  const { isNativeAvailable } = useAudioEngine();
  const isTauri = isTauriRuntime();
  const canUseBackend = isTauri && isNativeAvailable;

  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [componentsState, setComponentsState] = useState<NativeAudioComponentsState>({
    outputBackendId: null,
    outputDevice: null,
    outputSampleRate: null,
    preferredInputId: null,
    activeInputId: null,
  });
  const [outputBackends, setOutputBackends] = useState<string[]>([]);
  const [selectedBackend, setSelectedBackend] = useState('');
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [selectedInput, setSelectedInput] = useState('');

  const describeOutputBackend = useCallback(
    (backendId: string): OutputBackendOption => {
      switch (backendId) {
        case 'rodio-cpal':
          return {
            id: backendId,
            title: t('settings.audioComponents.outputBackend.option.rodioCpal.title'),
            desc: t('settings.audioComponents.outputBackend.option.rodioCpal.desc'),
          };
        case 'wasapi':
          return {
            id: backendId,
            title: t('settings.audioComponents.outputBackend.option.wasapi.title'),
            desc: t('settings.audioComponents.outputBackend.option.wasapi.desc'),
          };
        case 'wasapi-exclusive':
          return {
            id: backendId,
            title: t('settings.audioComponents.outputBackend.option.wasapiExclusive.title'),
            desc: t('settings.audioComponents.outputBackend.option.wasapiExclusive.desc'),
            warning: t('settings.audioComponents.outputBackend.option.wasapiExclusive.warning'),
          };
        case 'asio':
          return {
            id: backendId,
            title: t('settings.audioComponents.outputBackend.option.asio.title'),
            desc: t('settings.audioComponents.outputBackend.option.asio.desc'),
            warning: t('settings.audioComponents.outputBackend.option.asio.warning'),
            disabled: true,
          };
        default:
          return {
            id: backendId,
            title: backendId,
            desc: t('settings.audioComponents.outputBackend.option.unknown', { id: backendId }),
          };
      }
    },
    [t]
  );

  const outputBackendOptions = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const backendId of outputBackends) {
      if (seen.has(backendId)) continue;
      seen.add(backendId);
      ids.push(backendId);
    }

    const activeBackendId = componentsState.outputBackendId;
    if (activeBackendId && !seen.has(activeBackendId)) {
      ids.unshift(activeBackendId);
    }

    return ids.map((id) => describeOutputBackend(id));
  }, [componentsState.outputBackendId, describeOutputBackend, outputBackends]);

  const selectedBackendOption = useMemo(() => {
    if (!selectedBackend) return null;
    return describeOutputBackend(selectedBackend);
  }, [describeOutputBackend, selectedBackend]);

  const refreshComponents = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      const payload = await invoke<unknown>('native_audio_get_audio_components_state');
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');
      setSelectedInput(parsed.preferredInputId ?? '');
      setSelectedDevice(parsed.outputDevice ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    try {
      const backends = await invoke<string[]>('native_audio_list_output_backends');
      setOutputBackends(backends);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    try {
      const inputs = await invoke<string[]>('native_audio_list_audio_inputs');
      setAudioInputs(inputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend]);

  const refreshDevices = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const devices = await invoke<string[]>('native_audio_list_devices');
      setOutputDevices(devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend]);

  useEffect(() => {
    if (!canUseBackend) return;
    void refreshComponents().then(() => refreshDevices());
  }, [canUseBackend, refreshComponents, refreshDevices]);

  const badge = useMemo(() => {
    if (!canUseBackend) return t('settings.audioComponents.badge.unavailable');
    const backend = componentsState.outputBackendId
      ? describeOutputBackend(componentsState.outputBackendId).title
      : t('settings.audioComponents.outputBackend.default');
    const device = componentsState.outputDevice ?? t('settings.audioComponents.outputDevice.default');
    return `${backend} \u00b7 ${device}`;
  }, [canUseBackend, componentsState.outputBackendId, componentsState.outputDevice, describeOutputBackend, t]);

  const handleApplyOutputBackend = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const backendId = selectedBackend.length > 0 ? selectedBackend : null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    let needsRefreshDevices = false;
    try {
      const payload = await invoke<unknown>('native_audio_select_output_backend', { backendId });
      const parsed = parseNativeAudioComponentsState(payload);
      const prevBackend = componentsState.outputBackendId;
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');

      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND,
        parsed.outputBackendId,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED
      );

      if (prevBackend && prevBackend !== parsed.outputBackendId) {
        setSelectedDevice('');
        setOutputDevices([]);
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
          null,
          TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
        );
      }

      needsRefreshDevices = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelectedBackend(componentsState.outputBackendId ?? '');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (needsRefreshDevices) {
      void refreshDevices();
    }
  }, [canUseBackend, componentsState.outputBackendId, refreshDevices, selectedBackend]);

  const handleApplyDevice = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const deviceName = selectedDevice.length > 0 ? selectedDevice : null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    let needsRefreshComponents = false;
    try {
      await invoke('native_audio_select_device', { deviceName });
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
        deviceName,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
      );
      needsRefreshComponents = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (needsRefreshComponents) {
      void refreshComponents();
    }
  }, [canUseBackend, refreshComponents, selectedDevice]);

  const handleApplyAudioInput = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const inputId = selectedInput.length > 0 ? selectedInput : null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      const payload = await invoke<unknown>('native_audio_select_audio_input', { inputId });
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedInput(parsed.preferredInputId ?? '');
      await broadcastDataUpdate(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID, inputId, TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend, selectedInput]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.audioComponents.title')}</p>
          <p className="settings-card-desc">{t('settings.audioComponents.desc')}</p>
        </div>
        <span className="settings-card-badge">{badge}</span>
      </div>

      {!canUseBackend && <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>}

      {canUseBackend && (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'rgba(255, 255, 255, 0.86)' }}>
              {t('settings.audioComponents.outputBackend.title')}
            </p>
            <p className="settings-card-note" style={{ marginTop: 6 }}>
              {t('settings.audioComponents.outputBackend.desc')}
            </p>

            <fieldset
              style={{ marginTop: 12, border: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
              aria-label={t('settings.audioComponents.outputBackend.select.ariaLabel')}
            >
              {outputBackendOptions.map((backend) => {
                const isActive = componentsState.outputBackendId === backend.id;
                const isSelected = selectedBackend === backend.id;
                const isDisabled = busy || Boolean(backend.disabled);
                return (
                  <label
                    key={backend.id}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: isSelected ? '1px solid rgba(255, 255, 255, 0.28)' : '1px solid rgba(255, 255, 255, 0.14)',
                      background: isSelected ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                      opacity: backend.disabled ? 0.55 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="audio-output-backend"
                      value={backend.id}
                      checked={isSelected}
                      onChange={() => setSelectedBackend(backend.id)}
                      disabled={isDisabled}
                      style={{ marginTop: 3 }}
                    />

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255, 255, 255, 0.9)' }}>
                          {backend.title}
                        </span>
                        <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.62)', fontFamily: 'monospace' }}>
                          {backend.id}
                        </span>
                        {isActive && (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 12,
                              background: 'rgba(255, 255, 255, 0.08)',
                              color: 'rgba(255, 255, 255, 0.82)',
                            }}
                          >
                            {t('settings.audioComponents.outputBackend.tag.active')}
                          </span>
                        )}
                        {backend.disabled && (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 12,
                              background: 'rgba(255, 184, 0, 0.12)',
                              color: 'rgba(255, 212, 102, 0.95)',
                            }}
                          >
                            {t('settings.audioComponents.outputBackend.tag.wip')}
                          </span>
                        )}
                      </div>
                      <p className="settings-card-note" style={{ marginTop: 6 }}>
                        {backend.desc}
                      </p>
                      {backend.warning && (
                        <p
                          className="settings-card-note"
                          style={{ marginTop: 6, color: 'rgba(255, 212, 102, 0.95)' }}
                        >
                          {backend.warning}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </fieldset>

            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="settings-action-btn" onClick={() => void refreshComponents()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => void handleApplyOutputBackend()}
                disabled={busy || Boolean(selectedBackendOption?.disabled)}
              >
                {t('common.action.apply')}
              </button>
            </div>
          </div>

          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'rgba(255, 255, 255, 0.86)' }}>
              {t('settings.audioComponents.outputDevice.title')}
            </p>
            <p className="settings-card-note" style={{ marginTop: 6 }}>
              {t('settings.audioComponents.outputDevice.desc')}
            </p>

            <p className="settings-card-note" style={{ marginTop: 10 }}>
              {t('settings.audioComponents.outputDevice.current', {
                device: componentsState.outputDevice ?? t('settings.audioComponents.outputDevice.default'),
                sampleRate: componentsState.outputSampleRate ? `${componentsState.outputSampleRate} Hz` : '\u2014',
              })}
            </p>

            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                className="settings-select"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                aria-label={t('settings.audioComponents.outputDevice.select.ariaLabel')}
                disabled={busy}
                style={{ flex: '1 1 320px' }}
              >
                <option value="">{t('settings.audioComponents.outputDevice.default')}</option>
                {outputDevices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button type="button" className="settings-action-btn" onClick={() => void refreshDevices()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => void handleApplyDevice()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </div>

          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'rgba(255, 255, 255, 0.86)' }}>
              {t('settings.audioComponents.audioInput.title')}
            </p>
            <p className="settings-card-note" style={{ marginTop: 6 }}>
              {t('settings.audioComponents.audioInput.desc')}
            </p>

            <p className="settings-card-note" style={{ marginTop: 10 }}>
              {t('settings.audioComponents.audioInput.preferred', {
                id: componentsState.preferredInputId ?? t('settings.audioComponents.audioInput.auto'),
              })}
            </p>
            <p className="settings-card-note" style={{ marginTop: 6 }}>
              {t('settings.audioComponents.audioInput.active', {
                id: componentsState.activeInputId ?? t('settings.audioComponents.audioInput.active.none'),
              })}
            </p>

            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                className="settings-select"
                value={selectedInput}
                onChange={(e) => setSelectedInput(e.target.value)}
                aria-label={t('settings.audioComponents.audioInput.select.ariaLabel')}
                disabled={busy}
                style={{ flex: '1 1 320px' }}
              >
                <option value="">{t('settings.audioComponents.audioInput.auto')}</option>
                {audioInputs.map((inputId) => (
                  <option key={inputId} value={inputId}>
                    {inputId}
                  </option>
                ))}
              </select>
              <button type="button" className="settings-action-btn" onClick={() => void refreshComponents()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => void handleApplyAudioInput()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
