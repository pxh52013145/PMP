import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './NativeDebugPage.css';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { useLocale, useT } from '../../i18n';
import { Track } from '../../services/audio';
import { AudioVisualizer } from '../magnet/AudioVisualizer';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

function getFileName(filePath: string, fallback: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const last = segments[segments.length - 1];
  return last || fallback;
}

const SUPPORTED_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

type NativeAudioMeta = {
  device: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  gainDb: number | null;
  replayGainDb: number | null;
};

type NativeAudioComponentsState = {
  outputBackendId: string | null;
  preferredInputId: string | null;
  activeInputId: string | null;
};

function parseNativeAudioComponentsState(payload: unknown): NativeAudioComponentsState {
  const record = asRecord(payload);
  const outputBackendId = typeof record?.outputBackendId === 'string' ? record.outputBackendId : null;
  const preferredInputId = typeof record?.preferredInputId === 'string' ? record.preferredInputId : null;
  const activeInputId = typeof record?.activeInputId === 'string' ? record.activeInputId : null;
  return { outputBackendId, preferredInputId, activeInputId };
}

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
  const t = useT();
  const locale = useLocale();
  const { isNativeAvailable } = useAudioEngine();
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
  const [componentsState, setComponentsState] = useState<NativeAudioComponentsState>({
    outputBackendId: null,
    preferredInputId: null,
    activeInputId: null,
  });
  const [outputBackends, setOutputBackends] = useState<string[]>([]);
  const [selectedBackend, setSelectedBackend] = useState<string>('');
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
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
      const timestamp = new Date().toLocaleTimeString(locale);
      const next = [`[${timestamp}] ${message}`, ...prev];
      return next.slice(0, 50);
    });
  }, [locale]);

  useEffect(() => {
    setState(audioService.getState());
    const unsubscribeState = audioService.onStateChange((next) => setState(next));
    const unsubscribeError = audioService.onError((error) => {
      const message = error?.message ?? String(error);
      setLastError(message);
      appendLog(t('pages.native-debug.log.error', { message }));
    });
    return () => {
      unsubscribeState();
      unsubscribeError();
    };
  }, [audioService, appendLog, t]);

  const isNativeEngine = isNativeAvailable;

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
    const persisted = readData<string | null>(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND);
    if (typeof persisted === 'string') {
      setSelectedBackend(persisted);
    } else if (persisted === null) {
      setSelectedBackend('');
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<string | null>(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID);
    if (typeof persisted === 'string') {
      setSelectedInput(persisted);
    } else if (persisted === null) {
      setSelectedInput('');
    }
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS);
    const record = asRecord(persisted);
    if (!record) return;

    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
    const modeRaw = typeof record.mode === 'string' ? record.mode : 'track';
    const mode: ReplayGainMode = modeRaw === 'album' ? 'album' : 'track';
    const preampDb =
      typeof record.preampDb === 'number' && isFinite(record.preampDb) ? record.preampDb : 0;

    setReplayGainSettings({ enabled, mode, preampDb });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS);
    const record = asRecord(persisted);
    if (!record) return;

    const enabled = typeof record.enabled === 'boolean' ? record.enabled : false;
    const durationMs = typeof record.durationMs === 'number' ? record.durationMs : 1200;

    setCrossfadeSettings({
      enabled,
      durationMs: typeof durationMs === 'number' && isFinite(durationMs) ? durationMs : 1200,
    });
  }, [isNativeEngine]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_CHAIN);
    if (!Array.isArray(persisted)) return;

    const gainNode = persisted.find((node): node is { type: 'gain'; db: number } => {
      const record = asRecord(node);
      return record?.type === 'gain' && typeof record.db === 'number';
    });

    if (gainNode) {
      setDspGainDb(gainNode.db);
    }

    const eqNode = persisted.find((node): node is { type: 'eq'; bands: unknown[] } => {
      const record = asRecord(node);
      return record?.type === 'eq' && Array.isArray(record.bands);
    });

    if (eqNode) {
      const nextBands: NativeDspEqBand[] = [];
      for (const band of eqNode.bands) {
        const bandRecord = asRecord(band);
        if (!bandRecord) continue;
        const kind = bandRecord.kind as NativeDspEqBandKind | undefined;
        const frequencyHz = typeof bandRecord.frequencyHz === 'number' ? bandRecord.frequencyHz : null;
        const q = typeof bandRecord.q === 'number' ? bandRecord.q : null;
        const gainDb = typeof bandRecord.gainDb === 'number' ? bandRecord.gainDb : null;
        if (!kind || frequencyHz === null || q === null || gainDb === null) continue;
        if (kind !== 'peaking' && kind !== 'low-shelf' && kind !== 'high-shelf') continue;
        nextBands.push({ kind, frequencyHz, q, gainDb });
      }
      if (nextBands.length > 0) {
        setEqBands(nextBands);
      }
    }

    const limiterNode = persisted.find((node): node is { type: 'limiter'; thresholdDb: number } => {
      const record = asRecord(node);
      return record?.type === 'limiter' && typeof record.thresholdDb === 'number';
    });

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
    if (!state.currentTrack) return t('pages.native-debug.currentTrack.none');
    const { title, artist } = state.currentTrack;
    return artist ? `${title} – ${artist}` : title;
  }, [state.currentTrack, t]);

  const handleRefreshAudioComponents = useCallback(async () => {
    try {
      const payload = await invoke<unknown>('native_audio_get_audio_components_state');
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');
      setSelectedInput(parsed.preferredInputId ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.error', { message }));
    }

    try {
      const backends = await invoke<string[]>('native_audio_list_output_backends');
      setOutputBackends(backends);
      appendLog(t('pages.native-debug.log.outputBackendsFetched', { count: backends.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputBackendsFetchFailed', { message }));
    }

    try {
      const inputs = await invoke<string[]>('native_audio_list_audio_inputs');
      setAudioInputs(inputs);
      appendLog(t('pages.native-debug.log.audioInputsFetched', { count: inputs.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.audioInputsFetchFailed', { message }));
    }
  }, [appendLog, t]);

  useEffect(() => {
    if (!isNativeEngine) return;
    void handleRefreshAudioComponents();
  }, [handleRefreshAudioComponents, isNativeEngine]);

  const handleRefreshDevices = useCallback(async () => {
    try {
      const devices = await invoke<string[]>('native_audio_list_devices');
      setOutputDevices(devices);
      appendLog(t('pages.native-debug.log.outputDevicesFetched', { count: devices.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputDevicesFetchFailed', { message }));
    }
  }, [appendLog, t]);

  const handleApplyOutputBackend = useCallback(async () => {
    const backendId = selectedBackend.length > 0 ? selectedBackend : null;

    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND,
        backendId,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED
      );

      const payload = await invoke<unknown>('native_audio_select_output_backend', {
        backendId,
      });
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedBackend(parsed.outputBackendId ?? '');

      appendLog(
        t('pages.native-debug.log.outputBackendSwitched', {
          backendId: parsed.outputBackendId ?? t('pages.native-debug.outputBackend.default'),
        })
      );

      if (componentsState.outputBackendId && componentsState.outputBackendId !== parsed.outputBackendId) {
        setSelectedDevice('');
        setOutputDevices([]);
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
          null,
          TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
        );
      }

      await handleRefreshDevices();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputBackendSwitchFailed', { message }));
    }
  }, [
    appendLog,
    componentsState.outputBackendId,
    handleRefreshDevices,
    selectedBackend,
    t,
  ]);

  const handleApplyAudioInput = useCallback(async () => {
    const inputId = selectedInput.length > 0 ? selectedInput : null;

    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID,
        inputId,
        TAURI_EVENTS.NATIVE_AUDIO_INPUT_ID_UPDATED
      );

      const payload = await invoke<unknown>('native_audio_select_audio_input', {
        inputId,
      });
      const parsed = parseNativeAudioComponentsState(payload);
      setComponentsState(parsed);
      setSelectedInput(parsed.preferredInputId ?? '');

      appendLog(
        t('pages.native-debug.log.audioInputSelected', {
          inputId: parsed.preferredInputId ?? t('pages.native-debug.audioInput.auto'),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.audioInputSelectFailed', { message }));
    }
  }, [appendLog, selectedInput, t]);

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
      appendLog(
        t('pages.native-debug.log.outputDeviceSwitched', {
          device: selectedDevice || t('pages.native-debug.outputDevice.default'),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputDeviceSwitchFailed', { message }));
    }
  }, [appendLog, selectedDevice, t]);

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
        appendLog(t('pages.native-debug.log.dspApplyFailed', { message }));
      }
    },
    [appendLog, limiterEnabled, limiterThresholdDb, t]
  );

  const handleGainChange = useCallback(
    async (db: number) => {
      setDspGainDb(db);
      await applyDspChain(db, eqBands, t('pages.native-debug.log.dspGainSet', { db: db.toFixed(1) }));
    },
    [applyDspChain, eqBands, t]
  );

  const handleEqBandGainChange = useCallback(
    async (index: number, gainDb: number) => {
      const next = eqBands.map((band, i) => (i === index ? { ...band, gainDb } : band));
      setEqBands(next);
      await applyDspChain(
        dspGainDb,
        next,
        t('pages.native-debug.log.eqBandSet', {
          index: index + 1,
          gainDb: gainDb.toFixed(1),
        })
      );
    },
    [applyDspChain, dspGainDb, eqBands, t]
  );

  const handleEqReset = useCallback(async () => {
    const next = eqBands.map((band) => ({ ...band, gainDb: 0 }));
    setEqBands(next);
    await applyDspChain(dspGainDb, next, t('pages.native-debug.log.eqReset'));
  }, [applyDspChain, dspGainDb, eqBands, t]);

  const handleLimiterToggle = useCallback(
    async (enabled: boolean) => {
      setLimiterEnabled(enabled);
      await applyDspChain(
        dspGainDb,
        eqBands,
        t('pages.native-debug.log.limiterToggle', {
          state: enabled ? t('common.state.on') : t('common.state.off'),
        }),
        enabled,
        limiterThresholdDb
      );
    },
    [applyDspChain, dspGainDb, eqBands, limiterThresholdDb, t]
  );

  const handleLimiterThresholdChange = useCallback(
    async (db: number) => {
      setLimiterThresholdDb(db);
      await applyDspChain(
        dspGainDb,
        eqBands,
        t('pages.native-debug.log.limiterThreshold', { db: db.toFixed(1) }),
        limiterEnabled,
        db
      );
    },
    [applyDspChain, dspGainDb, eqBands, limiterEnabled, t]
  );

  const handleApplyCrossfadeSettings = useCallback(async () => {
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
        crossfadeSettings,
        TAURI_EVENTS.NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED
      );
      appendLog(
        t('pages.native-debug.log.crossfadeUpdated', {
          state: crossfadeSettings.enabled ? t('common.state.on') : t('common.state.off'),
          durationMs: Math.round(crossfadeSettings.durationMs),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.crossfadeUpdateFailed', { message }));
    }
  }, [appendLog, crossfadeSettings, t]);

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
        t('pages.native-debug.log.replayGainUpdated', {
          state: replayGainSettings.enabled ? t('common.state.on') : t('common.state.off'),
          mode: replayGainSettings.mode,
          preampDb: replayGainSettings.preampDb.toFixed(1),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.replayGainUpdateFailed', { message }));
    }
  }, [appendLog, audioService, replayGainSettings, t]);

  const handleSelectTrack = useCallback(async () => {
    setIsSelectingFile(true);
    setLastError(null);
    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: t('pages.native-debug.filePicker.filter.audioFiles'), extensions: SUPPORTED_EXTENSIONS }],
      });

      if (!selected) {
        appendLog(t('pages.native-debug.log.filePicker.cancelled'));
        return;
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        appendLog(t('pages.native-debug.log.filePicker.invalidSelection'));
        return;
      }

      const track: Track = {
        id: `native-${Date.now()}`,
        title: getFileName(filePath, t('common.unknown.audioFile')),
        filePath,
        path: filePath,
        originalPath: filePath,
      };

      audioService.clearQueue();
      audioService.addToQueue(track);
      appendLog(t('pages.native-debug.log.fileLoaded', { title: track.title }));
      await audioService.playTrackAtIndex(0);
      appendLog(t('pages.native-debug.log.playCommandSent'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      appendLog(t('pages.native-debug.log.fileLoadFailed', { message }));
    } finally {
      setIsSelectingFile(false);
    }
  }, [appendLog, audioService, t]);

  const handlePlay = useCallback(async () => {
    if (state.playbackState === 'paused' && state.currentTrack) {
      await audioService.play();
      appendLog(t('pages.native-debug.log.play.resumed'));
      return;
    }

    if (!state.currentTrack && state.queue.length > 0) {
      const index = state.currentIndex >= 0 ? state.currentIndex : 0;
      await audioService.playTrackAtIndex(index);
      appendLog(t('pages.native-debug.log.play.fromQueueIndex', { index }));
      return;
    }

    if (state.currentTrack) {
      await audioService.play();
      appendLog(t('pages.native-debug.log.play.currentTrack'));
      return;
    }

    appendLog(t('pages.native-debug.log.play.noTracks'));
  }, [audioService, appendLog, state.currentIndex, state.currentTrack, state.playbackState, state.queue.length, t]);

  const handleStop = useCallback(() => {
    audioService.stop();
    appendLog(t('pages.native-debug.log.stop'));
  }, [audioService, appendLog, t]);

  const handleNext = useCallback(async () => {
    await audioService.playNext();
    appendLog(t('pages.native-debug.log.play.next'));
  }, [audioService, appendLog, t]);

  const handlePrev = useCallback(async () => {
    await audioService.playPrevious();
    appendLog(t('pages.native-debug.log.play.prev'));
  }, [audioService, appendLog, t]);

  const handleVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      audioService.setVolume(value);
      appendLog(t('pages.native-debug.log.volumeChanged', { value: value.toFixed(2) }));
    },
    [audioService, appendLog, t]
  );

  const handleToggleMute = useCallback(() => {
    audioService.toggleMute();
    appendLog(t('pages.native-debug.log.muteToggled'));
  }, [audioService, appendLog, t]);

  const handleTogglePlayPause = useCallback(async () => {
    if (state.playbackState === 'playing') {
      await audioService.pause();
      appendLog(t('pages.native-debug.log.pause'));
      return;
    }
    await handlePlay();
  }, [appendLog, handlePlay, audioService, state.playbackState, t]);

  const handleQueuePlay = useCallback(
    async (index: number) => {
      await audioService.playTrackAtIndex(index);
      appendLog(t('pages.native-debug.log.queue.playIndex', { index }));
    },
    [audioService, appendLog, t]
  );

  const handleQueueRemove = useCallback(
    (index: number) => {
      audioService.removeFromQueue(index);
      appendLog(t('pages.native-debug.log.queue.removeIndex', { index }));
    },
    [audioService, appendLog, t]
  );

  const handleClearQueue = useCallback(() => {
    audioService.clearQueue();
    appendLog(t('pages.native-debug.log.queue.cleared'));
  }, [audioService, appendLog, t]);

  const displayedState = useMemo(() => JSON.stringify(state, null, 2), [state]);

  if (!isNativeEngine) {
    return (
      <div className="native-debug-page">
        <div className="native-debug-card native-debug-warning">
          <h2>{t('pages.native-debug.notNative.title')}</h2>
          <p>{t('pages.native-debug.notNative.desc')}</p>
        </div>
      </div>
    );
  }

  const eqBandKindLabel = (kind: NativeDspEqBandKind) => {
    if (kind === 'low-shelf') return t('pages.native-debug.eq.kind.lowShelf');
    if (kind === 'high-shelf') return t('pages.native-debug.eq.kind.highShelf');
    return t('pages.native-debug.eq.kind.peaking');
  };

  return (
    <div className="native-debug-page">
      <div className="native-debug-layout">
        <section className="native-debug-card native-debug-controls">
          <header>
            <div>
              <p className="section-label">{t('pages.native-debug.section.controls')}</p>
              <h2>{t('pages.native-debug.title')}</h2>
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
              {isSelectingFile ? t('common.state.loading') : t('pages.native-debug.action.selectAudioFile')}
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
                    nativeMeta.replayGainDb === null ? '—' : `${nativeMeta.replayGainDb.toFixed(1)} dB`,
                })}
              </p>
              <p className="device-hint">
                {t('pages.native-debug.replayGain.trackTag', {
                  value:
                    typeof state.currentTrack?.replayGainTrackGainDb === 'number'
                      ? `${state.currentTrack.replayGainTrackGainDb.toFixed(1)} dB`
                      : '—',
                })}{' '}
                ·{' '}
                {t('pages.native-debug.replayGain.albumTag', {
                  value:
                    typeof state.currentTrack?.replayGainAlbumGainDb === 'number'
                      ? `${state.currentTrack.replayGainAlbumGainDb.toFixed(1)} dB`
                      : '—',
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
              <p className="device-label">{t('pages.native-debug.outputDevice.title')}</p>
              <p className="device-value">{nativeMeta.device ?? t('pages.native-debug.outputDevice.default')}</p>
              <p className="device-hint">
                {nativeMeta.sampleRate ? `${nativeMeta.sampleRate} Hz` : '—'} ·{' '}
                {nativeMeta.bitDepth ? `${nativeMeta.bitDepth} bit` : '—'}
              </p>
            </div>
            <div className="device-controls">
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                aria-label={t('pages.native-debug.outputDevice.select.ariaLabel')}
              >
                <option value="">{t('pages.native-debug.outputDevice.default')}</option>
                {outputDevices.map((name) => (
                  <option key={name} value={name}>
                    {name}
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

          <AudioVisualizer
            getFrequencyData={getFrequencyData}
            isPlaying={state.playbackState === 'playing'}
          />

          <div className="queue-actions">
            <div>
              <p className="section-label">{t('pages.native-debug.queue.title')}</p>
              <h3>{t('pages.native-debug.queue.count', { count: state.queue.length })}</h3>
            </div>
            <button type="button" onClick={handleClearQueue} disabled={!state.queue.length}>
              {t('common.action.clear')}
            </button>
          </div>

          <ul className="debug-queue">
            {state.queue.length === 0 && <li className="queue-empty">{t('pages.native-debug.queue.empty')}</li>}
            {state.queue.map((track, index) => (
              <li key={track.id} data-active={index === state.currentIndex}>
                <div>
                  <p className="queue-track-title">{track.title}</p>
                  <p className="queue-track-meta">{track.originalPath || track.path}</p>
                </div>
                <div className="queue-buttons">
                  <button type="button" onClick={() => handleQueuePlay(index)}>
                    {t('common.action.play')}
                  </button>
                  <button type="button" onClick={() => handleQueueRemove(index)}>
                    {t('common.action.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {lastError && (
            <p className="error-banner">{t('pages.native-debug.lastError', { message: lastError })}</p>
          )}
        </section>

        <section className="native-debug-card native-debug-state-panel">
          <header>
            <p className="section-label">{t('pages.native-debug.section.state')}</p>
            <h3>{t('pages.native-debug.state.snapshotTitle')}</h3>
          </header>
          <pre className="native-debug-state">{displayedState}</pre>
          <div className="native-debug-logs">
            <p className="section-label">{t('pages.native-debug.section.logs')}</p>
            <ul>
              {logs.length === 0 && <li className="log-empty">{t('pages.native-debug.logs.empty')}</li>}
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
