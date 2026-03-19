import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import {
  broadcastDataUpdate,
  broadcastSignal,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton, PmpChoiceButton } from '../primitives';

const telemetry = getTelemetryLogger('settings', 'AudioComponentsSettingsPanel');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invokeAudioComponents<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  event: string
): Promise<T> {
  return invokeWithTelemetry<T>(command, args, {
    moduleId: 'settings',
    component: 'AudioComponentsSettingsPanel',
    event,
  });
}

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

  const describeAudioInput = useCallback(
    (inputId: string): string => {
      switch (inputId) {
        case 'sacd':
          return t('settings.audioComponents.audioInput.option.sacd');
        case 'symphonia':
          return t('settings.audioComponents.audioInput.option.symphonia');
        case 'rodio':
          return t('settings.audioComponents.audioInput.option.rodio');
        default:
          return inputId;
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
      const payload = await invokeAudioComponents<unknown>(
        'native_audio_get_audio_components_state',
        undefined,
        'settings.audio-components.state.read'
      );
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');
      setSelectedInput(parsed.preferredInputId ?? '');
    } catch (err) {
      telemetry.warn('settings.audio-components.state.read.failed', {
        message: getErrorMessage(err),
      });
      setError(err instanceof Error ? err.message : String(err));
    }

    try {
      const backends = await invokeAudioComponents<string[]>(
        'native_audio_list_output_backends',
        undefined,
        'settings.audio-components.output-backends.list'
      );
      setOutputBackends(backends);
    } catch (err) {
      telemetry.warn('settings.audio-components.output-backends.list.failed', {
        message: getErrorMessage(err),
      });
      setError(err instanceof Error ? err.message : String(err));
    }

    try {
      const inputs = await invokeAudioComponents<string[]>(
        'native_audio_list_audio_inputs',
        undefined,
        'settings.audio-components.audio-inputs.list'
      );
      setAudioInputs(inputs);
    } catch (err) {
      telemetry.warn('settings.audio-components.audio-inputs.list.failed', {
        message: getErrorMessage(err),
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend]);

  useEffect(() => {
    if (!canUseBackend) return;
    void refreshComponents();
  }, [canUseBackend, refreshComponents]);

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

    try {
      const payload = await invokeAudioComponents<unknown>(
        'native_audio_select_output_backend',
        { backendId },
        'settings.audio-components.output-backend.select'
      );
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
        await broadcastSignal(TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelectedBackend(componentsState.outputBackendId ?? '');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    void refreshComponents();
  }, [canUseBackend, componentsState.outputBackendId, refreshComponents, selectedBackend]);

  const handleRefreshOutputRoute = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      await invokeAudioComponents(
        'native_audio_select_device',
        { deviceId: null, deviceName: null },
        'settings.audio-components.output-device.refresh'
      );
      await broadcastSignal(TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED);
      await refreshComponents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend, refreshComponents]);

  const handleOpenAsioControlPanel = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const deviceName = componentsState.outputDevice ?? null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      await invokeAudioComponents(
        'native_audio_open_asio_control_panel',
        { deviceName },
        'settings.audio-components.asio-control-panel.open'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canUseBackend, componentsState.outputDevice]);

  const handleApplyAudioInput = useCallback(async () => {
    if (!canUseBackend) return;
    if (busyRef.current) return;

    const inputId = selectedInput.length > 0 ? selectedInput : null;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      const payload = await invokeAudioComponents<unknown>(
        'native_audio_select_audio_input',
        { inputId },
        'settings.audio-components.audio-input.select'
      );
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
                    <PmpChoiceButton
                      key={backend.id}
                      type="button"
                      className="settings-choice-btn"
                      active={isSelected}
                      disabled={busy || backend.disabled}
                      onClick={() => setSelectedBackend(backend.id)}
                      title={backend.desc}
                    >
                      {backend.title}
                    </PmpChoiceButton>
                  );
                })}
              </div>
            </div>

            {selectedBackendOption?.desc && <p className="settings-card-note">{selectedBackendOption.desc}</p>}
            {selectedBackendOption?.warning && <p className="settings-card-note">{selectedBackendOption.warning}</p>}

            <div className="settings-section-controls">
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void refreshComponents()}
                disabled={busy}
              >
                {t('common.action.refresh')}
              </PmpButton>
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleApplyOutputBackend()}
                disabled={busy || Boolean(selectedBackendOption?.disabled)}
              >
                {t('common.action.apply')}
              </PmpButton>
            </div>
          </>
        )}
      </div>

      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />
        <div className="settings-param-head">
          <p className="settings-param-eyebrow">OUTPUT DEVICE</p>
          <h3 className="settings-param-title">{t('settings.audioComponents.outputDevice.title')}</h3>
          <p className="settings-param-subtitle">System Output Route</p>
        </div>

        {!canUseBackend ? (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        ) : (
          <>
            <p className="settings-card-note">
              {t('settings.audioComponents.outputDevice.current', {
                device: componentsState.outputDevice ?? t('settings.audioComponents.outputDevice.default'),
                sampleRate: componentsState.outputSampleRate ? `${componentsState.outputSampleRate} Hz` : '\u2014',
              })}
            </p>
            <p className="settings-card-note">{t('settings.audioComponents.outputDevice.desc')}</p>

            <div className="settings-section-controls">
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleRefreshOutputRoute()}
                disabled={busy}
              >
                {t('common.action.refresh')}
              </PmpButton>
              {hasAsioFeature && (selectedBackend === 'asio' || componentsState.outputBackendId === 'asio') && (
                <PmpButton
                  type="button"
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleOpenAsioControlPanel()}
                  disabled={busy}
                >
                  {t('settings.audioComponents.outputDevice.action.openAsioControlPanel')}
                </PmpButton>
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
                      {describeAudioInput(inputId)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="settings-card-note">{t('settings.audioComponents.audioInput.desc')}</p>
            <p className="settings-card-note">
              {t('settings.audioComponents.audioInput.preferred', {
                id: componentsState.preferredInputId
                  ? describeAudioInput(componentsState.preferredInputId)
                  : t('settings.audioComponents.audioInput.auto'),
              })}
            </p>
            <p className="settings-card-note">
              {t('settings.audioComponents.audioInput.active', {
                id: componentsState.activeInputId
                  ? describeAudioInput(componentsState.activeInputId)
                  : t('settings.audioComponents.audioInput.active.none'),
              })}
            </p>

            <div className="settings-section-controls">
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void refreshComponents()}
                disabled={busy}
              >
                {t('common.action.refresh')}
              </PmpButton>
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleApplyAudioInput()}
                disabled={busy}
              >
                {t('common.action.apply')}
              </PmpButton>
            </div>
          </>
        )}
      </div>

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
