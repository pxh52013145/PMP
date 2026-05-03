import {
  broadcastDataUpdate,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readString } from '../../modules/storage';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import {
  resolveAudioTuningProfilePayload,
} from './audioTuningProfiles';
import {
  resolveStoredDynamicSrcAutoSettings,
  resolveStoredTuningAutoSettings,
} from './nativeAudioAutoSettingsStorage';
import {
  resolveNextAudioTuningAutoSettings,
} from './nativeAudioTuningAutoSettings';
import type {
  AudioDynamicSrcAutoSettings,
  AudioDynamicSrcAutoSettingsPatch,
  AudioEnginePolicyPatch,
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
  AudioTuningProfileId,
} from './types';
import type {
  NativeAudioComponentsStatePayload,
  NativeAudioEnginePolicyPayload,
} from './nativeAudioServiceTypes';

export const DEFAULT_DYNAMIC_SRC_AUTO_SETTINGS: AudioDynamicSrcAutoSettings = {
  enabled: true,
  adaptiveEnabled: true,
  learningEnabled: true,
  restoreDebounceMs: 8000,
  minSwitchIntervalMs: 10_000,
  seekHoldMs: 3000,
  underrunHoldMs: 15_000,
  sharedStressHoldMs: 12_000,
  outputErrorHoldMs: 20_000,
};

export const DEFAULT_TUNING_AUTO_SETTINGS: AudioTuningAutoSettings = {
  enabled: true,
  tickIntervalMs: 2500,
  stableWindowMs: 20_000,
  minSwitchIntervalMs: 30_000,
  postSwitchObserveWindowMs: 8000,
  elevatedStressScore: 40,
  criticalStressScore: 70,
  criticalUnderrunEventsWindow: 3,
  criticalOverflowGrowthTicks: 3,
};

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeDynamicSrcAutoSettings(
  current: AudioDynamicSrcAutoSettings,
  patch: AudioDynamicSrcAutoSettingsPatch
): AudioDynamicSrcAutoSettings {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    adaptiveEnabled:
      typeof patch.adaptiveEnabled === 'boolean' ? patch.adaptiveEnabled : current.adaptiveEnabled,
    learningEnabled:
      typeof patch.learningEnabled === 'boolean' ? patch.learningEnabled : current.learningEnabled,
    restoreDebounceMs: clampMs(patch.restoreDebounceMs, current.restoreDebounceMs, 500, 30_000),
    minSwitchIntervalMs: clampMs(patch.minSwitchIntervalMs, current.minSwitchIntervalMs, 100, 10_000),
    seekHoldMs: clampMs(patch.seekHoldMs, current.seekHoldMs, 500, 20_000),
    underrunHoldMs: clampMs(patch.underrunHoldMs, current.underrunHoldMs, 2_000, 120_000),
    sharedStressHoldMs: clampMs(
      patch.sharedStressHoldMs,
      current.sharedStressHoldMs,
      1_000,
      90_000
    ),
    outputErrorHoldMs: clampMs(patch.outputErrorHoldMs, current.outputErrorHoldMs, 1_000, 120_000),
  };
}

function normalizeEnginePolicyPatch(patch: AudioEnginePolicyPatch): AudioEnginePolicyPatch {
  const normalized: AudioEnginePolicyPatch = {};
  if (
    patch.stabilityProfile === 'low-latency' ||
    patch.stabilityProfile === 'balanced' ||
    patch.stabilityProfile === 'stable' ||
    patch.stabilityProfile === 'game-safe' ||
    patch.stabilityProfile === 'safe-mode'
  ) {
    normalized.stabilityProfile = patch.stabilityProfile;
  }
  if (patch.transportMode === 'robust' || patch.transportMode === 'transport-exact') {
    normalized.transportMode = patch.transportMode;
  }
  if (typeof patch.hqSrcEnabled === 'boolean') {
    normalized.hqSrcEnabled = patch.hqSrcEnabled;
  }
  if (
    patch.hqSrcPhaseMode === 'linear' ||
    patch.hqSrcPhaseMode === 'minimum' ||
    patch.hqSrcPhaseMode === 'intermediate'
  ) {
    normalized.hqSrcPhaseMode = patch.hqSrcPhaseMode;
  }
  if (
    patch.srcMode === 'source-native' ||
    patch.srcMode === 'match-output' ||
    patch.srcMode === 'target-rate'
  ) {
    normalized.srcMode = patch.srcMode;
  }
  if (patch.srcBackend === 'rubato' || patch.srcBackend === 'linear-simd') {
    normalized.srcBackend = patch.srcBackend;
  }
  if (
    typeof patch.srcTargetSampleRate === 'number' &&
    Number.isFinite(patch.srcTargetSampleRate) &&
    patch.srcTargetSampleRate > 0
  ) {
    normalized.srcTargetSampleRate = Math.max(
      8000,
      Math.min(768000, Math.floor(patch.srcTargetSampleRate))
    );
  } else if (patch.srcTargetSampleRate === null) {
    normalized.srcTargetSampleRate = null;
  }
  if (patch.outputQuantizationMode === 'round' || patch.outputQuantizationMode === 'tpdf') {
    normalized.outputQuantizationMode = patch.outputQuantizationMode;
  }
  return normalized;
}

