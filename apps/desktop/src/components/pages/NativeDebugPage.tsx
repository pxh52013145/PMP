import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './NativeDebugPage.css';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { Track } from '../../services/audio';
import { AudioVisualizer } from '../magnet/AudioVisualizer';

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
};

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
  });
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

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

    let unlisten: UnlistenFn | null = null;
    void listen('native_audio_state', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const next =
        payload && 'state' in payload ? (payload.state as Record<string, unknown>) : payload;

      const device = typeof next.device === 'string' ? next.device : null;
      const sampleRate = typeof next.sampleRate === 'number' ? next.sampleRate : null;
      const bitDepth = typeof next.bitDepth === 'number' ? next.bitDepth : null;

      setNativeMeta({ device, sampleRate, bitDepth });
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
      await invoke('native_audio_select_device', {
        deviceName: selectedDevice.length > 0 ? selectedDevice : null,
      });
      appendLog(`切换输出设备：${selectedDevice || '默认设备'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`切换输出设备失败：${message}`);
    }
  }, [appendLog, selectedDevice]);

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
