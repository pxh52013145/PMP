import { type AudioState } from '../../../services/audio';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type ReplayGainMode = 'track' | 'album';
type NativeDspEqBandKind = 'peaking' | 'low-shelf' | 'high-shelf';

type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

type RuntimeControlSettings = {
  dynamicFallbackEnabled: boolean;
  volumeDebounceEnabled: boolean;
};

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

type NativeDspEqBand = {
  kind: NativeDspEqBandKind;
  frequencyHz: number;
  q: number;
  gainDb: number;
};

type NativeAudioMeta = {
  device: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  gainDb: number | null;
  replayGainDb: number | null;
};

type NativeDebugPlaybackDspPanelProps = {
  t: TranslateFn;
  state: AudioState;
  currentTrackLabel: string;
  isSelectingFile: boolean;
  dspGainDb: number;
  crossfadeSettings: CrossfadeSettings;
  replayGainSettings: ReplayGainSettings;
  runtimeControlSettings: RuntimeControlSettings;
  nativeMeta: NativeAudioMeta;
  eqBands: NativeDspEqBand[];
  limiterEnabled: boolean;
  limiterThresholdDb: number;
  setCrossfadeSettings: Dispatch<SetStateAction<CrossfadeSettings>>;
  setReplayGainSettings: Dispatch<SetStateAction<ReplayGainSettings>>;
  setRuntimeControlSettings: Dispatch<SetStateAction<RuntimeControlSettings>>;
  handleSelectTrack: () => void | Promise<void>;
  handlePrev: () => void | Promise<void>;
  handleTogglePlayPause: () => void | Promise<void>;
  handleStop: () => void;
  handleNext: () => void | Promise<void>;
  handleVolumeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleToggleMute: () => void;
  handleGainChange: (db: number) => void | Promise<void>;
  handleApplyCrossfadeSettings: () => void | Promise<void>;
  handleApplyReplayGainSettings: () => void | Promise<void>;
  handleApplyRuntimeControlSettings: () => void | Promise<void>;
  eqBandKindLabel: (kind: NativeDspEqBandKind) => string;
  handleEqReset: () => void | Promise<void>;
  handleEqBandGainChange: (index: number, gainDb: number) => void | Promise<void>;
  handleLimiterToggle: (enabled: boolean) => void | Promise<void>;
  handleLimiterThresholdChange: (db: number) => void | Promise<void>;
};

