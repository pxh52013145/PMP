import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './NativeDebugPage.css';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { Track } from '../../services/audio';
import { AudioVisualizer } from '../magnet/AudioVisualizer';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const last = segments[segments.length - 1];
  return last || '未知音频文件';
}

const SUPPORTED_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];

type NativeAudioMeta = {
  device: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  gainDb: number | null;
  replayGainDb: number | null;
};

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

type ReplayGainMode = 'track' | 'album';

type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

const DEFAULT_EQ_BANDS: NativeDspEqBand[] = [
  { kind: 'low-shelf', frequencyHz: 120, q: 1, gainDb: 0 },
  { kind: 'peaking', frequencyHz: 1000, q: 1, gainDb: 0 },
  { kind: 'high-shelf', frequencyHz: 8000, q: 1, gainDb: 0 },
];

export const NativeDebugPage: React.FC = () => {
  const audioService = useAudioService();
  const { engineType, setEngineType } = useAudioEngine();
  const [state, setState] = useState(() => audioService.getState());
  const [logs, setLogs] = useState<string[]>([]);
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nativeMeta, setNativeMeta] = useState<NativeAudioMeta>({
    device: null,
    sampleRate: null,
    bitDepth: null,
    gainDb: null,
    replayGainDb: null,
  });
  const [dspGainDb, setDspGainDb] = useState(0);
  const [eqBands, setEqBands] = useState<NativeDspEqBand[]>(DEFAULT_EQ_BANDS);
  const [limiterEnabled, setLimiterEnabled] = useState(false);
  const [limiterThresholdDb, setLimiterThresholdDb] = useState(-1);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [replayGainSettings, setReplayGainSettings] = useState<ReplayGainSettings>({
    enabled: true,
    mode: 'track',
    preampDb: 0,
  });
  const [crossfadeSettings, setCrossfadeSettings] = useState<CrossfadeSettings>({
    enabled: false,
    durationMs: 1200,
  });

  const getFrequencyData = useCallback(() => audioService.getFrequencyData?.() ?? null, [audioService]);

  const appendLog = useCallback((message: string) => {
    setLogs((prev) => {
      const timestamp = new Date().toLocaleTimeString();
      const next = [`[${timestamp}] ${message}`, ...prev];
      return next.slice(0, 50);
    });
  }, []);

  useEffect(() => {
    setState(audioService.getState());
    const unsubscribeState = audioService.onStateChange((next) => setState(next));
    const unsubscribeError = audioService.onError((error) => {
      const message = error?.message ?? String(error);
      setLastError(message);
      appendLog(`错误: ${message}`);
    });
    return () => {
      unsubscribeState();
      unsubscribeError();
    };
  }, [audioService, appendLog]);

  const isNativeEngine = engineType === 'native';

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<string | null>(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE);
    if (typeof persisted === 'string') {
      setSelectedDevice(persisted);
    } else if (persisted === null) {
      setSelectedDevice('');
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS);
    if (!persisted || typeof persisted !== 'object') return;

    const enabled =
      'enabled' in persisted && typeof (persisted as any).enabled === 'boolean'
        ? (persisted as any).enabled
        : true;
    const modeRaw =
      'mode' in persisted && typeof (persisted as any).mode === 'string'
        ? String((persisted as any).mode)
        : 'track';
    const mode: ReplayGainMode = modeRaw === 'album' ? 'album' : 'track';
    const preampDb =
      'preampDb' in persisted && typeof (persisted as any).preampDb === 'number'
        ? (persisted as any).preampDb
        : 0;

    setReplayGainSettings({ enabled, mode, preampDb });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS);
    if (!persisted || typeof persisted !== "object") return;

    const enabled =
      "enabled" in persisted && typeof (persisted as any).enabled === "boolean"
        ? (persisted as any).enabled
        : false;
    const durationMs =
      "durationMs" in persisted && typeof (persisted as any).durationMs === "number"
        ? (persisted as any).durationMs
        : 1200;

    setCrossfadeSettings({
      enabled,
      durationMs: typeof durationMs === "number" && isFinite(durationMs) ? durationMs : 1200,
    });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN);
    if (!Array.isArray(persisted)) return;

    const gainNode = persisted.find((node) => {
      return (
        node &&
        typeof node === 'object' &&
        'type' in node &&
        (node as any).type === 'gain' &&
        typeof (node as any).db === 'number'
      );
    }) as { type: 'gain'; db: number } | undefined;

    if (gainNode) {
      setDspGainDb(gainNode.db);
    }

    const eqNode = persisted.find((node) => {
      return (
        node &&
        typeof node === 'object' &&
        'type' in node &&
        (node as any).type === 'eq' &&
        Array.isArray((node as any).bands)
      );
    }) as { type: 'eq'; bands: unknown[] } | undefined;

    if (eqNode) {
      const nextBands: NativeDspEqBand[] = [];
      for (const band of eqNode.bands) {
        if (!band || typeof band !== 'object') continue;
        const kind = (band as any).kind as NativeDspEqBandKind | undefined;
        const frequencyHz = typeof (band as any).frequencyHz === 'number' ? (band as any).frequencyHz : null;
        const q = typeof (band as any).q === 'number' ? (band as any).q : null;
        const gainDb = typeof (band as any).gainDb === 'number' ? (band as any).gainDb : null;
        if (!kind || frequencyHz === null || q === null || gainDb === null) continue;
        if (kind !== 'peaking' && kind !== 'low-shelf' && kind !== 'high-shelf') continue;
        nextBands.push({ kind, frequencyHz, q, gainDb });
      }
      if (nextBands.length > 0) {
        setEqBands(nextBands);
      }
    }

    const limiterNode = persisted.find((node) => {
      return (
        node &&
        typeof node === 'object' &&
        'type' in node &&
        (node as any).type === 'limiter' &&
        typeof (node as any).thresholdDb === 'number'
      );
    }) as { type: 'limiter'; thresholdDb: number } | undefined;

    if (limiterNode) {
      setLimiterEnabled(true);
      setLimiterThresholdDb(limiterNode.thresholdDb);
    } else {
      setLimiterEnabled(false);
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;

    let unlisten: UnlistenFn | null = null;
    void listen('native_audio_state', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const next =
        payload && 'state' in payload ? (payload.state as Record<string, unknown>) : payload;

      const device = typeof next.device === 'string' ? next.device : null;
      const sampleRate = typeof next.sampleRate === 'number' ? next.sampleRate : null;
      const bitDepth = typeof next.bitDepth === 'number' ? next.bitDepth : null;
      const gainDb = typeof next.gainDb === 'number' ? next.gainDb : null;
      const replayGainDb = typeof next.replayGainDb === 'number' ? next.replayGainDb : null;

      setNativeMeta({ device, sampleRate, bitDepth, gainDb, replayGainDb });
      if (gainDb !== null) {
        setDspGainDb(gainDb);
      }
      setSelectedDevice((prev) => prev || device || '');
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [isNativeEngine]);

  const currentTrackLabel = useMemo(() => {
    if (!state.currentTrack) return '未加载音频';
    const { title, artist } = state.currentTrack;
    return artist ? `${title} – ${artist}` : title;
  }, [state.currentTrack]);

  const handleRefreshDevices = useCallback(async () => {
    try {
      const devices = await invoke<string[]>('native_audio_list_devices');
      setOutputDevices(devices);
      appendLog(`已获取输出设备：${devices.length} 个`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`获取输出设备失败：${message}`);
    }
  }, [appendLog]);

  const handleApplyDevice = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
        selectedDevice.length > 0 ? selectedDevice : null,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
      );
      await invoke('native_audio_select_device', {
        deviceName: selectedDevice.length > 0 ? selectedDevice : null,
      });
      appendLog(`切换输出设备：${selectedDevice || '默认设备'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`切换输出设备失败：${message}`);
    }
  }, [appendLog, selectedDevice]);

  const applyDspChain = useCallback(
    async (
      nextGainDb: number,
      nextEqBands: NativeDspEqBand[],
      logLine: string,
      nextLimiterEnabled: boolean = limiterEnabled,
      nextLimiterThresholdDb: number = limiterThresholdDb
    ) => {
      try {
        const chain: NativeDspNodeConfig[] = [
          { type: 'gain', db: nextGainDb },
          { type: 'eq', bands: nextEqBands },
        ];
        if (nextLimiterEnabled) {
          chain.push({ type: 'limiter', thresholdDb: nextLimiterThresholdDb });
        }

        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN,
          chain,
          TAURI_EVENTS.NATIVE_AUDIO_DSP_CHAIN_UPDATED
        );
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
          nextGainDb,
          TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
        );
        await invoke('native_audio_set_dsp_chain', { chain });
        appendLog(logLine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`设置 DSP 失败：${message}`);
      }
    },
    [appendLog, limiterEnabled, limiterThresholdDb]
  );

  const handleGainChange = useCallback(
    async (db: number) => {
      setDspGainDb(db);
      await applyDspChain(db, eqBands, `设置 DSP Chain：Gain ${db.toFixed(1)} dB`);
    },
    [applyDspChain, eqBands]
  );

  const handleEqBandGainChange = useCallback(
    async (index: number, gainDb: number) => {
      const next = eqBands.map((band, i) => (i === index ? { ...band, gainDb } : band));
      setEqBands(next);
      await applyDspChain(dspGainDb, next, `设置 EQ：Band ${index + 1} ${gainDb.toFixed(1)} dB`);
    },
    [applyDspChain, dspGainDb, eqBands]
  );

  const handleEqReset = useCallback(async () => {
    const next = eqBands.map((band) => ({ ...band, gainDb: 0 }));
    setEqBands(next);
    await applyDspChain(dspGainDb, next, '重置 EQ：全部归零');
  }, [applyDspChain, dspGainDb, eqBands]);

  const handleLimiterToggle = useCallback(
    async (enabled: boolean) => {
      setLimiterEnabled(enabled);
      await applyDspChain(dspGainDb, eqBands, `Limiter: ${enabled ? 'on' : 'off'}`, enabled, limiterThresholdDb);
    },
    [applyDspChain, dspGainDb, eqBands, limiterThresholdDb]
  );

  const handleLimiterThresholdChange = useCallback(
    async (db: number) => {
      setLimiterThresholdDb(db);
      await applyDspChain(dspGainDb, eqBands, `Limiter threshold: ${db.toFixed(1)} dB`, limiterEnabled, db);
    },
    [applyDspChain, dspGainDb, eqBands, limiterEnabled]
  );

  const handleApplyCrossfadeSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
        crossfadeSettings,
        TAURI_EVENTS.NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED
      );
      appendLog(
        `Crossfade: ${crossfadeSettings.enabled ? 'on' : 'off'} · ${Math.round(crossfadeSettings.durationMs)}ms`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Crossfade update failed: ${message}`);
    }
  }, [appendLog, crossfadeSettings]);

  const handleApplyReplayGainSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
        replayGainSettings,
        TAURI_EVENTS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS_UPDATED
      );

      const track = audioService.getState().currentTrack;
      const base =
        replayGainSettings.mode === 'album'
          ? track?.replayGainAlbumGainDb
          : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && isFinite(base);
      const effective =
        replayGainSettings.enabled && hasBase ? base + replayGainSettings.preampDb : null;

      await invoke('native_audio_set_replay_gain', {
        db: typeof effective === 'number' ? effective : null,
      });

      appendLog(
        `ReplayGain：${replayGainSettings.enabled ? '启用' : '关闭'} · mode=${replayGainSettings.mode} · preamp=${replayGainSettings.preampDb.toFixed(
          1
        )}dB`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`设置 ReplayGain 失败：${message}`);
    }
  }, [appendLog, audioService, replayGainSettings]);

  const handleSelectTrack = useCallback(async () => {
    setIsSelectingFile(true);
    setLastError(null);
    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: '音频文件', extensions: SUPPORTED_EXTENSIONS }],
      });

      if (!selected) {
        appendLog('已取消选择音频文件');
        return;
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        appendLog('无法解析选中的音频文件');
        return;
      }

      const track: Track = {
        id: `native-${Date.now()}`,
        title: getFileName(filePath),
        filePath,
        path: filePath,
        originalPath: filePath,
      };

      audioService.clearQueue();
      audioService.addToQueue(track);
      appendLog(`加载文件：${track.title}`);
      await audioService.playTrackAtIndex(0);
      appendLog('播放命令已发送');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      appendLog(`加载失败：${message}`);
    } finally {
      setIsSelectingFile(false);
    }
  }, [appendLog, audioService]);

  const handlePlay = useCallback(async () => {
    if (state.playbackState === 'paused' && state.currentTrack) {
      await audioService.play();
      appendLog('继续播放');
      return;
    }

    if (!state.currentTrack && state.queue.length > 0) {
      const index = state.currentIndex >= 0 ? state.currentIndex : 0;
      await audioService.playTrackAtIndex(index);
      appendLog(`从队列索引 ${index} 播放`);
      return;
    }

    if (state.currentTrack) {
      await audioService.play();
      appendLog('开始播放当前曲目');
      return;
    }

    appendLog('没有可播放的歌曲，请先选择音频文件');
  }, [audioService, appendLog, state.currentIndex, state.currentTrack, state.playbackState, state.queue.length]);

  const handleStop = useCallback(() => {
    audioService.stop();
    appendLog('触发停止');
  }, [audioService, appendLog]);

  const handleNext = useCallback(async () => {
    await audioService.playNext();
    appendLog('播放下一首');
  }, [audioService, appendLog]);

  const handlePrev = useCallback(async () => {
    await audioService.playPrevious();
    appendLog('播放上一首');
  }, [audioService, appendLog]);

  const handleVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      audioService.setVolume(value);
      appendLog(`调整音量：${value.toFixed(2)}`);
    },
    [audioService, appendLog]
  );

  const handleToggleMute = useCallback(() => {
    audioService.toggleMute();
    appendLog('切换静音');
  }, [audioService, appendLog]);

  const handleTogglePlayPause = useCallback(async () => {
    if (state.playbackState === 'playing') {
      await audioService.pause();
      appendLog('触发暂停');
      return;
    }
    await handlePlay();
  }, [appendLog, handlePlay, audioService, state.playbackState]);

  const handleQueuePlay = useCallback(
    async (index: number) => {
      await audioService.playTrackAtIndex(index);
      appendLog(`从队列播放索引 ${index}`);
    },
    [audioService, appendLog]
  );

  const handleQueueRemove = useCallback(
    (index: number) => {
      audioService.removeFromQueue(index);
      appendLog(`从队列移除索引 ${index}`);
    },
    [audioService, appendLog]
  );

  const handleClearQueue = useCallback(() => {
    audioService.clearQueue();
    appendLog('清空队列');
  }, [audioService, appendLog]);

  const displayedState = useMemo(() => JSON.stringify(state, null, 2), [state]);

  if (!isNativeEngine) {
    return (
      <div className="native-debug-page">
        <div className="native-debug-card native-debug-warning">
          <h2>原生音频引擎未启用</h2>
          <p>本页面仅用于调试原生音频服务。请先在首页切换到“Native Audio”。</p>
          <button className="native-debug-primary" type="button" onClick={() => setEngineType('native')}>
            立即切换
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="native-debug-page">
      <div className="native-debug-layout">
        <section className="native-debug-card native-debug-controls">
          <header>
            <div>
              <p className="section-label">控制面板</p>
              <h2>原生引擎调试</h2>
            </div>
            <span className={`state-pill state-${state.playbackState}`}>{state.playbackState}</span>
          </header>

          <div className="current-track">
            <p className="current-track-title">{currentTrackLabel}</p>
            {state.currentTrack?.originalPath && (
              <p className="current-track-path">{state.currentTrack.originalPath}</p>
            )}
          </div>

          <div className="control-row">
            <button type="button" onClick={handleSelectTrack} disabled={isSelectingFile}>
              {isSelectingFile ? '加载中…' : '选择音频文件'}
            </button>
            <div className="transport-buttons">
              <button type="button" onClick={handlePrev} disabled={!state.queue.length}>
                ◀︎
              </button>
              <button type="button" onClick={() => void handleTogglePlayPause()}>
                {state.playbackState === 'playing' ? '❚❚' : '▶︎'}
              </button>
              <button type="button" onClick={handleStop}>
                ■
              </button>
              <button type="button" onClick={handleNext} disabled={!state.queue.length}>
                ▶︎
              </button>
            </div>
          </div>

          <div className="volume-row">
            <label htmlFor="native-debug-volume">音量：{Math.round(state.volume * 100)}%</label>
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
              {state.muted ? '取消静音' : '静音'}
            </button>
          </div>

          <div className="volume-row">
            <label htmlFor="native-debug-gain">
              Gain：{dspGainDb.toFixed(1)} dB
            </label>
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
              复位
            </button>
          </div>

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">Crossfade</p>
              <p className="device-hint">Applies when switching tracks while playing (native)</p>
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
                Enabled
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Duration</span>
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
                Apply
              </button>
            </div>
          </div>

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">ReplayGain</p>
              <p className="device-value">
                applied：{nativeMeta.replayGainDb === null ? '—' : `${nativeMeta.replayGainDb.toFixed(1)} dB`}
              </p>
              <p className="device-hint">
                track tag：
                {typeof state.currentTrack?.replayGainTrackGainDb === 'number'
                  ? `${state.currentTrack.replayGainTrackGainDb.toFixed(1)} dB`
                  : '—'}{' '}
                · album tag：
                {typeof state.currentTrack?.replayGainAlbumGainDb === 'number'
                  ? `${state.currentTrack.replayGainAlbumGainDb.toFixed(1)} dB`
                  : '—'}
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
                启用
              </label>
              <select
                value={replayGainSettings.mode}
                onChange={(e) =>
                  setReplayGainSettings((prev) => ({
                    ...prev,
                    mode: (e.target.value === 'album' ? 'album' : 'track') as ReplayGainMode,
                  }))
                }
                aria-label="ReplayGain 模式"
              >
                <option value="track">Track</option>
                <option value="album">Album</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Preamp</span>
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
                应用
              </button>
            </div>
          </div>

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">EQ（3-band）</p>
              <p className="device-hint">Low shelf 120Hz · Peak 1kHz · High shelf 8kHz</p>
            </div>
            <div className="device-controls" style={{ gap: 10 }}>
              <button type="button" onClick={() => void handleEqReset()}>
                EQ 归零
              </button>
            </div>
          </div>

          {eqBands.map((band, index) => (
            <div key={`${band.kind}-${band.frequencyHz}`} className="volume-row">
              <label htmlFor={`native-debug-eq-${index}`}>
                {band.kind} {Math.round(band.frequencyHz)}Hz：{band.gainDb.toFixed(1)} dB
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
                归零
              </button>
            </div>
          ))}

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">Limiter</p>
              <p className="device-hint">Peak limiter (post EQ)</p>
            </div>
            <div className="device-controls" style={{ gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={limiterEnabled}
                  onChange={(e) => void handleLimiterToggle(e.target.checked)}
                />
                Enabled
              </label>
              <button
                type="button"
                onClick={() => void handleLimiterThresholdChange(-1)}
                disabled={!limiterEnabled}
              >
                Default (-1dB)
              </button>
            </div>
          </div>

          <div className="volume-row">
            <label htmlFor="native-debug-limiter-threshold">
              Threshold: {limiterThresholdDb.toFixed(1)} dB
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

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">输出设备</p>
              <p className="device-value">{nativeMeta.device ?? '默认设备'}</p>
              <p className="device-hint">
                {nativeMeta.sampleRate ? `${nativeMeta.sampleRate} Hz` : '—'} ·{' '}
                {nativeMeta.bitDepth ? `${nativeMeta.bitDepth} bit` : '—'}
              </p>
            </div>
            <div className="device-controls">
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                aria-label="选择输出设备"
              >
                <option value="">默认设备</option>
                {outputDevices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void handleRefreshDevices()}>
                刷新
              </button>
              <button type="button" onClick={() => void handleApplyDevice()}>
                应用
              </button>
            </div>
          </div>

          <AudioVisualizer
            getFrequencyData={getFrequencyData}
            isPlaying={state.playbackState === 'playing'}
          />

          <div className="queue-actions">
            <div>
              <p className="section-label">队列</p>
              <h3>{state.queue.length} 首歌曲</h3>
            </div>
            <button type="button" onClick={handleClearQueue} disabled={!state.queue.length}>
              清空
            </button>
          </div>

          <ul className="debug-queue">
            {state.queue.length === 0 && <li className="queue-empty">暂无队列，请先加载音频</li>}
            {state.queue.map((track, index) => (
              <li key={track.id} data-active={index === state.currentIndex}>
                <div>
                  <p className="queue-track-title">{track.title}</p>
                  <p className="queue-track-meta">{track.originalPath || track.path}</p>
                </div>
                <div className="queue-buttons">
                  <button type="button" onClick={() => handleQueuePlay(index)}>
                    播放
                  </button>
                  <button type="button" onClick={() => handleQueueRemove(index)}>
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {lastError && <p className="error-banner">最后一次错误：{lastError}</p>}
        </section>

        <section className="native-debug-card native-debug-state-panel">
          <header>
            <p className="section-label">实时状态</p>
            <h3>NativeAudioService Snapshot</h3>
          </header>
          <pre className="native-debug-state">{displayedState}</pre>
          <div className="native-debug-logs">
            <p className="section-label">操作日志</p>
            <ul>
              {logs.length === 0 && <li className="log-empty">暂无日志</li>}
              {logs.map((log, idx) => (
                <li key={`${log}-${idx}`}>{log}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
};
