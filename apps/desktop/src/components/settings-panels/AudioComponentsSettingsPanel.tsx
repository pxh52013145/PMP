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
  outputDeviceId: string | null;
  outputDevice: string | null;
  outputSampleRate: number | null;
  preferredInputId: string | null;
  activeInputId: string | null;
};

type NativeAudioOutputDevice = {
  id: string;
  name: string;
  isDefault: boolean;
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
  const outputDeviceId = typeof record?.outputDeviceId === 'string' ? record.outputDeviceId : null;
  const outputDevice = typeof record?.outputDevice === 'string' ? record.outputDevice : null;
  const outputSampleRate = typeof record?.outputSampleRate === 'number' ? record.outputSampleRate : null;
  const preferredInputId = typeof record?.preferredInputId === 'string' ? record.preferredInputId : null;
  const activeInputId = typeof record?.activeInputId === 'string' ? record.activeInputId : null;

  return { outputBackendId, outputDeviceId, outputDevice, outputSampleRate, preferredInputId, activeInputId };
}

function parseNativeAudioOutputDevices(payload: unknown): NativeAudioOutputDevice[] {
  if (!Array.isArray(payload)) return [];

  const parsed: NativeAudioOutputDevice[] = [];
  const seen = new Set<string>();
  for (const item of payload) {
    const record = asRecord(item);
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    if (!id || !name) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    parsed.push({
      id,
      name,
      isDefault: typeof record?.isDefault === 'boolean' ? record.isDefault : false,
    });
  }

  parsed.sort((a, b) => a.name.localeCompare(b.name));
  return parsed;
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
    outputDeviceId: null,
    outputDevice: null,
    outputSampleRate: null,
    preferredInputId: null,
    activeInputId: null,
  });
  const [outputBackends, setOutputBackends] = useState<string[]>([]);
  const [selectedBackend, setSelectedBackend] = useState('');
  const [outputDevices, setOutputDevices] = useState<NativeAudioOutputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
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
        case 'wasapi-shared-raw':
          return {
            id: backendId,
            title: t('settings.audioComponents.outputBackend.option.wasapiSharedRaw.title'),
            desc: t('settings.audioComponents.outputBackend.option.wasapiSharedRaw.desc'),
            warning: t('settings.audioComponents.outputBackend.option.wasapiSharedRaw.warning'),
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

    const hasAsio = seen.has('asio') || activeBackendId === 'asio';
    if (!hasAsio) {
      ids.push('asio');
    }

    return ids.map((id) => {
      const base = describeOutputBackend(id);
      if (id !== 'asio') return base;
      if (hasAsio) return base;
      return {
        ...base,
        disabled: true,
        warning: t('settings.audioComponents.outputBackend.option.asio.warningUnavailable'),
      };
    });
  }, [componentsState.outputBackendId, describeOutputBackend, outputBackends, t]);

  const selectedBackendOption = useMemo(() => {
    if (!selectedBackend) return null;
    return describeOutputBackend(selectedBackend);
  }, [describeOutputBackend, selectedBackend]);

  const hasAsioFeature = useMemo(() => {
    return outputBackends.includes('asio') || componentsState.outputBackendId === 'asio';
  }, [componentsState.outputBackendId, outputBackends]);

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
      setSelectedDeviceId(parsed.outputDeviceId ?? '');
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
      const payload = await invoke<unknown>('native_audio_list_devices_v2');
      const parsed = parseNativeAudioOutputDevices(payload);
      setOutputDevices(parsed);
      if (selectedDeviceId.length === 0 && componentsState.outputDevice) {
        const current = parsed.find((device) => device.name === componentsState.outputDevice);
        if (current) setSelectedDeviceId(current.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend, componentsState.outputDevice, selectedDeviceId]);

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
        setSelectedDeviceId('');
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

    const deviceId = selectedDeviceId.length > 0 ? selectedDeviceId : null;
    const selected = deviceId ? outputDevices.find((device) => device.id === deviceId) ?? null : null;
    const deviceName = deviceId ? selected?.name ?? null : null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    let needsRefreshComponents = false;
    try {
      await invoke('native_audio_select_device', { deviceId, deviceName });
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
        deviceId && selected ? { id: deviceId, name: selected.name } : null,
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
  }, [canUseBackend, outputDevices, refreshComponents, selectedDeviceId]);

  const handleOpenAsioControlPanel = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const selected = selectedDeviceId.length > 0 ? outputDevices.find((device) => device.id === selectedDeviceId) ?? null : null;
    const deviceName = componentsState.outputDevice ?? selected?.name ?? null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      await invoke('native_audio_open_asio_control_panel', { deviceName });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend, componentsState.outputDevice, outputDevices, selectedDeviceId]);

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
    <div className="settings-audio-panel">
      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">OUTPUT BACKEND</p>
          <h3 className="settings-param-title">{t('settings.audioComponents.outputBackend.title')}</h3>
          <p className="settings-param-subtitle">Backend Transport & Driver Mode</p>
        </div>

        <p className="settings-card-note">{badge}</p>

        {!canUseBackend ? (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        ) : (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioComponents.outputBackend.select.ariaLabel')}</p>
              </div>
              <div
                className="settings-inline-row-controls"
                role="radiogroup"
                aria-label={t('settings.audioComponents.outputBackend.select.ariaLabel')}
              >
                {outputBackendOptions.map((backend) => {
                  const isSelected = selectedBackend === backend.id;
                  return (
                    <button
                      key={backend.id}
                      type="button"
                      className="settings-choice-btn"
                      data-active={isSelected}
                      disabled={busy || backend.disabled}
                      onClick={() => setSelectedBackend(backend.id)}
                      title={backend.desc}
                    >
                      {backend.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedBackendOption?.desc && <p className="settings-card-note">{selectedBackendOption.desc}</p>}
            {selectedBackendOption?.warning && <p className="settings-card-note">{selectedBackendOption.warning}</p>}

            <div className="settings-section-controls">
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
          </>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">OUTPUT DEVICE</p>
          <h3 className="settings-param-title">{t('settings.audioComponents.outputDevice.title')}</h3>
          <p className="settings-param-subtitle">Target Device & Hardware Route</p>
        </div>

        {!canUseBackend ? (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        ) : (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioComponents.outputDevice.select.ariaLabel')}</p>
              </div>
              <div className="settings-inline-row-controls settings-section-controls--stretch">
                <select
                  className="settings-select"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  aria-label={t('settings.audioComponents.outputDevice.select.ariaLabel')}
                  disabled={busy}
                >
                  <option value="">{t('settings.audioComponents.outputDevice.default')}</option>
                  {outputDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="settings-card-note">
              {t('settings.audioComponents.outputDevice.current', {
                device: componentsState.outputDevice ?? t('settings.audioComponents.outputDevice.default'),
                sampleRate: componentsState.outputSampleRate ? `${componentsState.outputSampleRate} Hz` : '\u2014',
              })}
            </p>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void refreshDevices()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => void handleApplyDevice()} disabled={busy}>
                {t('common.action.apply')}
              </button>
              {hasAsioFeature && (selectedBackend === 'asio' || componentsState.outputBackendId === 'asio') && (
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => void handleOpenAsioControlPanel()}
                  disabled={busy}
                >
                  {t('settings.audioComponents.outputDevice.action.openAsioControlPanel')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">INPUT DECODER</p>
          <h3 className="settings-param-title">{t('settings.audioComponents.audioInput.title')}</h3>
          <p className="settings-param-subtitle">File Decoder & Input Path</p>
        </div>

        {!canUseBackend ? (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        ) : (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioComponents.audioInput.select.ariaLabel')}</p>
              </div>
              <div className="settings-inline-row-controls settings-section-controls--stretch">
                <select
                  className="settings-select"
                  value={selectedInput}
                  onChange={(e) => setSelectedInput(e.target.value)}
                  aria-label={t('settings.audioComponents.audioInput.select.ariaLabel')}
                  disabled={busy}
                >
                  <option value="">{t('settings.audioComponents.audioInput.auto')}</option>
                  {audioInputs.map((inputId) => (
                    <option key={inputId} value={inputId}>
                      {inputId}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="settings-card-note">{t('settings.audioComponents.audioInput.desc')}</p>
            <p className="settings-card-note">
              {t('settings.audioComponents.audioInput.preferred', {
                id: componentsState.preferredInputId ?? t('settings.audioComponents.audioInput.auto'),
              })}
            </p>
            <p className="settings-card-note">
              {t('settings.audioComponents.audioInput.active', {
                id: componentsState.activeInputId ?? t('settings.audioComponents.audioInput.active.none'),
              })}
            </p>

            <div className="settings-section-controls">
              <button type="button" className="settings-action-btn" onClick={() => void refreshComponents()} disabled={busy}>
                {t('common.action.refresh')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => void handleApplyAudioInput()} disabled={busy}>
                {t('common.action.apply')}
              </button>
            </div>
          </>
        )}
      </div>

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
