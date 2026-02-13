import { AudioVisualizer } from '../../magnet/AudioVisualizer';
import type { Dispatch, SetStateAction } from 'react';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type NativeAudioComponentsState = {
  outputBackendId: string | null;
  preferredInputId: string | null;
  activeInputId: string | null;
};

type NativeAudioOutputDevice = {
  id: string;
  name: string;
  isDefault: boolean;
};

type NativeAudioSrcMode = 'source-native' | 'match-output' | 'target-rate';
type NativeAudioSrcBackend = 'rubato' | 'linear-simd';
type NativeAudioSrcPresetId = 'balanced' | 'hi-end' | 'low-latency';

type NativeAudioDynamicSrcSettings = {
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

type NativeAudioMeta = {
  device: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  gainDb: number | null;
  replayGainDb: number | null;
};

type NativeDebugEnginePanelProps = {
  t: TranslateFn;
  componentsState: NativeAudioComponentsState;
  selectedBackend: string;
  outputBackends: string[];
  selectedInput: string;
  audioInputs: string[];
  srcPresetId: NativeAudioSrcPresetId;
  srcMode: NativeAudioSrcMode;
  srcBackend: NativeAudioSrcBackend;
  srcTargetRate: string;
  dynamicSrcSettings: NativeAudioDynamicSrcSettings;
  nativeMeta: NativeAudioMeta;
  selectedDeviceId: string;
  outputDevices: NativeAudioOutputDevice[];
  isPlaying: boolean;
  getFrequencyData: () => Uint8Array | null;
  setSelectedBackend: Dispatch<SetStateAction<string>>;
  setSelectedInput: Dispatch<SetStateAction<string>>;
  setSrcMode: Dispatch<SetStateAction<NativeAudioSrcMode>>;
  setSrcBackend: Dispatch<SetStateAction<NativeAudioSrcBackend>>;
  setSrcTargetRate: Dispatch<SetStateAction<string>>;
  setDynamicSrcSettings: Dispatch<SetStateAction<NativeAudioDynamicSrcSettings>>;
  setSelectedDeviceId: Dispatch<SetStateAction<string>>;
  handleRefreshAudioComponents: () => void | Promise<void>;
  handleApplyOutputBackend: () => void | Promise<void>;
  handleApplyAudioInput: () => void | Promise<void>;
  handleApplySrcPreset: (presetId: NativeAudioSrcPresetId) => void | Promise<void>;
  handleApplySrcPolicy: () => void | Promise<void>;
  applyDynamicSrcAutoSettings: (patch: Partial<NativeAudioDynamicSrcSettings>) => void | Promise<void>;
  handleRefreshDevices: () => void | Promise<void>;
  handleApplyDevice: () => void | Promise<void>;
};

export function NativeDebugEnginePanel({
  t,
  componentsState,
  selectedBackend,
  outputBackends,
  selectedInput,
  audioInputs,
  srcPresetId,
  srcMode,
  srcBackend,
  srcTargetRate,
  dynamicSrcSettings,
  nativeMeta,
  selectedDeviceId,
  outputDevices,
  isPlaying,
  getFrequencyData,
  setSelectedBackend,
  setSelectedInput,
  setSrcMode,
  setSrcBackend,
  setSrcTargetRate,
  setDynamicSrcSettings,
  setSelectedDeviceId,
  handleRefreshAudioComponents,
  handleApplyOutputBackend,
  handleApplyAudioInput,
  handleApplySrcPreset,
  handleApplySrcPolicy,
  applyDynamicSrcAutoSettings,
  handleRefreshDevices,
  handleApplyDevice,
}: NativeDebugEnginePanelProps) {
  return (
    <div className="native-debug-panel-group native-debug-panel-group--engine">

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.outputBackend.title')}</p>
        <p className="device-value">
          {componentsState.outputBackendId ?? t('pages.native-debug.outputBackend.default')}
        </p>
        <p className="device-hint">{t('pages.native-debug.outputBackend.desc')}</p>
      </div>
      <div className="device-controls">
        <select
          value={selectedBackend}
          onChange={(e) => setSelectedBackend(e.target.value)}
          aria-label={t('pages.native-debug.outputBackend.select.ariaLabel')}
        >
          <option value="">{t('pages.native-debug.outputBackend.default')}</option>
          {outputBackends.map((backendId) => (
            <option key={backendId} value={backendId}>
              {backendId}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void handleRefreshAudioComponents()}>
          {t('common.action.refresh')}
        </button>
        <button type="button" onClick={() => void handleApplyOutputBackend()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.audioInput.title')}</p>
        <p className="device-value">
          {t('pages.native-debug.audioInput.preferred', {
            id: componentsState.preferredInputId ?? t('pages.native-debug.audioInput.auto'),
          })}
        </p>
        <p className="device-hint">
          {t('pages.native-debug.audioInput.active', {
            id:
              componentsState.activeInputId ??
              t('pages.native-debug.audioInput.active.none'),
          })}
        </p>
      </div>
      <div className="device-controls">
        <select
          value={selectedInput}
          onChange={(e) => setSelectedInput(e.target.value)}
          aria-label={t('pages.native-debug.audioInput.select.ariaLabel')}
        >
          <option value="">{t('pages.native-debug.audioInput.auto')}</option>
          {audioInputs.map((inputId) => (
            <option key={inputId} value={inputId}>
              {inputId}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void handleRefreshAudioComponents()}>
          {t('common.action.refresh')}
        </button>
        <button type="button" onClick={() => void handleApplyAudioInput()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.title')}</p>
        <p className="device-value">{t(`pages.native-debug.src.preset.${srcPresetId}`)}</p>
        <p className="device-hint">{t('pages.native-debug.src.desc')}</p>
      </div>
      <div className="device-controls src-preset-controls">
        <button type="button" onClick={() => void handleApplySrcPreset('balanced')}>
          {t('pages.native-debug.src.preset.balanced')}
        </button>
        <button type="button" onClick={() => void handleApplySrcPreset('hi-end')}>
          {t('pages.native-debug.src.preset.hi-end')}
        </button>
        <button type="button" onClick={() => void handleApplySrcPreset('low-latency')}>
          {t('pages.native-debug.src.preset.low-latency')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.mode.title')}</p>
        <p className="device-hint">{t('pages.native-debug.src.mode.desc')}</p>
      </div>
      <div className="device-controls">
        <select
          value={srcMode}
          onChange={(e) => setSrcMode(e.target.value as NativeAudioSrcMode)}
          aria-label={t('pages.native-debug.src.mode.title')}
        >
          <option value="source-native">{t('pages.native-debug.src.mode.source-native')}</option>
          <option value="match-output">{t('pages.native-debug.src.mode.match-output')}</option>
          <option value="target-rate">{t('pages.native-debug.src.mode.target-rate')}</option>
        </select>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.backend.title')}</p>
        <p className="device-hint">{t('pages.native-debug.src.backend.desc')}</p>
      </div>
      <div className="device-controls">
        <select
          value={srcBackend}
          onChange={(e) => setSrcBackend(e.target.value as NativeAudioSrcBackend)}
          aria-label={t('pages.native-debug.src.backend.title')}
        >
          <option value="rubato">{t('pages.native-debug.src.backend.rubato')}</option>
          <option value="linear-simd">{t('pages.native-debug.src.backend.linear-simd')}</option>
        </select>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.targetRate.title')}</p>
        <p className="device-hint">{t('pages.native-debug.src.targetRate.desc')}</p>
      </div>
      <div className="device-controls">
        <input
          type="number"
          min={8000}
          max={768000}
          step={1000}
          value={srcTargetRate}
          onChange={(e) => setSrcTargetRate(e.target.value)}
          disabled={srcMode !== 'target-rate'}
          aria-label={t('pages.native-debug.src.targetRate.title')}
          className="src-target-rate-input"
        />
        <button type="button" onClick={() => void handleApplySrcPolicy()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.dynamic.title')}</p>
        <p className="device-value">
          {dynamicSrcSettings.enabled ? t('common.state.on') : t('common.state.off')}
        </p>
        <p className="device-hint">{t('pages.native-debug.src.dynamic.desc')}</p>
      </div>
      <div className="device-controls">
        <button
          type="button"
          className={dynamicSrcSettings.enabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ enabled: true })}
        >
          {t('common.state.on')}
        </button>
        <button
          type="button"
          className={!dynamicSrcSettings.enabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ enabled: false })}
        >
          {t('common.state.off')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.dynamic.adaptive.title')}</p>
        <p className="device-value">
          {dynamicSrcSettings.adaptiveEnabled ? t('common.state.on') : t('common.state.off')}
        </p>
        <p className="device-hint">{t('pages.native-debug.src.dynamic.adaptive.desc')}</p>
      </div>
      <div className="device-controls">
        <button
          type="button"
          className={dynamicSrcSettings.adaptiveEnabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ adaptiveEnabled: true })}
        >
          {t('common.state.on')}
        </button>
        <button
          type="button"
          className={!dynamicSrcSettings.adaptiveEnabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ adaptiveEnabled: false })}
        >
          {t('common.state.off')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.dynamic.learning.title')}</p>
        <p className="device-value">
          {dynamicSrcSettings.learningEnabled ? t('common.state.on') : t('common.state.off')}
        </p>
        <p className="device-hint">{t('pages.native-debug.src.dynamic.learning.desc')}</p>
      </div>
      <div className="device-controls">
        <button
          type="button"
          className={dynamicSrcSettings.learningEnabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ learningEnabled: true })}
        >
          {t('common.state.on')}
        </button>
        <button
          type="button"
          className={!dynamicSrcSettings.learningEnabled ? 'is-active-toggle' : ''}
          onClick={() => void applyDynamicSrcAutoSettings({ learningEnabled: false })}
        >
          {t('common.state.off')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.src.dynamic.params.title')}</p>
        <p className="device-hint">{t('pages.native-debug.src.dynamic.params.desc')}</p>
      </div>
      <div className="device-controls dynamic-src-param-controls">
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.restoreDebounceMs')}</span>
          <input
            type="number"
            min={500}
            max={30000}
            step={100}
            value={dynamicSrcSettings.restoreDebounceMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                restoreDebounceMs: Number(event.target.value) || prev.restoreDebounceMs,
              }))
            }
          />
        </label>
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.minSwitchIntervalMs')}</span>
          <input
            type="number"
            min={100}
            max={10000}
            step={50}
            value={dynamicSrcSettings.minSwitchIntervalMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                minSwitchIntervalMs: Number(event.target.value) || prev.minSwitchIntervalMs,
              }))
            }
          />
        </label>
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.seekHoldMs')}</span>
          <input
            type="number"
            min={500}
            max={20000}
            step={100}
            value={dynamicSrcSettings.seekHoldMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                seekHoldMs: Number(event.target.value) || prev.seekHoldMs,
              }))
            }
          />
        </label>
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.underrunHoldMs')}</span>
          <input
            type="number"
            min={2000}
            max={120000}
            step={500}
            value={dynamicSrcSettings.underrunHoldMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                underrunHoldMs: Number(event.target.value) || prev.underrunHoldMs,
              }))
            }
          />
        </label>
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.sharedStressHoldMs')}</span>
          <input
            type="number"
            min={1000}
            max={90000}
            step={500}
            value={dynamicSrcSettings.sharedStressHoldMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                sharedStressHoldMs: Number(event.target.value) || prev.sharedStressHoldMs,
              }))
            }
          />
        </label>
        <label className="dynamic-src-param-item">
          <span>{t('pages.native-debug.src.dynamic.params.outputErrorHoldMs')}</span>
          <input
            type="number"
            min={1000}
            max={120000}
            step={500}
            value={dynamicSrcSettings.outputErrorHoldMs}
            onChange={(event) =>
              setDynamicSrcSettings((prev) => ({
                ...prev,
                outputErrorHoldMs: Number(event.target.value) || prev.outputErrorHoldMs,
              }))
            }
          />
        </label>
        <button type="button" onClick={() => void applyDynamicSrcAutoSettings(dynamicSrcSettings)}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row native-debug-system-group">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.outputDevice.title')}</p>
        <p className="device-value">{nativeMeta.device ?? t('pages.native-debug.outputDevice.default')}</p>
        <p className="device-hint">
          {nativeMeta.sampleRate ? `${nativeMeta.sampleRate} Hz` : '--'} {' / '}
          {nativeMeta.bitDepth ? `${nativeMeta.bitDepth} bit` : '--'}
        </p>
      </div>
      <div className="device-controls">
        <select
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          aria-label={t('pages.native-debug.outputDevice.select.ariaLabel')}
        >
          <option value="">{t('pages.native-debug.outputDevice.default')}</option>
          {outputDevices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void handleRefreshDevices()}>
          {t('common.action.refresh')}
        </button>
        <button type="button" onClick={() => void handleApplyDevice()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

      <div className="native-debug-visual-card">
        <AudioVisualizer
          getFrequencyData={getFrequencyData}
          isPlaying={isPlaying}
        />
      </div>

    </div>


  );
}