function normalizeEnginePolicyPayload(payload: unknown): AudioEnginePolicyPatch | null {
  if (!payload || typeof payload !== 'object') return null;
  return normalizeEnginePolicyPatch(payload as NativeAudioEnginePolicyPayload);
}

async function readOutputBackendId(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const payload = await invokeWithTelemetry<unknown>(
    'native_audio_get_audio_components_state',
    undefined,
    {
      moduleId: 'audio',
      component: 'audioAdvancedSettingsShell',
      event: 'audio.advanced.components-state.read',
      failureLevel: 'warn',
      successLevel: 'trace',
    }
  ).catch(() => null);
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as NativeAudioComponentsStatePayload;
  return typeof record.outputBackendId === 'string' && record.outputBackendId.trim().length > 0
    ? record.outputBackendId.trim()
    : null;
}

export class AudioAdvancedSettingsShell {
  getDynamicSrcAutoSettings(): AudioDynamicSrcAutoSettings {
    return resolveStoredDynamicSrcAutoSettings({
      raw: readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS),
      defaults: DEFAULT_DYNAMIC_SRC_AUTO_SETTINGS,
    });
  }

  async setDynamicSrcAutoSettings(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void> {
    const next = normalizeDynamicSrcAutoSettings(this.getDynamicSrcAutoSettings(), settings);
    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS,
      next,
      TAURI_EVENTS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED
    );
  }

  getAudioTuningAutoSettings(): AudioTuningAutoSettings {
    return resolveStoredTuningAutoSettings({
      raw: readString(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS),
      defaults: DEFAULT_TUNING_AUTO_SETTINGS,
    });
  }

  async setAudioTuningAutoSettings(settings: AudioTuningAutoSettingsPatch): Promise<void> {
    const next = resolveNextAudioTuningAutoSettings({
      current: this.getAudioTuningAutoSettings(),
      patch: settings,
    });
    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS,
      next,
      TAURI_EVENTS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS_UPDATED
    );
  }

  async setEnginePolicy(patch: AudioEnginePolicyPatch): Promise<void> {
    const normalized = normalizeEnginePolicyPatch(patch);
    let persisted = normalized;

    if (isTauriRuntime()) {
      const response = await invokeWithTelemetry<unknown>(
        'native_audio_set_engine_policy',
        normalized as Record<string, unknown>,
        {
          moduleId: 'audio',
          component: 'audioAdvancedSettingsShell',
          event: 'audio.engine-policy.set',
          failureLevel: 'warn',
        }
      );
      persisted = normalizeEnginePolicyPayload(response) ?? normalized;
    }

    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY,
      persisted,
      TAURI_EVENTS.NATIVE_AUDIO_ENGINE_POLICY_UPDATED
    );
  }

  async applyTuningProfile(profileId: AudioTuningProfileId): Promise<void> {
    const payload = resolveAudioTuningProfilePayload({
      profileId,
      outputBackendId: await readOutputBackendId(),
    });

    await this.setEnginePolicy(payload.enginePolicy);
    await this.setDynamicSrcAutoSettings(payload.dynamicSrcSettings);
    await broadcastDataUpdate(
      STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
      payload.streamingBufferStoragePayload,
      TAURI_EVENTS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED
    );
  }
}
