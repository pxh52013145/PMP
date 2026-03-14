import { invoke } from '@tauri-apps/api/tauri';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { broadcastDataUpdate, readData, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { resolveAudioTuningProfilePayload } from '../../services/audio/audioTuningProfiles';
import { PmpButton, PmpChoiceButton, PmpSegmented } from '../primitives';

type ReplayGainMode = 'track' | 'album';
type NativeAudioSrcMode = 'source-native' | 'match-output' | 'target-rate';
type NativeAudioSrcBackend = 'rubato' | 'linear-simd';
type NativeAudioOutputQuantizationMode = 'round' | 'tpdf';
type AudioTuningProfileId = 'extreme-ll' | 'll-guarded' | 'robust-shield';

type AudioTuningAutoSettings = {
  enabled: boolean;
  tickIntervalMs: number;
  stableWindowMs: number;
  minSwitchIntervalMs: number;
  postSwitchObserveWindowMs: number;
  elevatedStressScore: number;
  criticalStressScore: number;
  criticalUnderrunEventsWindow: number;
  criticalOverflowGrowthTicks: number;
};

type ReplayGainSettings = {
  enabled: boolean;
  mode: ReplayGainMode;
  preampDb: number;
};

type RuntimeControlSettings = {
  dynamicGainEnabled: boolean;
  volumeDebounceEnabled: boolean;
};

type CrossfadeSettings = {
  enabled: boolean;
  durationMs: number;
};

type DynamicSrcSettings = {
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

type EnginePolicyState = {
  transportMode: 'robust' | 'transport-exact';
  srcMode: NativeAudioSrcMode;
  srcBackend: NativeAudioSrcBackend;
  srcTargetSampleRate: number | null;
  outputQuantizationMode: NativeAudioOutputQuantizationMode;
};

const DEFAULT_REPLAYGAIN: ReplayGainSettings = {
  enabled: true,
  mode: 'track',
  preampDb: 0,
};

const DEFAULT_RUNTIME_CONTROL: RuntimeControlSettings = {
  dynamicGainEnabled: false,
  volumeDebounceEnabled: true,
};

const DEFAULT_CROSSFADE: CrossfadeSettings = {
  enabled: false,
  durationMs: 1200,
};

const DEFAULT_DYNAMIC_SRC: DynamicSrcSettings = {
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

const DEFAULT_TUNING_AUTO_SETTINGS: AudioTuningAutoSettings = {
  enabled: false,
  tickIntervalMs: 1500,
  stableWindowMs: 30_000,
  minSwitchIntervalMs: 10_000,
  postSwitchObserveWindowMs: 15_000,
  elevatedStressScore: 4,
  criticalStressScore: 8,
  criticalUnderrunEventsWindow: 2,
  criticalOverflowGrowthTicks: 2,
};

const AUDIO_TUNING_PROFILE_IDS: AudioTuningProfileId[] = [
  'extreme-ll',
  'll-guarded',
  'robust-shield',
];

const DEFAULT_ENGINE_POLICY: EnginePolicyState = {
  transportMode: 'robust',
  srcMode: 'match-output',
  srcBackend: 'rubato',
  srcTargetSampleRate: 96000,
  outputQuantizationMode: 'round',
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function parseReplayGainSettings(raw: unknown): ReplayGainSettings {
  const record = toRecord(raw);
  const enabled = typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_REPLAYGAIN.enabled;
  const mode = record?.mode === 'album' ? 'album' : 'track';
  const preampDbRaw = typeof record?.preampDb === 'number' ? record.preampDb : DEFAULT_REPLAYGAIN.preampDb;
  return {
    enabled,
    mode,
    preampDb: clampNumber(preampDbRaw, -18, 18),
  };
}

function parseRuntimeControlSettings(raw: unknown): RuntimeControlSettings {
  const record = toRecord(raw);
  const dynamicGainEnabled =
    typeof record?.dynamicGainEnabled === 'boolean'
      ? record.dynamicGainEnabled
      : typeof record?.dynamicFallbackEnabled === 'boolean'
        ? record.dynamicFallbackEnabled
        : DEFAULT_RUNTIME_CONTROL.dynamicGainEnabled;
  const volumeDebounceEnabled =
    typeof record?.volumeDebounceEnabled === 'boolean'
      ? record.volumeDebounceEnabled
      : DEFAULT_RUNTIME_CONTROL.volumeDebounceEnabled;

  return {
    dynamicGainEnabled,
    volumeDebounceEnabled,
  };
}

function parseCrossfadeSettings(raw: unknown): CrossfadeSettings {
  const record = toRecord(raw);
  const enabled = typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_CROSSFADE.enabled;
  const durationMsRaw = typeof record?.durationMs === 'number' ? record.durationMs : DEFAULT_CROSSFADE.durationMs;
  return {
    enabled,
    durationMs: Math.floor(clampNumber(durationMsRaw, 0, 30000)),
  };
}

function parseDynamicSrcSettings(raw: unknown): DynamicSrcSettings {
  const record = toRecord(raw);
  return {
    enabled: typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_DYNAMIC_SRC.enabled,
    adaptiveEnabled:
      typeof record?.adaptiveEnabled === 'boolean'
        ? record.adaptiveEnabled
        : DEFAULT_DYNAMIC_SRC.adaptiveEnabled,
    learningEnabled:
      typeof record?.learningEnabled === 'boolean'
        ? record.learningEnabled
        : DEFAULT_DYNAMIC_SRC.learningEnabled,
    restoreDebounceMs: Math.floor(
      clampNumber(
        typeof record?.restoreDebounceMs === 'number'
          ? record.restoreDebounceMs
          : DEFAULT_DYNAMIC_SRC.restoreDebounceMs,
        500,
        30000
      )
    ),
    minSwitchIntervalMs: Math.floor(
      clampNumber(
        typeof record?.minSwitchIntervalMs === 'number'
          ? record.minSwitchIntervalMs
          : DEFAULT_DYNAMIC_SRC.minSwitchIntervalMs,
        100,
        10000
      )
    ),
    seekHoldMs: Math.floor(
      clampNumber(
        typeof record?.seekHoldMs === 'number' ? record.seekHoldMs : DEFAULT_DYNAMIC_SRC.seekHoldMs,
        500,
        20000
      )
    ),
    underrunHoldMs: Math.floor(
      clampNumber(
        typeof record?.underrunHoldMs === 'number'
          ? record.underrunHoldMs
          : DEFAULT_DYNAMIC_SRC.underrunHoldMs,
        2000,
        120000
      )
    ),
    sharedStressHoldMs: Math.floor(
      clampNumber(
        typeof record?.sharedStressHoldMs === 'number'
          ? record.sharedStressHoldMs
          : DEFAULT_DYNAMIC_SRC.sharedStressHoldMs,
        1000,
        90000
      )
    ),
    outputErrorHoldMs: Math.floor(
      clampNumber(
        typeof record?.outputErrorHoldMs === 'number'
          ? record.outputErrorHoldMs
          : DEFAULT_DYNAMIC_SRC.outputErrorHoldMs,
        1000,
        120000
      )
    ),
  };
}

function parseAudioTuningAutoSettings(raw: unknown): AudioTuningAutoSettings {
  const record = toRecord(raw);

  const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.floor(clampNumber(value, min, max));
  };

  const elevatedStressScore = clampInt(
    record?.elevatedStressScore,
    DEFAULT_TUNING_AUTO_SETTINGS.elevatedStressScore,
    1,
    20
  );

  return {
    enabled:
      typeof record?.enabled === 'boolean' ? record.enabled : DEFAULT_TUNING_AUTO_SETTINGS.enabled,
    tickIntervalMs: clampInt(
      record?.tickIntervalMs,
      DEFAULT_TUNING_AUTO_SETTINGS.tickIntervalMs,
      500,
      10_000
    ),
    stableWindowMs: clampInt(
      record?.stableWindowMs,
      DEFAULT_TUNING_AUTO_SETTINGS.stableWindowMs,
      5_000,
      120_000
    ),
    minSwitchIntervalMs: clampInt(
      record?.minSwitchIntervalMs,
      DEFAULT_TUNING_AUTO_SETTINGS.minSwitchIntervalMs,
      1_000,
      120_000
    ),
    postSwitchObserveWindowMs: clampInt(
      record?.postSwitchObserveWindowMs,
      DEFAULT_TUNING_AUTO_SETTINGS.postSwitchObserveWindowMs,
      1_000,
      120_000
    ),
    elevatedStressScore,
    criticalStressScore: clampInt(
      record?.criticalStressScore,
      DEFAULT_TUNING_AUTO_SETTINGS.criticalStressScore,
      elevatedStressScore,
      30
    ),
    criticalUnderrunEventsWindow: clampInt(
      record?.criticalUnderrunEventsWindow,
      DEFAULT_TUNING_AUTO_SETTINGS.criticalUnderrunEventsWindow,
      1,
      12
    ),
    criticalOverflowGrowthTicks: clampInt(
      record?.criticalOverflowGrowthTicks,
      DEFAULT_TUNING_AUTO_SETTINGS.criticalOverflowGrowthTicks,
      1,
      8
    ),
  };
}

function parseEnginePolicy(raw: unknown): EnginePolicyState {
  const record = toRecord(raw);

  const transportMode =
    record?.transportMode === 'transport-exact' || record?.transportMode === 'robust'
      ? record.transportMode
      : DEFAULT_ENGINE_POLICY.transportMode;

  const srcMode =
    record?.srcMode === 'source-native' ||
    record?.srcMode === 'match-output' ||
    record?.srcMode === 'target-rate'
      ? record.srcMode
      : DEFAULT_ENGINE_POLICY.srcMode;

  const srcBackend =
    record?.srcBackend === 'linear-simd' || record?.srcBackend === 'rubato'
      ? record.srcBackend
      : DEFAULT_ENGINE_POLICY.srcBackend;

  const srcTargetSampleRate =
    typeof record?.srcTargetSampleRate === 'number' && Number.isFinite(record.srcTargetSampleRate)
      ? Math.floor(clampNumber(record.srcTargetSampleRate, 8000, 768000))
      : null;

  const outputQuantizationMode: NativeAudioOutputQuantizationMode =
    record?.outputQuantizationMode === 'tpdf' || record?.outputQuantizationMode === 'round'
      ? record.outputQuantizationMode
      : DEFAULT_ENGINE_POLICY.outputQuantizationMode;

  return {
    transportMode,
    srcMode,
    srcBackend,
    srcTargetSampleRate,
    outputQuantizationMode,
  };
}

function parseOutputBackendId(raw: unknown): string | null {
  const record = toRecord(raw);
  const backendId = typeof record?.outputBackendId === 'string' ? record.outputBackendId.trim() : '';
  return backendId.length > 0 ? backendId : null;
}

function isSameReplayGainSettings(a: ReplayGainSettings, b: ReplayGainSettings): boolean {
  return a.enabled === b.enabled && a.mode === b.mode && Math.abs(a.preampDb - b.preampDb) < 1e-6;
}

function isSameRuntimeControlSettings(a: RuntimeControlSettings, b: RuntimeControlSettings): boolean {
  return (
    a.dynamicGainEnabled === b.dynamicGainEnabled &&
    a.volumeDebounceEnabled === b.volumeDebounceEnabled
  );
}

function isSameCrossfadeSettings(a: CrossfadeSettings, b: CrossfadeSettings): boolean {
  return a.enabled === b.enabled && a.durationMs === b.durationMs;
}

function isSameEnginePolicyState(a: EnginePolicyState, b: EnginePolicyState): boolean {
  return (
    a.transportMode === b.transportMode &&
    a.srcMode === b.srcMode &&
    a.srcBackend === b.srcBackend &&
    a.srcTargetSampleRate === b.srcTargetSampleRate &&
    a.outputQuantizationMode === b.outputQuantizationMode
  );
}

function isSameDynamicSrcSettings(a: DynamicSrcSettings, b: DynamicSrcSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.adaptiveEnabled === b.adaptiveEnabled &&
    a.learningEnabled === b.learningEnabled &&
    a.restoreDebounceMs === b.restoreDebounceMs &&
    a.minSwitchIntervalMs === b.minSwitchIntervalMs &&
    a.seekHoldMs === b.seekHoldMs &&
    a.underrunHoldMs === b.underrunHoldMs &&
    a.sharedStressHoldMs === b.sharedStressHoldMs &&
    a.outputErrorHoldMs === b.outputErrorHoldMs
  );
}

function isSameTuningAutoSettings(a: AudioTuningAutoSettings, b: AudioTuningAutoSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.tickIntervalMs === b.tickIntervalMs &&
    a.stableWindowMs === b.stableWindowMs &&
    a.minSwitchIntervalMs === b.minSwitchIntervalMs &&
    a.postSwitchObserveWindowMs === b.postSwitchObserveWindowMs &&
    a.elevatedStressScore === b.elevatedStressScore &&
    a.criticalStressScore === b.criticalStressScore &&
    a.criticalUnderrunEventsWindow === b.criticalUnderrunEventsWindow &&
    a.criticalOverflowGrowthTicks === b.criticalOverflowGrowthTicks
  );
}

function resolveAudioTuningProfileId(
  policy: EnginePolicyState,
  dynamicSrc: DynamicSrcSettings
): AudioTuningProfileId | 'custom' {
  for (const profileId of AUDIO_TUNING_PROFILE_IDS) {
    const profile = resolveAudioTuningProfilePayload({
      profileId,
      outputBackendId: null,
    });

    const enginePolicyMatches =
      (typeof profile.enginePolicy.transportMode === 'undefined' ||
        profile.enginePolicy.transportMode === policy.transportMode) &&
      (typeof profile.enginePolicy.srcMode === 'undefined' ||
        profile.enginePolicy.srcMode === policy.srcMode) &&
      (typeof profile.enginePolicy.srcBackend === 'undefined' ||
        profile.enginePolicy.srcBackend === policy.srcBackend) &&
      (typeof profile.enginePolicy.srcTargetSampleRate === 'undefined' ||
        (profile.enginePolicy.srcTargetSampleRate ?? null) === policy.srcTargetSampleRate) &&
      (typeof profile.enginePolicy.outputQuantizationMode === 'undefined' ||
        profile.enginePolicy.outputQuantizationMode === policy.outputQuantizationMode);

    const dynamicSrcMatches =
      profile.dynamicSrcSettings.enabled === dynamicSrc.enabled &&
      profile.dynamicSrcSettings.adaptiveEnabled === dynamicSrc.adaptiveEnabled &&
      profile.dynamicSrcSettings.learningEnabled === dynamicSrc.learningEnabled &&
      profile.dynamicSrcSettings.restoreDebounceMs === dynamicSrc.restoreDebounceMs &&
      profile.dynamicSrcSettings.minSwitchIntervalMs === dynamicSrc.minSwitchIntervalMs &&
      profile.dynamicSrcSettings.seekHoldMs === dynamicSrc.seekHoldMs &&
      profile.dynamicSrcSettings.underrunHoldMs === dynamicSrc.underrunHoldMs &&
      profile.dynamicSrcSettings.sharedStressHoldMs === dynamicSrc.sharedStressHoldMs &&
      profile.dynamicSrcSettings.outputErrorHoldMs === dynamicSrc.outputErrorHoldMs;

    if (enginePolicyMatches && dynamicSrcMatches) {
      return profileId;
    }
  }

  return 'custom';
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildInlineMeterStyle(value: number): CSSProperties {
  const percent = clampPercent(value);
  return {
    '--settings-inline-meter': `${percent}%`,
  } as CSSProperties;
}

function normalizeRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  const clamped = clampNumber(value, min, max);
  return (clamped - min) / (max - min);
}

function estimateEnginePolicyCost(policy: EnginePolicyState): number {
  let cost = policy.transportMode === 'robust' ? 12 : 8;

  if (policy.srcMode === 'source-native') {
    cost += 6;
  } else if (policy.srcMode === 'match-output') {
    cost += policy.srcBackend === 'rubato' ? 24 : 12;
  } else {
    cost += policy.srcBackend === 'rubato' ? 34 : 18;
    const targetRate = policy.srcTargetSampleRate ?? 48_000;
    if (targetRate >= 192_000) {
      cost += 14;
    } else if (targetRate >= 96_000) {
      cost += 8;
    } else if (targetRate >= 88_200) {
      cost += 6;
    } else if (targetRate >= 48_000) {
      cost += 3;
    }
  }

  if (policy.outputQuantizationMode === 'tpdf') {
    cost += 6;
  }

  return clampPercent(cost);
}

function estimateDynamicSrcCost(dynamicSrc: DynamicSrcSettings): number {
  if (!dynamicSrc.enabled) return 0;

  let cost = 9;
  if (dynamicSrc.adaptiveEnabled) cost += 9;
  if (dynamicSrc.learningEnabled) cost += 7;

  cost += normalizeRange(dynamicSrc.restoreDebounceMs, 200, 30_000) * 6;
  cost += normalizeRange(dynamicSrc.minSwitchIntervalMs, 100, 10_000) * 5;
  cost += normalizeRange(dynamicSrc.seekHoldMs, 500, 20_000) * 9;
  cost += normalizeRange(dynamicSrc.underrunHoldMs, 2_000, 120_000) * 8;
  cost += normalizeRange(dynamicSrc.sharedStressHoldMs, 1_000, 90_000) * 7;
  cost += normalizeRange(dynamicSrc.outputErrorHoldMs, 1_000, 120_000) * 6;

  return clampPercent(cost);
}

function estimateCrossfadeCost(crossfade: CrossfadeSettings): number {
  if (!crossfade.enabled) return 0;
  const durationFactor = normalizeRange(crossfade.durationMs, 100, 10_000);
  return clampPercent(8 + durationFactor * 28);
}

function estimateReplayGainCost(replayGain: ReplayGainSettings): number {
  if (!replayGain.enabled) return 0;
  const modeCost = replayGain.mode === 'album' ? 3 : 2;
  const preampCost = Math.min(8, Math.abs(replayGain.preampDb) / 2.5);
  return clampPercent(4 + modeCost + preampCost);
}

function estimateRuntimeControlCost(runtimeControl: RuntimeControlSettings): number {
  const dynamicGainCost = runtimeControl.dynamicGainEnabled ? 6 : 0;
  const debounceCost = runtimeControl.volumeDebounceEnabled ? 2 : 0;
  return clampPercent(dynamicGainCost + debounceCost);
}

type SettingHelpLabelProps = {
  title: string;
  help: string;
};

type AdvancedParamHeadProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  costPercent: number;
  pendingApply?: boolean;
};