export function NativeDebugPlaybackDspPanel({
  t,
  state,
  currentTrackLabel,
  isSelectingFile,
  dspGainDb,
  crossfadeSettings,
  replayGainSettings,
  runtimeControlSettings,
  nativeMeta,
  eqBands,
  limiterEnabled,
  limiterThresholdDb,
  setCrossfadeSettings,
  setReplayGainSettings,
  setRuntimeControlSettings,
  handleSelectTrack,
  handlePrev,
  handleTogglePlayPause,
  handleStop,
  handleNext,
  handleVolumeChange,
  handleToggleMute,
  handleGainChange,
  handleApplyCrossfadeSettings,
  handleApplyReplayGainSettings,
  handleApplyRuntimeControlSettings,
  eqBandKindLabel,
  handleEqReset,
  handleEqBandGainChange,
  handleLimiterToggle,
  handleLimiterThresholdChange,
}: NativeDebugPlaybackDspPanelProps) {
  return (
    <div className="native-debug-panel-group native-debug-panel-group--playback">
    <div className="current-track">
      <p className="current-track-title">{currentTrackLabel}</p>
      {state.currentTrack?.originalPath && (
        <p className="current-track-path">{state.currentTrack.originalPath}</p>
      )}
    </div>

    <div className="control-row">
      <button type="button" onClick={handleSelectTrack} disabled={isSelectingFile}>
        {isSelectingFile ? t('common.state.loading') : t('pages.native-debug.action.selectAudioFile')}
      </button>
      <div className="transport-buttons">
        <button type="button" onClick={handlePrev} disabled={!state.queue.length}>
          {t('pages.native-debug.transport.prev')}
        </button>
        <button type="button" onClick={() => void handleTogglePlayPause()}>
          {state.playbackState === 'playing'
            ? t('pages.native-debug.transport.pause')
            : t('pages.native-debug.transport.play')}
        </button>
        <button type="button" onClick={handleStop}>
          {t('pages.native-debug.transport.stop')}
        </button>
        <button type="button" onClick={handleNext} disabled={!state.queue.length}>
          {t('pages.native-debug.transport.next')}
        </button>
      </div>
    </div>

    <div className="volume-row">
      <label htmlFor="native-debug-volume">
        {t('pages.native-debug.volume.label', { percent: Math.round(state.volume * 100) })}
      </label>
      <input
        id="native-debug-volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={state.volume}
        onChange={handleVolumeChange}
      />
      <button type="button" onClick={handleToggleMute}>
        {state.muted ? t('common.action.unmute') : t('common.action.mute')}
      </button>
    </div>

    <div className="volume-row">
      <label htmlFor="native-debug-gain">{t('pages.native-debug.gain.label', { db: dspGainDb.toFixed(1) })}</label>
      <input
        id="native-debug-gain"
        type="range"
        min={-24}
        max={12}
        step={0.5}
        value={dspGainDb}
        onChange={(e) => void handleGainChange(Number(e.target.value))}
      />
      <button type="button" onClick={() => void handleGainChange(0)}>
        {t('pages.native-debug.gain.action.reset')}
      </button>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.crossfade.title')}</p>
        <p className="device-hint">{t('pages.native-debug.crossfade.desc')}</p>
      </div>
      <div className="device-controls" style={{ gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={crossfadeSettings.enabled}
            onChange={(e) =>
              setCrossfadeSettings((prev) => ({ ...prev, enabled: e.target.checked }))
            }
          />
          {t('common.action.enable')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{t('pages.native-debug.crossfade.duration')}</span>
          <input
            type="number"
            min={0}
            step={100}
            value={crossfadeSettings.durationMs}
            onChange={(e) =>
              setCrossfadeSettings((prev) => ({ ...prev, durationMs: Number(e.target.value) }))
            }
            style={{ width: 88 }}
          />
          <span>ms</span>
        </label>
        <button type="button" onClick={() => void handleApplyCrossfadeSettings()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.replayGain.title')}</p>
        <p className="device-value">
          {t('pages.native-debug.replayGain.applied', {
            value:
              nativeMeta.replayGainDb === null ? '--' : `${nativeMeta.replayGainDb.toFixed(1)} dB`,
          })}
        </p>
        <p className="device-hint">
          {t('pages.native-debug.replayGain.trackTag', {
            value:
              typeof state.currentTrack?.replayGainTrackGainDb === 'number'
                ? `${state.currentTrack.replayGainTrackGainDb.toFixed(1)} dB`
                : '--',
          })}{' '}
          {' / '}
          {t('pages.native-debug.replayGain.albumTag', {
            value:
              typeof state.currentTrack?.replayGainAlbumGainDb === 'number'
                ? `${state.currentTrack.replayGainAlbumGainDb.toFixed(1)} dB`
                : '--',
          })}
        </p>
      </div>
      <div className="device-controls" style={{ gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={replayGainSettings.enabled}
            onChange={(e) =>
              setReplayGainSettings((prev) => ({ ...prev, enabled: e.target.checked }))
            }
          />
          {t('common.action.enable')}
        </label>
        <select
          value={replayGainSettings.mode}
          onChange={(e) =>
            setReplayGainSettings((prev) => ({
              ...prev,
              mode: (e.target.value === 'album' ? 'album' : 'track') as ReplayGainMode,
            }))
          }
          aria-label={t('pages.native-debug.replayGain.mode.ariaLabel')}
        >
          <option value="track">{t('pages.native-debug.replayGain.mode.track')}</option>
          <option value="album">{t('pages.native-debug.replayGain.mode.album')}</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{t('pages.native-debug.replayGain.preamp')}</span>
          <input
            type="number"
            step={0.5}
            value={replayGainSettings.preampDb}
            onChange={(e) =>
              setReplayGainSettings((prev) => ({ ...prev, preampDb: Number(e.target.value) }))
            }
            style={{ width: 72 }}
          />
          <span>dB</span>
        </label>
        <button type="button" onClick={() => void handleApplyReplayGainSettings()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('settings.audioAdvanced.runtimeControl.title')}</p>
        <p className="device-hint">{t('settings.audioAdvanced.runtimeControl.subtitle')}</p>
      </div>
      <div className="device-controls" style={{ gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={runtimeControlSettings.dynamicFallbackEnabled}
            onChange={(e) =>
              setRuntimeControlSettings((prev) => ({
                ...prev,
                dynamicFallbackEnabled: e.target.checked,
              }))
            }
          />
          {t('settings.audioAdvanced.runtimeControl.dynamicFallback.label')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={runtimeControlSettings.volumeDebounceEnabled}
            onChange={(e) =>
              setRuntimeControlSettings((prev) => ({
                ...prev,
                volumeDebounceEnabled: e.target.checked,
              }))
            }
          />
          {t('settings.audioAdvanced.runtimeControl.volumeDebounce.label')}
        </label>
        <button type="button" onClick={() => void handleApplyRuntimeControlSettings()}>
          {t('common.action.apply')}
        </button>
      </div>
    </div>

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.eq.title')}</p>
        <p className="device-hint">{t('pages.native-debug.eq.desc')}</p>
      </div>
      <div className="device-controls" style={{ gap: 10 }}>
        <button type="button" onClick={() => void handleEqReset()}>
          {t('pages.native-debug.eq.action.zeroAll')}
        </button>
      </div>
    </div>

    {eqBands.map((band, index) => (
      <div key={`${band.kind}-${band.frequencyHz}`} className="volume-row">
        <label htmlFor={`native-debug-eq-${index}`}>
          {t('pages.native-debug.eq.bandLabel', {
            kind: eqBandKindLabel(band.kind),
            frequencyHz: Math.round(band.frequencyHz),
            gainDb: band.gainDb.toFixed(1),
          })}
        </label>
        <input
          id={`native-debug-eq-${index}`}
          type="range"
          min={-12}
          max={12}
          step={0.5}
          value={band.gainDb}
          onChange={(e) => void handleEqBandGainChange(index, Number(e.target.value))}
        />
        <button type="button" onClick={() => void handleEqBandGainChange(index, 0)}>
          {t('pages.native-debug.eq.action.zero')}
        </button>
      </div>
    ))}

    <div className="device-row">
      <div className="device-meta">
        <p className="device-label">{t('pages.native-debug.limiter.title')}</p>
        <p className="device-hint">{t('pages.native-debug.limiter.desc')}</p>
      </div>
      <div className="device-controls" style={{ gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={limiterEnabled}
            onChange={(e) => void handleLimiterToggle(e.target.checked)}
          />
          {t('common.action.enable')}
        </label>
        <button
          type="button"
          onClick={() => void handleLimiterThresholdChange(-1)}
          disabled={!limiterEnabled}
        >
          {t('pages.native-debug.limiter.action.defaultThreshold')}
        </button>
      </div>
    </div>

    <div className="volume-row">
      <label htmlFor="native-debug-limiter-threshold">
        {t('pages.native-debug.limiter.thresholdLabel', { db: limiterThresholdDb.toFixed(1) })}
      </label>
      <input
        id="native-debug-limiter-threshold"
        type="range"
        min={-24}
        max={0}
        step={0.5}
        value={limiterThresholdDb}
        disabled={!limiterEnabled}
        onChange={(e) => void handleLimiterThresholdChange(Number(e.target.value))}
      />
    </div>

    </div>


  );
}
