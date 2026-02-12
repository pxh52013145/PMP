import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './NativeDebugPage.css';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { useLocale, useT } from '../../i18n';
import { AudioRobustnessSnapshot, Track } from '../../services/audio';
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

type NativeAudioOutputDevice = {
  id: string;
  name: string;
  isDefault: boolean;
};

function parseNativeAudioOutputDevices(payload: unknown): NativeAudioOutputDevice[] {
  if (!Array.isArray(payload)) return [];

  const devices: NativeAudioOutputDevice[] = [];
  const seen = new Set<string>();
  for (const entry of payload) {
    const record = asRecord(entry);
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    if (!id || !name) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    devices.push({
      id,
      name,
      isDefault: typeof record?.isDefault === 'boolean' ? record.isDefault : false,
    });
  }

  devices.sort((a, b) => a.name.localeCompare(b.name));
  return devices;
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

type NativeAudioSrcMode = 'source-native' | 'match-output' | 'target-rate';
type NativeAudioSrcBackend = 'rubato' | 'linear-simd';
type NativeAudioSrcPresetId = 'balanced' | 'hi-end' | 'low-latency';

type NativeAudioEnginePolicyPayload = {
  srcMode?: NativeAudioSrcMode;
  srcBackend?: NativeAudioSrcBackend;
  srcTargetSampleRate?: number | null;
};

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

const EMPTY_ROBUSTNESS: AudioRobustnessSnapshot = {
  outputBackendId: null,
  outputBackends: [],
  underrunEvents: 0,
  underrunFrames: 0,
  underrunEventsWindow: 0,
  underrunRecoveryActive: false,
  protectionWindowActive: false,
  protectionRefCount: 0,
  protectionReason: null,
  autoSwitchCount: 0,
  lastAutoSwitchAtMs: null,
  lastAutoSwitchReason: null,
  bufferedAheadSeconds: 0,
  bufferedAheadMinSeconds: null,
  bufferedAheadAvgSeconds: null,
  rebufferCount: 0,
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
  const [outputDevices, setOutputDevices] = useState<NativeAudioOutputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [replayGainSettings, setReplayGainSettings] = useState<ReplayGainSettings>({
    enabled: true,
    mode: 'track',
    preampDb: 0,
  });
  const [crossfadeSettings, setCrossfadeSettings] = useState<CrossfadeSettings>({
    enabled: false,
    durationMs: 1200,
  });
  const [srcMode, setSrcMode] = useState<NativeAudioSrcMode>('match-output');
  const [srcBackend, setSrcBackend] = useState<NativeAudioSrcBackend>('rubato');
  const [srcTargetRate, setSrcTargetRate] = useState<string>('96000');
  const [srcPresetId, setSrcPresetId] = useState<NativeAudioSrcPresetId>('balanced');
  const [dynamicSrcSettings, setDynamicSrcSettings] = useState<NativeAudioDynamicSrcSettings>({
    enabled: true,
    adaptiveEnabled: true,
    learningEnabled: true,
    restoreDebounceMs: 4000,
    minSwitchIntervalMs: 600,
    seekHoldMs: 2000,
    underrunHoldMs: 12000,
    sharedStressHoldMs: 8000,
    outputErrorHoldMs: 10000,
  });
  const [robustness, setRobustness] = useState<AudioRobustnessSnapshot>(() =>
    audioService.getRobustnessSnapshot?.() ?? EMPTY_ROBUSTNESS
  );

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
    const unsubscribeRobustness =
      audioService.onRobustnessSnapshot?.((next) => setRobustness(next)) ?? (() => {});
    const unsubscribeError = audioService.onError((error) => {
      const message = error?.message ?? String(error);
      setLastError(message);
      appendLog(t('pages.native-debug.log.error', { message }));
    });
    return () => {
      unsubscribeState();
      unsubscribeRobustness();
      unsubscribeError();
    };
  }, [audioService, appendLog, t]);

  const isNativeEngine = isNativeAvailable;

  useEffect(() => {
    if (!isNativeEngine) return;
    const persisted = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE);
    if (typeof persisted === 'string') {
      setSelectedDeviceId(persisted);
      return;
    }

    const record = asRecord(persisted);
    const id = typeof record?.id === 'string' ? record.id : '';
    if (id) {
      setSelectedDeviceId(id);
      return;
    }

    if (persisted === null) {
      setSelectedDeviceId('');
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
      setSelectedDeviceId((previous) => previous || device || '');
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
    return artist ? `${title} — ${artist}` : title;
  }, [state.currentTrack, t]);

  const parseSrcTargetRate = useCallback((value: string): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(8000, Math.min(768000, Math.floor(parsed)));
  }, []);

  const detectSrcPreset = useCallback(
    (
      mode: NativeAudioSrcMode,
      backend: NativeAudioSrcBackend,
      targetRate: number | null
    ): NativeAudioSrcPresetId => {
      if (mode === 'target-rate' && backend === 'rubato' && targetRate === 192000) {
        return 'hi-end';
      }
      if (mode === 'match-output' && backend === 'linear-simd') {
        return 'low-latency';
      }
      return 'balanced';
    },
    []
  );

  const applySrcPolicyState = useCallback(
    (payload: NativeAudioEnginePolicyPayload) => {
      const mode =
        payload.srcMode === 'source-native' ||
        payload.srcMode === 'match-output' ||
        payload.srcMode === 'target-rate'
          ? payload.srcMode
          : 'match-output';
      const backend =
        payload.srcBackend === 'rubato' || payload.srcBackend === 'linear-simd'
          ? payload.srcBackend
          : 'rubato';
      const targetRate =
        typeof payload.srcTargetSampleRate === 'number' && Number.isFinite(payload.srcTargetSampleRate)
          ? Math.max(8000, Math.min(768000, Math.floor(payload.srcTargetSampleRate)))
          : null;

      setSrcMode(mode);
      setSrcBackend(backend);
      setSrcTargetRate(String(targetRate ?? 96000));
      setSrcPresetId(detectSrcPreset(mode, backend, targetRate));
    },
    [detectSrcPreset]
  );

  const readDynamicSrcAutoSettings = useCallback((): NativeAudioDynamicSrcSettings => {
    const getter = audioService.getDynamicSrcAutoSettings;
    if (!getter) {
      return {
        enabled: true,
        adaptiveEnabled: true,
        learningEnabled: true,
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      };
    }
    try {
      const settings = getter.call(audioService);
      return {
        enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : true,
        adaptiveEnabled:
          typeof settings?.adaptiveEnabled === 'boolean' ? settings.adaptiveEnabled : true,
        learningEnabled:
          typeof settings?.learningEnabled === 'boolean' ? settings.learningEnabled : true,
        restoreDebounceMs:
          typeof settings?.restoreDebounceMs === 'number' ? settings.restoreDebounceMs : 4000,
        minSwitchIntervalMs:
          typeof settings?.minSwitchIntervalMs === 'number' ? settings.minSwitchIntervalMs : 600,
        seekHoldMs: typeof settings?.seekHoldMs === 'number' ? settings.seekHoldMs : 2000,
        underrunHoldMs:
          typeof settings?.underrunHoldMs === 'number' ? settings.underrunHoldMs : 12000,
        sharedStressHoldMs:
          typeof settings?.sharedStressHoldMs === 'number' ? settings.sharedStressHoldMs : 8000,
        outputErrorHoldMs:
          typeof settings?.outputErrorHoldMs === 'number' ? settings.outputErrorHoldMs : 10000,
      };
    } catch {
      return {
        enabled: true,
        adaptiveEnabled: true,
        learningEnabled: true,
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      };
    }
  }, [audioService]);

  const applyDynamicSrcAutoSettings = useCallback(
    async (patch: Partial<NativeAudioDynamicSrcSettings>) => {
      const setter = audioService.setDynamicSrcAutoSettings;
      if (!setter) return;

      const nextSettings: NativeAudioDynamicSrcSettings = {
        ...dynamicSrcSettings,
        ...patch,
      };

      setDynamicSrcSettings(nextSettings);
      try {
        await setter.call(audioService, nextSettings);
        if (typeof patch.enabled === 'boolean') {
          appendLog(
            patch.enabled
              ? t('pages.native-debug.log.dynamicSrcAutoEnabled')
              : t('pages.native-debug.log.dynamicSrcAutoDisabled')
          );
        } else {
          appendLog(t('pages.native-debug.log.dynamicSrcParamsUpdated'));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDynamicSrcSettings(dynamicSrcSettings);
        appendLog(t('pages.native-debug.log.dynamicSrcAutoUpdateFailed', { message }));
      }
    },
    [appendLog, audioService, dynamicSrcSettings, t]
  );

  const fetchEnginePolicy = useCallback(async () => {
    try {
      const payload = await invoke<unknown>('native_audio_get_engine_policy');
      const record = asRecord(payload);
      if (!record) return;
      applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.enginePolicyFetchFailed', { message }));
    }
  }, [appendLog, applySrcPolicyState, t]);

  useEffect(() => {
    if (!isNativeEngine) return;
    const settings = readDynamicSrcAutoSettings();
    setDynamicSrcSettings(settings);
  }, [isNativeEngine, readDynamicSrcAutoSettings]);

  const handleApplySrcPolicy = useCallback(async () => {
    const targetRate = parseSrcTargetRate(srcTargetRate);
    const shouldUseTarget = srcMode === 'target-rate';

    try {
      const payload = await invoke<unknown>('native_audio_set_engine_policy', {
        srcMode,
        srcBackend,
        srcTargetSampleRate: shouldUseTarget ? targetRate : null,
      });
      const record = asRecord(payload);
      if (record) {
        applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
      }

      appendLog(
        t('pages.native-debug.log.srcPolicyApplied', {
          mode: srcMode,
          backend: srcBackend,
          targetRate: shouldUseTarget ? targetRate ?? 0 : 0,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.srcPolicyApplyFailed', { message }));
    }
  }, [
    appendLog,
    applySrcPolicyState,
    parseSrcTargetRate,
    srcBackend,
    srcMode,
    srcTargetRate,
    t,
  ]);

  const handleApplySrcPreset = useCallback(
    async (presetId: NativeAudioSrcPresetId) => {
      let nextMode: NativeAudioSrcMode = 'match-output';
      let nextBackend: NativeAudioSrcBackend = 'rubato';
      let nextTarget: number | null = null;

      if (presetId === 'hi-end') {
        nextMode = 'target-rate';
        nextBackend = 'rubato';
        nextTarget = 192000;
      } else if (presetId === 'low-latency') {
        nextMode = 'match-output';
        nextBackend = 'linear-simd';
      }

      setSrcPresetId(presetId);
      setSrcMode(nextMode);
      setSrcBackend(nextBackend);
      if (nextTarget) {
        setSrcTargetRate(String(nextTarget));
      }

      try {
        const payload = await invoke<unknown>('native_audio_set_engine_policy', {
          srcMode: nextMode,
          srcBackend: nextBackend,
          srcTargetSampleRate: nextMode === 'target-rate' ? nextTarget : null,
        });
        const record = asRecord(payload);
        if (record) {
          applySrcPolicyState(record as NativeAudioEnginePolicyPayload);
        }

        appendLog(
          t('pages.native-debug.log.srcPresetApplied', {
            preset: t(`pages.native-debug.src.preset.${presetId}`),
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(t('pages.native-debug.log.srcPolicyApplyFailed', { message }));
      }
    },
    [appendLog, applySrcPolicyState, t]
  );

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

    await fetchEnginePolicy();

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
  }, [appendLog, fetchEnginePolicy, t]);

  useEffect(() => {
    if (!isNativeEngine) return;
    void handleRefreshAudioComponents();
  }, [handleRefreshAudioComponents, isNativeEngine]);

  const handleRefreshDevices = useCallback(async () => {
    try {
      const payload = await invoke<unknown>('native_audio_list_devices_v2');
      const devices = parseNativeAudioOutputDevices(payload);
      setOutputDevices(devices);
      setSelectedDeviceId((previous) => {
        if (!previous) return previous;
        if (devices.some((device) => device.id === previous)) return previous;
        const matchByName = devices.find((device) => device.name === previous);
        return matchByName ? matchByName.id : previous;
      });
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
        setSelectedDeviceId('');
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
    const selected = selectedDeviceId.length > 0 ? outputDevices.find((device) => device.id === selectedDeviceId) ?? null : null;
    const deviceId = selected?.id ?? null;
    const deviceName = selected ? selected.name : selectedDeviceId.length > 0 ? selectedDeviceId : null;

    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_DEVICE,
        deviceId && deviceName ? { id: deviceId, name: deviceName } : null,
        TAURI_EVENTS.NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED
      );
      await invoke('native_audio_select_device', {
        deviceId,
        deviceName,
      });
      appendLog(
        t('pages.native-debug.log.outputDeviceSwitched', {
          device: deviceName || t('pages.native-debug.outputDevice.default'),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(t('pages.native-debug.log.outputDeviceSwitchFailed', { message }));
    }
  }, [appendLog, outputDevices, selectedDeviceId, t]);

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
  const displayedRobustness = useMemo(() => JSON.stringify(robustness, null, 2), [robustness]);
  const diagnosticTimelineRows = useMemo(
    () =>
      (robustness.diagnosticTimeline ?? []).map((event) => {
        const timestamp = new Date(event.timestampMs).toLocaleTimeString(locale);
        return `${timestamp} #${event.seq} ${event.kind} value=${event.value} aux=${event.aux}`;
      }),
    [locale, robustness.diagnosticTimeline]
  );

  const outputMetricsUnavailableLabel = useMemo(() => {
    if (robustness.outputCallbackMetricsValid !== false) {
      return t('pages.native-debug.robustness.output.metricsUnavailable');
    }

    return t('pages.native-debug.robustness.output.metricsUnavailableWithBackend', {
      backend: robustness.outputBackendId ?? t('common.state.unknown'),
    });
  }, [robustness.outputBackendId, robustness.outputCallbackMetricsValid, t]);

  const outputMonitorStatusLabel = useMemo(() => {
    if (robustness.outputCallbackMetricsValid === true) {
      return t('pages.native-debug.robustness.monitor.output.enabled');
    }
    if (robustness.outputCallbackMetricsValid === false) {
      return t('pages.native-debug.robustness.monitor.output.disabled', {
        backend: robustness.outputBackendId ?? t('common.state.unknown'),
      });
    }
    return t('common.state.unknown');
  }, [robustness.outputBackendId, robustness.outputCallbackMetricsValid, t]);

  const transferMonitorStatusLabel = useMemo(() => {
    const activeInputId = componentsState.activeInputId;
    if (robustness.transferMetricsValid === true) {
      return t('pages.native-debug.robustness.monitor.transfer.enabled', {
        inputId: activeInputId ?? t('common.state.unknown'),
      });
    }

    return t('pages.native-debug.robustness.monitor.transfer.disabled', {
      inputId: activeInputId ?? t('common.state.unknown'),
    });
  }, [componentsState.activeInputId, robustness.transferMetricsValid, t]);

  const robustnessMetricsView = useMemo(() => {
    const unknown = t('common.state.unknown');

    const formatCount = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : unknown;

    const formatSecondsValue = (value?: number | null) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;

    const formatSecondsLabel = (value?: number | null) => {
      const normalized = formatSecondsValue(value);
      return normalized === null ? unknown : `${normalized.toFixed(2)} s`;
    };

    const formatUs = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) ? `${Math.max(0, Math.floor(value))} μs` : unknown;

    const outputMetric = (value?: number, unit: 'count' | 'us' = 'count') => {
      if (robustness.outputCallbackMetricsValid === false) {
        return outputMetricsUnavailableLabel;
      }
      return unit === 'us' ? formatUs(value) : formatCount(value);
    };

    const srcBackend =
      robustness.srcBackend === 'rubato'
        ? t('pages.native-debug.src.backend.rubato')
        : robustness.srcBackend === 'linear-simd'
          ? t('pages.native-debug.src.backend.linear-simd')
          : unknown;

    const quantization =
      robustness.outputQuantizationMode === 'tpdf'
        ? 'TPDF Dither'
        : robustness.outputQuantizationMode === 'round'
          ? 'Round'
          : unknown;

    const bufferNowValue = formatSecondsValue(robustness.bufferedAheadSeconds) ?? 0;
    const bufferReferenceValue =
      typeof robustness.bufferedAheadMinSeconds === 'number' &&
      Number.isFinite(robustness.bufferedAheadMinSeconds) &&
      robustness.bufferedAheadMinSeconds > 0
        ? Math.max(robustness.bufferedAheadMinSeconds * 2, 0.5)
        : 1.5;

    const bufferPercent = Math.round(Math.max(0, Math.min((bufferNowValue / bufferReferenceValue) * 100, 100)));
    const bufferStatus =
      bufferNowValue < 0.15
        ? t('settings.audioAdvanced.monitor.bufferStatus.low')
        : bufferNowValue < 0.4
          ? t('settings.audioAdvanced.monitor.bufferStatus.guard')
          : t('settings.audioAdvanced.monitor.bufferStatus.stable');

    const outputSampleRate =
      typeof robustness.outputSampleRate === 'number' && Number.isFinite(robustness.outputSampleRate)
        ? `${Math.floor(robustness.outputSampleRate)} Hz`
        : unknown;

    return {
      backend: robustness.outputBackendId ?? unknown,
      scheduler: robustness.schedulerProfile ?? unknown,
      transport: robustness.transportMode ?? unknown,
      srcBackend,
      quantization,
      outputMonitorStatus: outputMonitorStatusLabel,
      transferMonitorStatus: transferMonitorStatusLabel,
      callbackP99: outputMetric(robustness.outputCallbackP99Us, 'us'),
      callbackJitterP99: outputMetric(robustness.outputCallbackIntervalJitterP99Us, 'us'),
      waitTimeout: outputMetric(robustness.outputWaitTimeoutCount),
      callbackOverrun: outputMetric(robustness.outputCallbackIntervalOverrunCount),
      outputUnderrunEvents: outputMetric(robustness.outputRenderUnderrunEvents),
      outputUnderrunFrames: outputMetric(robustness.outputRenderUnderrunFrames),
      bufferPercent,
      bufferStatus,
      bufferNow: formatSecondsLabel(robustness.bufferedAheadSeconds),
      bufferMin: formatSecondsLabel(robustness.bufferedAheadMinSeconds),
      bufferAvg: formatSecondsLabel(robustness.bufferedAheadAvgSeconds),
      rebuffer: formatCount(robustness.rebufferCount),
      engineUnderrunEvents: formatCount(robustness.underrunEvents),
      engineUnderrunWindow: formatCount(robustness.underrunEventsWindow),
      outputSampleRate,
      transferLowWatermark: formatCount(robustness.transferLowWatermarkSamples),
      transferRenderLowHits: formatCount(robustness.transferRenderLowHitCount),
      transferDecodeLowHits: formatCount(robustness.transferDecodeLowHitCount),
    };
  }, [
    outputMetricsUnavailableLabel,
    outputMonitorStatusLabel,
    robustness,
    t,
    transferMonitorStatusLabel,
  ]);

  const lastAutoSwitchLabel = useMemo(() => {
    if (!robustness.lastAutoSwitchAtMs) {
      return t('pages.native-debug.robustness.lastAutoSwitch.none');
    }

    const timestamp = new Date(robustness.lastAutoSwitchAtMs).toLocaleTimeString(locale);
    const reason = robustness.lastAutoSwitchReason || t('common.state.unknown');
    return t('pages.native-debug.robustness.lastAutoSwitch.value', { timestamp, reason });
  }, [locale, robustness.lastAutoSwitchAtMs, robustness.lastAutoSwitchReason, t]);

  const formatSeconds = useCallback(
    (value: number | null): string => {
      if (typeof value !== 'number' || !isFinite(value)) {
        return t('common.state.unknown');
      }
      return `${value.toFixed(2)}s`;
    },
    [t]
  );

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
                路{' '}
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

          <div className="device-row">
            <div className="device-meta">
              <p className="device-label">{t('pages.native-debug.outputDevice.title')}</p>
              <p className="device-value">{nativeMeta.device ?? t('pages.native-debug.outputDevice.default')}</p>
              <p className="device-hint">
                {nativeMeta.sampleRate ? `${nativeMeta.sampleRate} Hz` : '—'} {'·'}{' '}
                {nativeMeta.bitDepth ? `${nativeMeta.bitDepth} bit` : '—'}
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

          <AudioVisualizer
            getFrequencyData={getFrequencyData}
            isPlaying={state.playbackState === 'playing'}
          />

          <div className="native-debug-robustness-panel">
            <div className="queue-actions">
              <div>
                <p className="section-label">{t('pages.native-debug.robustness.title')}</p>
                <h3>{t('pages.native-debug.robustness.subtitle')}</h3>
              </div>
            </div>

            <div className="native-debug-metrics-panel">
              <section className="native-debug-metrics-section">
                <p className="native-debug-metrics-section-title">
                  {t('settings.audioAdvanced.monitor.section.context')}
                </p>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.backend.current')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.backend}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.scheduler')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.scheduler}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transport.mode')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.transport}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.src.backend')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.srcBackend}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.quantization')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.quantization}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.monitor.output.title')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.outputMonitorStatus}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.monitor.transfer.title')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.transferMonitorStatus}</span>
                </div>
              </section>

              <div className="native-debug-metrics-divider" />

              <section className="native-debug-metrics-section">
                <p className="native-debug-metrics-section-title">
                  {t('settings.audioAdvanced.monitor.section.callback')}
                </p>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackP99')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.callbackP99}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackJitterP99')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.callbackJitterP99}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.waitTimeout')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.waitTimeout}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackOverrun')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.callbackOverrun}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.renderUnderrunEvents')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.outputUnderrunEvents}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.renderUnderrunFrames')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.outputUnderrunFrames}</span>
                </div>
              </section>

              <div className="native-debug-metrics-divider" />

              <section className="native-debug-metrics-section">
                <p className="native-debug-metrics-section-title">
                  {t('settings.audioAdvanced.monitor.section.buffer')}
                </p>
                <div className="native-debug-metrics-row native-debug-metrics-row--progress">
                  <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.bufferAhead')}</span>
                  <div className="native-debug-metrics-progress-track" role="presentation">
                    <div
                      className="native-debug-metrics-progress-fill"
                      style={{ width: `${robustnessMetricsView.bufferPercent}%` }}
                    />
                  </div>
                  <span className="native-debug-metrics-value">{`${robustnessMetricsView.bufferPercent}%`}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.now')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.bufferNow}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.min')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.bufferMin}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.avg')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.bufferAvg}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.bufferStatus')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.bufferStatus}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.rebuffer')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.rebuffer}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.underrun.events')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.engineUnderrunEvents}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.underrun.window')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.engineUnderrunWindow}</span>
                </div>
              </section>

              <div className="native-debug-metrics-divider" />

              <section className="native-debug-metrics-section">
                <p className="native-debug-metrics-section-title">
                  {t('settings.audioAdvanced.monitor.section.transfer')}
                </p>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.outputSampleRate')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.outputSampleRate}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.lowWatermark')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.transferLowWatermark}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.renderLowHits')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.transferRenderLowHits}</span>
                </div>
                <div className="native-debug-metrics-row">
                  <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.decodeLowHits')}</span>
                  <span className="native-debug-metrics-value">{robustnessMetricsView.transferDecodeLowHits}</span>
                </div>
              </section>
            </div>

            <div className="native-debug-robustness-grid">
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.backend.current')}</p>
                <p className="device-value">
                  {robustness.outputBackendId ?? t('pages.native-debug.outputBackend.default')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.backend.available')}</p>
                <p className="device-value">
                  {robustness.outputBackends.length > 0
                    ? robustness.outputBackends.join(', ')
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.monitor.output.title')}</p>
                <p className="device-value">{outputMonitorStatusLabel}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.monitor.transfer.title')}</p>
                <p className="device-value">{transferMonitorStatusLabel}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.underrun.events')}</p>
                <p className="device-value">{robustness.underrunEvents}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.underrun.frames')}</p>
                <p className="device-value">{robustness.underrunFrames}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.underrun.window')}</p>
                <p className="device-value">{robustness.underrunEventsWindow}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.recovery')}</p>
                <p className="device-value">
                  {robustness.underrunRecoveryActive ? t('common.state.on') : t('common.state.off')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transport.mode')}</p>
                <p className="device-value">{robustness.transportMode ?? t('common.state.unknown')}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.phase')}</p>
                <p className="device-value">{robustness.hqSrcPhaseMode ?? t('common.state.unknown')}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.src.mode')}</p>
                <p className="device-value">{robustness.srcMode ?? t('common.state.unknown')}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.src.backend')}</p>
                <p className="device-value">{robustness.srcBackend ?? t('common.state.unknown')}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.src.targetRate')}</p>
                <p className="device-value">
                  {typeof robustness.srcTargetSampleRate === 'number'
                    ? `${robustness.srcTargetSampleRate} Hz`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.enabled')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcAutoEnabled ? t('common.state.on') : t('common.state.off')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.profile')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcProfile ?? t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.adaptiveEnabled')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcAdaptiveEnabled ? t('common.state.on') : t('common.state.off')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.adaptiveProfile')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcAdaptiveProfile ?? t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.stressScore')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcStressScore === 'number'
                    ? String(robustness.dynamicSrcStressScore)
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.learningEnabled')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcLearningEnabled ? t('common.state.on') : t('common.state.off')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.learningScale')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcLearningScale === 'number'
                    ? robustness.dynamicSrcLearningScale.toFixed(3)
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.lastReason')}</p>
                <p className="device-value">
                  {robustness.dynamicSrcLastSwitchReason ?? t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.holdMs')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcHoldUntilMs === 'number'
                    ? `${robustness.dynamicSrcHoldUntilMs} ms`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.restoreDebounceMs')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcRestoreDebounceMs === 'number'
                    ? `${robustness.dynamicSrcRestoreDebounceMs} ms`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.minSwitchIntervalMs')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcMinSwitchIntervalMs === 'number'
                    ? `${robustness.dynamicSrcMinSwitchIntervalMs} ms`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.effectiveRestoreDebounceMs')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcEffectiveRestoreDebounceMs === 'number'
                    ? `${robustness.dynamicSrcEffectiveRestoreDebounceMs} ms`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.dynamic.effectiveMinSwitchIntervalMs')}</p>
                <p className="device-value">
                  {typeof robustness.dynamicSrcEffectiveMinSwitchIntervalMs === 'number'
                    ? `${robustness.dynamicSrcEffectiveMinSwitchIntervalMs} ms`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.stopband')}</p>
                <p className="device-value">
                  {typeof robustness.hqSrcStopbandDb === 'number'
                    ? `${robustness.hqSrcStopbandDb} dB`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.active')}</p>
                <p className="device-value">
                  {typeof robustness.hqSrcActive === 'boolean'
                    ? robustness.hqSrcActive
                      ? t('common.state.on')
                      : t('common.state.off')
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.ratio')}</p>
                <p className="device-value">
                  {typeof robustness.hqSrcRatio === 'number' && Number.isFinite(robustness.hqSrcRatio)
                    ? robustness.hqSrcRatio.toFixed(6)
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.sourceRate')}</p>
                <p className="device-value">
                  {typeof robustness.sourceSampleRate === 'number' &&
                  Number.isFinite(robustness.sourceSampleRate) &&
                  robustness.sourceSampleRate > 0
                    ? `${Math.floor(robustness.sourceSampleRate)} Hz`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.hq.outputRate')}</p>
                <p className="device-value">
                  {typeof robustness.outputSampleRate === 'number' &&
                  Number.isFinite(robustness.outputSampleRate) &&
                  robustness.outputSampleRate > 0
                    ? `${Math.floor(robustness.outputSampleRate)} Hz`
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transport.int32')}</p>
                <p className="device-value">
                  {typeof robustness.transportExactInt32Container === 'boolean'
                    ? robustness.transportExactInt32Container
                      ? t('common.state.on')
                      : t('common.state.off')
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.protection.active')}</p>
                <p className="device-value">
                  {robustness.protectionWindowActive ? t('common.state.on') : t('common.state.off')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.protection.reason')}</p>
                <p className="device-value">
                  {robustness.protectionReason ?? t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.protection.refCount')}</p>
                <p className="device-value">{robustness.protectionRefCount}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.buffer.now')}</p>
                <p className="device-value">{formatSeconds(robustness.bufferedAheadSeconds)}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.buffer.min')}</p>
                <p className="device-value">{formatSeconds(robustness.bufferedAheadMinSeconds)}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.buffer.avg')}</p>
                <p className="device-value">{formatSeconds(robustness.bufferedAheadAvgSeconds)}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.rebuffer')}</p>
                <p className="device-value">{robustness.rebufferCount}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.autoSwitch.count')}</p>
                <p className="device-value">{robustness.autoSwitchCount}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.autoSwitch.last')}</p>
                <p className="device-value">{lastAutoSwitchLabel}</p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.callbackP99')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputCallbackP99Us === 'number'
                    ? `${robustness.outputCallbackP99Us} μs`
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.waitTimeout')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputWaitTimeoutCount === 'number'
                    ? robustness.outputWaitTimeoutCount
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.renderUnderrunEvents')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputRenderUnderrunEvents === 'number'
                    ? robustness.outputRenderUnderrunEvents
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.renderUnderrunFrames')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputRenderUnderrunFrames === 'number'
                    ? robustness.outputRenderUnderrunFrames
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.callbackJitterP99')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputCallbackIntervalJitterP99Us === 'number'
                    ? `${robustness.outputCallbackIntervalJitterP99Us} μs`
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.callbackOverrun')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputCallbackIntervalOverrunCount === 'number'
                    ? robustness.outputCallbackIntervalOverrunCount
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.output.callbackExpectedInterval')}</p>
                <p className="device-value">
                  {robustness.outputCallbackMetricsValid === true &&
                  typeof robustness.outputCallbackExpectedIntervalUs === 'number'
                    ? `${robustness.outputCallbackExpectedIntervalUs} μs`
                    : robustness.outputCallbackMetricsValid === false
                      ? outputMetricsUnavailableLabel
                      : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transfer.lowWatermark')}</p>
                <p className="device-value">
                  {typeof robustness.transferLowWatermarkSamples === 'number'
                    ? robustness.transferLowWatermarkSamples
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transfer.renderLowHits')}</p>
                <p className="device-value">
                  {typeof robustness.transferRenderLowHitCount === 'number'
                    ? robustness.transferRenderLowHitCount
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transfer.decodeLowHits')}</p>
                <p className="device-value">
                  {typeof robustness.transferDecodeLowHitCount === 'number'
                    ? robustness.transferDecodeLowHitCount
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.shared.enabled')}</p>
                <p className="device-value">
                  {typeof robustness.sharedRenderAheadEnabled === 'boolean'
                    ? robustness.sharedRenderAheadEnabled
                      ? t('common.state.on')
                      : t('common.state.off')
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.shared.underrunEvents')}</p>
                <p className="device-value">
                  {typeof robustness.sharedRenderUnderrunEvents === 'number'
                    ? robustness.sharedRenderUnderrunEvents
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.shared.underrunFrames')}</p>
                <p className="device-value">
                  {typeof robustness.sharedRenderUnderrunFrames === 'number'
                    ? robustness.sharedRenderUnderrunFrames
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.shared.lowHits')}</p>
                <p className="device-value">
                  {typeof robustness.sharedRenderLowHitCount === 'number'
                    ? robustness.sharedRenderLowHitCount
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.shared.lowWatermark')}</p>
                <p className="device-value">
                  {typeof robustness.sharedRenderLowWatermarkSamples === 'number'
                    ? robustness.sharedRenderLowWatermarkSamples
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.transfer.pageLock')}</p>
                <p className="device-value">
                  {typeof robustness.renderQueuePageLocked === 'boolean'
                    ? robustness.renderQueuePageLocked
                      ? t('common.state.on')
                      : t('common.state.off')
                    : t('common.state.unknown')}
                </p>
              </div>
              <div className="robustness-item">
                <p className="device-label">{t('pages.native-debug.robustness.timeline.dropped')}</p>
                <p className="device-value">
                  {typeof robustness.diagnosticTimelineDroppedEvents === 'number'
                    ? robustness.diagnosticTimelineDroppedEvents
                    : t('common.state.unknown')}
                </p>
              </div>
            </div>
            <div className="native-debug-timeline">
              <p className="device-label">{t('pages.native-debug.robustness.timeline.title')}</p>
              {diagnosticTimelineRows.length > 0 ? (
                <ul>
                  {diagnosticTimelineRows.map((row, index) => (
                    <li key={`${index}-${row}`}>{row}</li>
                  ))}
                </ul>
              ) : (
                <p className="device-hint">{t('pages.native-debug.robustness.timeline.empty')}</p>
              )}
            </div>
            <pre className="native-debug-state">{displayedRobustness}</pre>
          </div>

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