function SettingHelpLabel({ title, help }: SettingHelpLabelProps) {
  return (
    <div className="settings-inline-title-wrap">
      <p className="settings-inline-row-title">{title}</p>
      <PmpButton
        type="button"
        variant="ghost"
        className="settings-inline-help"
        aria-label={help}
        title={help}
      >
        ?
      </PmpButton>
    </div>
  );
}

function AdvancedParamHead({
  eyebrow,
  title,
  subtitle,
  costPercent,
  pendingApply = false,
}: AdvancedParamHeadProps) {
  const t = useT();
  const percent = clampPercent(costPercent);

  return (
    <div className="settings-param-head settings-param-head--meter">
      <div className="settings-param-head-copy">
        <p className="settings-param-eyebrow">{eyebrow}</p>
        <h3 className="settings-param-title">{title}</h3>
        <p className="settings-param-subtitle">
          {subtitle}
          {pendingApply ? t('settings.audioAdvanced.pendingApplySuffix') : ''}
        </p>
      </div>
      <div className="settings-param-head-meter" role="presentation" aria-hidden="true">
        <span className="settings-param-head-meter-track">
          <span className="settings-param-head-meter-fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="settings-param-head-meter-value">{percent}%</span>
      </div>
    </div>
  );
}

type SettingsChoiceGroupProps = {
  children: ReactNode;
  className?: string;
};

type SettingsChoiceButtonProps = Omit<ComponentPropsWithoutRef<typeof PmpChoiceButton>, 'className'>;

type SettingsActionButtonProps = Omit<ComponentPropsWithoutRef<typeof PmpButton>, 'className' | 'variant'> & {
  className?: string;
};

function SettingsChoiceGroup({
  children,
  className = 'settings-inline-row-controls',
}: SettingsChoiceGroupProps) {
  return (
    <PmpSegmented className={className} surfaceId="primitive.segmented.toggle">
      {children}
    </PmpSegmented>
  );
}

function SettingsChoiceButton(props: SettingsChoiceButtonProps) {
  return <PmpChoiceButton className="settings-choice-btn" {...props} />;
}

function SettingsActionButton({ className, ...props }: SettingsActionButtonProps) {
  return (
    <PmpButton
      variant="default"
      className={['settings-action-btn', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export function AudioEngineAdvancedSettingsPanel() {
  const t = useT();
  const audioService = useAudioService();
  const { isNativeAvailable } = useAudioEngine();
  const isTauri = isTauriRuntime();
  const canUse = isTauri && isNativeAvailable;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replayGain, setReplayGain] = useState<ReplayGainSettings>(() =>
    parseReplayGainSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS))
  );
  const [appliedReplayGain, setAppliedReplayGain] = useState<ReplayGainSettings>(replayGain);
  const [runtimeControl, setRuntimeControl] = useState<RuntimeControlSettings>(() =>
    parseRuntimeControlSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS))
  );
  const [appliedRuntimeControl, setAppliedRuntimeControl] =
    useState<RuntimeControlSettings>(runtimeControl);
  const [crossfade, setCrossfade] = useState<CrossfadeSettings>(() =>
    parseCrossfadeSettings(readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS))
  );
  const [appliedCrossfade, setAppliedCrossfade] = useState<CrossfadeSettings>(crossfade);

  const [enginePolicy, setEnginePolicy] = useState<EnginePolicyState>(DEFAULT_ENGINE_POLICY);
  const [appliedEnginePolicy, setAppliedEnginePolicy] =
    useState<EnginePolicyState>(DEFAULT_ENGINE_POLICY);
  const [dynamicSrc, setDynamicSrc] = useState<DynamicSrcSettings>(DEFAULT_DYNAMIC_SRC);
  const [appliedDynamicSrc, setAppliedDynamicSrc] = useState<DynamicSrcSettings>(DEFAULT_DYNAMIC_SRC);
  const [tuningProfile, setTuningProfile] = useState<AudioTuningProfileId | 'custom'>('custom');
  const [appliedTuningProfile, setAppliedTuningProfile] =
    useState<AudioTuningProfileId | 'custom'>('custom');
  const [tuningAutoSettings, setTuningAutoSettings] =
    useState<AudioTuningAutoSettings>(DEFAULT_TUNING_AUTO_SETTINGS);
  const [appliedTuningAutoSettings, setAppliedTuningAutoSettings] =
    useState<AudioTuningAutoSettings>(DEFAULT_TUNING_AUTO_SETTINGS);
  const [outputBackendId, setOutputBackendId] = useState<string | null>(null);

  const sourceRateChoices = useMemo(() => [44100, 48000, 88200, 96000, 176400, 192000], []);
  const replayGainCost = useMemo(() => estimateReplayGainCost(replayGain), [replayGain]);
  const runtimeControlCost = useMemo(() => estimateRuntimeControlCost(runtimeControl), [runtimeControl]);
  const crossfadeCost = useMemo(() => estimateCrossfadeCost(crossfade), [crossfade]);
  const srcPolicyCost = useMemo(() => estimateEnginePolicyCost(enginePolicy), [enginePolicy]);
  const dynamicSrcCost = useMemo(() => estimateDynamicSrcCost(dynamicSrc), [dynamicSrc]);
  const targetRateFallback = DEFAULT_ENGINE_POLICY.srcTargetSampleRate ?? sourceRateChoices[0] ?? 48000;

  const isSharedOutputBackend = useMemo(() => {
    return (
      outputBackendId === 'wasapi' ||
      outputBackendId === 'wasapi-shared-raw' ||
      outputBackendId === 'rodio-cpal'
    );
  }, [outputBackendId]);

  const replayGainDirty = !isSameReplayGainSettings(replayGain, appliedReplayGain);
  const runtimeControlDirty = !isSameRuntimeControlSettings(runtimeControl, appliedRuntimeControl);
  const crossfadeDirty = !isSameCrossfadeSettings(crossfade, appliedCrossfade);
  const tuningProfileDirty = tuningProfile !== appliedTuningProfile;
  const tuningAutoDirty = !isSameTuningAutoSettings(tuningAutoSettings, appliedTuningAutoSettings);
  const enginePolicyDirty = !isSameEnginePolicyState(enginePolicy, appliedEnginePolicy);
  const dynamicSrcDirty = !isSameDynamicSrcSettings(dynamicSrc, appliedDynamicSrc);

  const refresh = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      const componentsPayload = await invoke<unknown>('native_audio_get_audio_components_state');
      setOutputBackendId(parseOutputBackendId(componentsPayload));

      const policyPayload = await invoke<unknown>('native_audio_get_engine_policy');
      const parsedPolicy = parseEnginePolicy(policyPayload);
      setEnginePolicy(parsedPolicy);
      setAppliedEnginePolicy(parsedPolicy);

      let parsedDynamicSrc = DEFAULT_DYNAMIC_SRC;

      const getter = audioService.getDynamicSrcAutoSettings;
      if (typeof getter === 'function') {
        const settings = getter.call(audioService);
        parsedDynamicSrc = parseDynamicSrcSettings(settings);
      } else {
        parsedDynamicSrc = parseDynamicSrcSettings(
          readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS)
        );
      }
      setDynamicSrc(parsedDynamicSrc);
      setAppliedDynamicSrc(parsedDynamicSrc);

      const resolvedTuningProfile = resolveAudioTuningProfileId(parsedPolicy, parsedDynamicSrc);
      setTuningProfile(resolvedTuningProfile);
      setAppliedTuningProfile(resolvedTuningProfile);

      const tuningAutoGetter = audioService.getAudioTuningAutoSettings;
      if (typeof tuningAutoGetter === 'function') {
        const parsedTuningAuto = parseAudioTuningAutoSettings(tuningAutoGetter.call(audioService));
        setTuningAutoSettings(parsedTuningAuto);
        setAppliedTuningAutoSettings(parsedTuningAuto);
      } else {
        const parsedTuningAuto = parseAudioTuningAutoSettings(
          readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS)
        );
        setTuningAutoSettings(parsedTuningAuto);
        setAppliedTuningAutoSettings(parsedTuningAuto);
      }

      const parsedReplayGain = parseReplayGainSettings(
        readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS)
      );
      setReplayGain(parsedReplayGain);
      setAppliedReplayGain(parsedReplayGain);

      const parsedRuntimeControl = parseRuntimeControlSettings(
        readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS)
      );
      setRuntimeControl(parsedRuntimeControl);
      setAppliedRuntimeControl(parsedRuntimeControl);

      const parsedCrossfade = parseCrossfadeSettings(
        readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS)
      );
      setCrossfade(parsedCrossfade);
      setAppliedCrossfade(parsedCrossfade);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setTuningProfile(resolveAudioTuningProfileId(enginePolicy, dynamicSrc));
  }, [dynamicSrc, enginePolicy]);

  useEffect(() => {
    if (
      enginePolicy.transportMode === 'transport-exact' &&
      enginePolicy.outputQuantizationMode !== 'round'
    ) {
      setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'round' }));
    }
  }, [enginePolicy.transportMode, enginePolicy.outputQuantizationMode]);

  useEffect(() => {
    if (!isSharedOutputBackend) return;
    if (enginePolicy.srcMode === 'target-rate') {
      setEnginePolicy((prev) => ({ ...prev, srcMode: 'match-output', srcTargetSampleRate: null }));
    }
  }, [enginePolicy.srcMode, isSharedOutputBackend]);

  const applyReplayGain = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
        replayGain,
        TAURI_EVENTS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS_UPDATED
      );

      const track = audioService.getState().currentTrack;
      const base = replayGain.mode === 'album' ? track?.replayGainAlbumGainDb : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && Number.isFinite(base);
      const effectiveDb = replayGain.enabled && hasBase ? base + replayGain.preampDb : 0;
      await invoke('native_audio_set_replay_gain', {
        db: clampNumber(effectiveDb, -30, 30),
      });
      setAppliedReplayGain(replayGain);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, replayGain]);

  const applyRuntimeControl = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS,
        runtimeControl,
        TAURI_EVENTS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS_UPDATED
      );

      await invoke('native_audio_set_dynamic_gain_enabled', {
        enabled: runtimeControl.dynamicGainEnabled,
      });

      const track = audioService.getState().currentTrack;
      const base = replayGain.mode === 'album' ? track?.replayGainAlbumGainDb : track?.replayGainTrackGainDb;
      const hasBase = typeof base === 'number' && Number.isFinite(base);
      const effectiveDb = replayGain.enabled && hasBase ? base + replayGain.preampDb : 0;
      await invoke('native_audio_set_replay_gain', {
        db: clampNumber(effectiveDb, -30, 30),
      });
      setAppliedRuntimeControl(runtimeControl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, replayGain, runtimeControl]);

  const applyCrossfade = useCallback(async () => {
    if (!canUse) return;

    setBusy(true);
    setError(null);
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
        crossfade,
        TAURI_EVENTS.NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED
      );
      setAppliedCrossfade(crossfade);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canUse, crossfade]);

  const applyEnginePolicy = useCallback(async () => {
    if (!canUse || typeof audioService.setEnginePolicy !== 'function') return;

    setBusy(true);
    setError(null);
    try {
      await audioService.setEnginePolicy({
        transportMode: enginePolicy.transportMode,
        srcMode: enginePolicy.srcMode,
        srcBackend: enginePolicy.srcBackend,
        srcTargetSampleRate: enginePolicy.srcMode === 'target-rate' ? enginePolicy.srcTargetSampleRate : null,
        outputQuantizationMode: enginePolicy.outputQuantizationMode,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, enginePolicy, refresh]);

  const applyDynamicSrc = useCallback(async () => {
    if (!canUse || typeof audioService.setDynamicSrcAutoSettings !== 'function') return;

    setBusy(true);
    setError(null);
    try {
      await audioService.setDynamicSrcAutoSettings(dynamicSrc);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, dynamicSrc, refresh]);

  const applyTuningAutoSettings = useCallback(async () => {
    if (!canUse || typeof audioService.setAudioTuningAutoSettings !== 'function') return;

    setBusy(true);
    setError(null);
    try {
      await audioService.setAudioTuningAutoSettings(tuningAutoSettings);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('settings.audioAdvanced.tuning.applyFailed', { message }));
    } finally {
      setBusy(false);
    }
  }, [audioService, canUse, refresh, t, tuningAutoSettings]);

  const applyTuningProfile = useCallback(
    async (profileId: AudioTuningProfileId) => {
      if (!canUse) return;
      if (typeof audioService.applyTuningProfile !== 'function') {
        setError(t('settings.audioAdvanced.tuning.unsupported'));
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await audioService.applyTuningProfile(profileId);
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(t('settings.audioAdvanced.tuning.applyFailed', { message }));
      } finally {
        setBusy(false);
      }
    },
    [audioService, canUse, refresh, t]
  );

  const applySelectedTuningProfile = useCallback(async () => {
    if (tuningProfile === 'custom') {
      return;
    }
    await applyTuningProfile(tuningProfile);
  }, [applyTuningProfile, tuningProfile]);

  return (
    <div className="settings-audio-panel settings-audio-panel--advanced">
      <div className="settings-audio-block" style={buildInlineMeterStyle(replayGainCost)}>
        <div className="settings-param-divider settings-param-divider--compact" />
        <AdvancedParamHead
          eyebrow={t('settings.audioAdvanced.replayGain.eyebrow')}
          title={t('settings.audioAdvanced.replayGain.title')}
          subtitle={t('settings.audioAdvanced.replayGain.subtitle')}
          costPercent={replayGainCost}
          pendingApply={replayGainDirty}
        />

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={replayGain.enabled}
                  onClick={() => setReplayGain((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!replayGain.enabled}
                  onClick={() => setReplayGain((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.replayGain.mode.label')}</p>
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={replayGain.mode === 'track'}
                  onClick={() => setReplayGain((prev) => ({ ...prev, mode: 'track' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.replayGain.mode.track')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={replayGain.mode === 'album'}
                  onClick={() => setReplayGain((prev) => ({ ...prev, mode: 'album' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.replayGain.mode.album')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.replayGain.preampDb')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={-18}
                  max={18}
                  step={0.5}
                  value={replayGain.preampDb}
                  onChange={(e) =>
                    setReplayGain((prev) => ({
                      ...prev,
                      preampDb: clampNumber(Number(e.target.value), -18, 18),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyReplayGain()}
                disabled={busy || !replayGainDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block" style={buildInlineMeterStyle(runtimeControlCost)}>
        <div className="settings-param-divider settings-param-divider--compact" />
        <AdvancedParamHead
          eyebrow={t('settings.audioAdvanced.runtimeControl.eyebrow')}
          title={t('settings.audioAdvanced.runtimeControl.title')}
          subtitle={t('settings.audioAdvanced.runtimeControl.subtitle')}
          costPercent={runtimeControlCost}
          pendingApply={runtimeControlDirty}
        />

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                  <SettingHelpLabel
                  title={t('settings.audioAdvanced.runtimeControl.dynamicGain.label')}
                  help={t('settings.audioAdvanced.runtimeControl.dynamicGain.help')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={runtimeControl.dynamicGainEnabled}
                  onClick={() =>
                    setRuntimeControl((prev) => ({
                      ...prev,
                      dynamicGainEnabled: true,
                    }))
                  }
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!runtimeControl.dynamicGainEnabled}
                  onClick={() =>
                    setRuntimeControl((prev) => ({
                      ...prev,
                      dynamicGainEnabled: false,
                    }))
                  }
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.runtimeControl.volumeDebounce.label')}
                  help={t('settings.audioAdvanced.runtimeControl.volumeDebounce.help')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={runtimeControl.volumeDebounceEnabled}
                  onClick={() =>
                    setRuntimeControl((prev) => ({
                      ...prev,
                      volumeDebounceEnabled: true,
                    }))
                  }
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!runtimeControl.volumeDebounceEnabled}
                  onClick={() =>
                    setRuntimeControl((prev) => ({
                      ...prev,
                      volumeDebounceEnabled: false,
                    }))
                  }
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyRuntimeControl()}
                disabled={busy || !runtimeControlDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block" style={buildInlineMeterStyle(crossfadeCost)}>
        <div className="settings-param-divider settings-param-divider--compact" />
        <AdvancedParamHead
          eyebrow={t('settings.audioAdvanced.crossfade.eyebrow')}
          title={t('settings.audioAdvanced.crossfade.title')}
          subtitle={t('settings.audioAdvanced.crossfade.subtitle')}
          costPercent={crossfadeCost}
          pendingApply={crossfadeDirty}
        />

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={crossfade.enabled}
                  onClick={() => setCrossfade((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!crossfade.enabled}
                  onClick={() => setCrossfade((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.crossfade.durationMs')}</p>
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={0}
                  max={30000}
                  step={100}
                  value={crossfade.durationMs}
                  onChange={(e) =>
                    setCrossfade((prev) => ({
                      ...prev,
                      durationMs: Math.floor(clampNumber(Number(e.target.value), 0, 30000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyCrossfade()}
                disabled={busy || !crossfadeDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block" style={buildInlineMeterStyle(srcPolicyCost)}>
        <div className="settings-param-divider settings-param-divider--compact" />
        <AdvancedParamHead
          eyebrow={t('settings.audioAdvanced.tuningPipeline.eyebrow')}
          title={t('settings.audioAdvanced.tuningPipeline.title')}
          subtitle={t('settings.audioAdvanced.tuningPipeline.subtitle')}
          costPercent={srcPolicyCost}
          pendingApply={tuningProfileDirty || tuningAutoDirty || enginePolicyDirty}
        />

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.tuning.auto.enabled')}</p>
                <p className="settings-inline-row-note">{t('settings.audioAdvanced.tuning.auto.note')}</p>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.label')}
                  help={t('settings.audioAdvanced.tuning.help')}
                />
                <p className="settings-inline-row-note">
                  {t('settings.audioAdvanced.tuning.current', {
                    profile: t(
                      `settings.audioAdvanced.tuning.profile.${
                        tuningProfile === 'custom' ? 'custom' : tuningProfile
                      }`
                    ),
                  })}
                </p>
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={tuningProfile === 'extreme-ll'}
                  onClick={() => setTuningProfile('extreme-ll')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.tuning.profile.extreme-ll')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={tuningProfile === 'll-guarded'}
                  onClick={() => setTuningProfile('ll-guarded')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.tuning.profile.ll-guarded')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={tuningProfile === 'robust-shield'}
                  onClick={() => setTuningProfile('robust-shield')}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.tuning.profile.robust-shield')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applySelectedTuningProfile()}
                disabled={busy || tuningProfile === 'custom' || !tuningProfileDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.enabled')}
                  help={t('settings.audioAdvanced.tuning.auto.help.enabled')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={tuningAutoSettings.enabled}
                  onClick={() => setTuningAutoSettings((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!tuningAutoSettings.enabled}
                  onClick={() => setTuningAutoSettings((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <details className="settings-inline-details">
              <summary className="settings-inline-details-summary">
                {t('settings.audioAdvanced.tuning.auto.advancedSummary')}
              </summary>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.tickIntervalMs')}
                  help={t('settings.audioAdvanced.tuning.auto.help.tickIntervalMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={500}
                  max={10000}
                  step={100}
                  value={tuningAutoSettings.tickIntervalMs}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      tickIntervalMs: Math.floor(clampNumber(Number(e.target.value), 500, 10000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.stableWindowMs')}
                  help={t('settings.audioAdvanced.tuning.auto.help.stableWindowMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={5000}
                  max={120000}
                  step={500}
                  value={tuningAutoSettings.stableWindowMs}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      stableWindowMs: Math.floor(clampNumber(Number(e.target.value), 5000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.minSwitchIntervalMs')}
                  help={t('settings.audioAdvanced.tuning.auto.help.minSwitchIntervalMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={120000}
                  step={500}
                  value={tuningAutoSettings.minSwitchIntervalMs}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      minSwitchIntervalMs: Math.floor(clampNumber(Number(e.target.value), 1000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.postSwitchObserveWindowMs')}
                  help={t('settings.audioAdvanced.tuning.auto.help.postSwitchObserveWindowMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={120000}
                  step={500}
                  value={tuningAutoSettings.postSwitchObserveWindowMs}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      postSwitchObserveWindowMs: Math.floor(
                        clampNumber(Number(e.target.value), 1000, 120000)
                      ),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.elevatedStressScore')}
                  help={t('settings.audioAdvanced.tuning.auto.help.elevatedStressScore')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={tuningAutoSettings.elevatedStressScore}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      elevatedStressScore: Math.floor(clampNumber(Number(e.target.value), 1, 20)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.criticalStressScore')}
                  help={t('settings.audioAdvanced.tuning.auto.help.criticalStressScore')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={tuningAutoSettings.elevatedStressScore}
                  max={30}
                  step={1}
                  value={tuningAutoSettings.criticalStressScore}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      criticalStressScore: Math.floor(
                        clampNumber(
                          Number(e.target.value),
                          prev.elevatedStressScore,
                          30
                        )
                      ),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.criticalUnderrunEventsWindow')}
                  help={t('settings.audioAdvanced.tuning.auto.help.criticalUnderrunEventsWindow')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1}
                  max={12}
                  step={1}
                  value={tuningAutoSettings.criticalUnderrunEventsWindow}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      criticalUnderrunEventsWindow: Math.floor(
                        clampNumber(Number(e.target.value), 1, 12)
                      ),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.tuning.auto.criticalOverflowGrowthTicks')}
                  help={t('settings.audioAdvanced.tuning.auto.help.criticalOverflowGrowthTicks')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={tuningAutoSettings.criticalOverflowGrowthTicks}
                  onChange={(e) =>
                    setTuningAutoSettings((prev) => ({
                      ...prev,
                      criticalOverflowGrowthTicks: Math.floor(clampNumber(Number(e.target.value), 1, 8)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            </details>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyTuningAutoSettings()}
                disabled={busy || !tuningAutoDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('settings.audioAdvanced.enginePolicy.section.title')}</p>
                <p className="settings-inline-row-note">{t('settings.audioAdvanced.enginePolicy.section.note')}</p>
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.transport.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.transport')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.transportMode === 'robust'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, transportMode: 'robust' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.transport.robust')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.transportMode === 'transport-exact'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, transportMode: 'transport-exact' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.transport.exact')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.srcMode.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.srcMode')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.srcMode === 'source-native'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcMode: 'source-native' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.sourceNative')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.srcMode === 'match-output'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcMode: 'match-output' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.matchOutput')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.srcMode === 'target-rate'}
                  onClick={() =>
                    setEnginePolicy((prev) => ({
                      ...prev,
                      srcMode: 'target-rate',
                      srcTargetSampleRate: prev.srcTargetSampleRate ?? targetRateFallback,
                    }))
                  }
                  disabled={busy || isSharedOutputBackend}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcMode.targetRate')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.enginePolicy.srcBackend.label')}
                  help={t('settings.audioAdvanced.enginePolicy.help.srcBackend')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.srcBackend === 'rubato'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcBackend: 'rubato' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcBackend.rubato')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={enginePolicy.srcBackend === 'linear-simd'}
                  onClick={() => setEnginePolicy((prev) => ({ ...prev, srcBackend: 'linear-simd' }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.enginePolicy.srcBackend.linearSimd')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <details className="settings-inline-details">
              <summary className="settings-inline-details-summary">
                {t('settings.audioAdvanced.enginePolicy.advancedSummary')}
              </summary>

              <div className="settings-inline-row">
                <div className="settings-inline-row-copy">
                  <p className="settings-inline-row-note">
                    {t('settings.audioAdvanced.enginePolicy.advancedNote')}
                  </p>
                </div>
              </div>

              {enginePolicy.srcMode === 'target-rate' ? (
                <div className="settings-inline-row">
                  <div className="settings-inline-row-copy">
                    <SettingHelpLabel
                      title={t('settings.audioAdvanced.enginePolicy.srcTargetRate.label')}
                      help={t('settings.audioAdvanced.enginePolicy.help.srcTargetRate')}
                    />
                  </div>
                  <div className="settings-inline-row-controls settings-section-controls--stretch">
                    <select
                      className="settings-select"
                      value={String(enginePolicy.srcTargetSampleRate ?? targetRateFallback)}
                      onChange={(e) => {
                        const nextRate = Number(e.target.value);
                        setEnginePolicy((prev) => ({
                          ...prev,
                          srcTargetSampleRate: Number.isFinite(nextRate)
                            ? Math.floor(nextRate)
                            : targetRateFallback,
                        }));
                      }}
                      aria-label={t('settings.audioAdvanced.enginePolicy.srcTargetRate.label')}
                      disabled={busy}
                    >
                      {sourceRateChoices.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate / 1000}k
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="settings-inline-row">
                  <div className="settings-inline-row-copy">
                    <p className="settings-inline-row-note">
                      {t('settings.audioAdvanced.enginePolicy.targetRateHint')}
                    </p>
                  </div>
                </div>
              )}

              <div className="settings-inline-row">
                <div className="settings-inline-row-copy">
                  <SettingHelpLabel
                    title={t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.label')}
                    help={t('settings.audioAdvanced.enginePolicy.help.outputQuantizationMode')}
                  />
                </div>
                <SettingsChoiceGroup>
                  <SettingsChoiceButton
                    type="button"
                    active={enginePolicy.outputQuantizationMode === 'round'}
                    onClick={() =>
                      setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'round' }))
                    }
                    disabled={busy || enginePolicy.transportMode === 'transport-exact'}
                  >
                    {t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.round')}
                  </SettingsChoiceButton>
                  <SettingsChoiceButton
                    type="button"
                    active={enginePolicy.outputQuantizationMode === 'tpdf'}
                    onClick={() =>
                      setEnginePolicy((prev) => ({ ...prev, outputQuantizationMode: 'tpdf' }))
                    }
                    disabled={busy || enginePolicy.transportMode === 'transport-exact'}
                  >
                    {t('settings.audioAdvanced.enginePolicy.outputQuantizationMode.tpdf')}
                  </SettingsChoiceButton>
                </SettingsChoiceGroup>
              </div>
            </details>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyEnginePolicy()}
                disabled={busy || !enginePolicyDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      <div className="settings-audio-block" style={buildInlineMeterStyle(dynamicSrcCost)}>
        <div className="settings-param-divider settings-param-divider--compact" />
        <AdvancedParamHead
          eyebrow={t('settings.audioAdvanced.dynamicSrc.eyebrow')}
          title={t('settings.audioAdvanced.dynamicSrc.title')}
          subtitle={t('settings.audioAdvanced.dynamicSrc.subtitle')}
          costPercent={dynamicSrcCost}
          pendingApply={dynamicSrcDirty}
        />

        {canUse ? (
          <>
            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <p className="settings-inline-row-title">{t('common.state.label')}</p>
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={dynamicSrc.enabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, enabled: true }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.dynamicSrc.enable')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!dynamicSrc.enabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, enabled: false }))}
                  disabled={busy}
                >
                  {t('settings.audioAdvanced.dynamicSrc.disable')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.adaptive')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.adaptive')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={dynamicSrc.adaptiveEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, adaptiveEnabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!dynamicSrc.adaptiveEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, adaptiveEnabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.learning')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.learning')}
                />
              </div>
              <SettingsChoiceGroup>
                <SettingsChoiceButton
                  type="button"
                  active={dynamicSrc.learningEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, learningEnabled: true }))}
                  disabled={busy}
                >
                  {t('common.state.on')}
                </SettingsChoiceButton>
                <SettingsChoiceButton
                  type="button"
                  active={!dynamicSrc.learningEnabled}
                  onClick={() => setDynamicSrc((prev) => ({ ...prev, learningEnabled: false }))}
                  disabled={busy}
                >
                  {t('common.state.off')}
                </SettingsChoiceButton>
              </SettingsChoiceGroup>
            </div>

            <details className="settings-inline-details">
              <summary className="settings-inline-details-summary">
                {t('settings.audioAdvanced.dynamicSrc.advancedTimingSummary')}
              </summary>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.restoreDebounceMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.restoreDebounceMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={500}
                  max={30000}
                  step={100}
                  value={dynamicSrc.restoreDebounceMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      restoreDebounceMs: Math.floor(clampNumber(Number(e.target.value), 500, 30000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.minSwitchIntervalMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.minSwitchIntervalMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={100}
                  max={10000}
                  step={50}
                  value={dynamicSrc.minSwitchIntervalMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      minSwitchIntervalMs: Math.floor(clampNumber(Number(e.target.value), 100, 10000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.seekHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.seekHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={500}
                  max={20000}
                  step={100}
                  value={dynamicSrc.seekHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      seekHoldMs: Math.floor(clampNumber(Number(e.target.value), 500, 20000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.underrunHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.underrunHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={2000}
                  max={120000}
                  step={500}
                  value={dynamicSrc.underrunHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      underrunHoldMs: Math.floor(clampNumber(Number(e.target.value), 2000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.sharedStressHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.sharedStressHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={90000}
                  step={500}
                  value={dynamicSrc.sharedStressHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      sharedStressHoldMs: Math.floor(clampNumber(Number(e.target.value), 1000, 90000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            <div className="settings-inline-row">
              <div className="settings-inline-row-copy">
                <SettingHelpLabel
                  title={t('settings.audioAdvanced.dynamicSrc.outputErrorHoldMs')}
                  help={t('settings.audioAdvanced.dynamicSrc.help.outputErrorHoldMs')}
                />
              </div>
              <div className="settings-inline-row-controls">
                <input
                  className="settings-number-input"
                  type="number"
                  min={1000}
                  max={120000}
                  step={500}
                  value={dynamicSrc.outputErrorHoldMs}
                  onChange={(e) =>
                    setDynamicSrc((prev) => ({
                      ...prev,
                      outputErrorHoldMs: Math.floor(clampNumber(Number(e.target.value), 1000, 120000)),
                    }))
                  }
                  disabled={busy}
                />
              </div>
            </div>

            </details>

            <div className="settings-section-controls">
              <SettingsActionButton
                type="button"
                onClick={() => void applyDynamicSrc()}
                disabled={busy || !dynamicSrcDirty}
              >
                {t('common.action.apply')}
              </SettingsActionButton>
              <SettingsActionButton type="button" onClick={() => void refresh()} disabled={busy}>
                {t('common.action.refresh')}
              </SettingsActionButton>
            </div>
          </>
        ) : (
          <p className="settings-card-note">{t('settings.audioComponents.note.requireNative')}</p>
        )}
      </div>

      {error && <div className="settings-inline-error">{error}</div>}
    </div>
  );
}
