import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  NativeAudioDynamicSrcPolicyController,
} from './nativeAudioDynamicSrcPolicyController';
import { NativeAudioDynamicSrcLearningController } from './nativeAudioDynamicSrcLearningController';
import {
  NativeAudioDynamicSrcAutoSettingsCoordinator,
  restoreDynamicSrcAutoSettingsFromStorageImpl,
  setDynamicSrcAutoSettingsImpl,
  type DynamicSrcAutoSettingsHost,
} from './nativeAudioDynamicSrcAutoSettings';
import type { AudioDynamicSrcAutoSettings } from './types';

type ListenerEntry = {
  storageKeys: string[];
  tauriEvents: string[];
  callback: () => void;
  cleanup: () => void;
};

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const listeners: ListenerEntry[] = [];
  const broadcastDataUpdate = vi.fn(async (key: string, value: unknown) => {
    storage.set(key, JSON.stringify(value));
  });
  const setupDualListener = vi.fn(
    async (storageKeys: string[], tauriEvents: string[], callback: () => void) => {
      const cleanup = vi.fn();
      listeners.push({ storageKeys, tauriEvents, callback, cleanup });
      return cleanup;
    }
  );

  return { broadcastDataUpdate, listeners, setupDualListener, storage };
});

vi.mock('../../modules/storage', () => ({
  readString: vi.fn((key: string) => mocks.storage.get(key) ?? null),
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS: 'pixel-matrix-native-audio-dynamic-src-settings',
    NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE:
      'pixel-matrix-native-audio-dynamic-src-learning-profile',
  },
  TAURI_EVENTS: {
    NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED: 'native-audio-dynamic-src-settings-updated',
  },
  broadcastDataUpdate: mocks.broadcastDataUpdate,
  setupDualListener: mocks.setupDualListener,
}));

const DEFAULT_SETTINGS: AudioDynamicSrcAutoSettings = {
  enabled: true,
  adaptiveEnabled: true,
  learningEnabled: true,
  restoreDebounceMs: 4_000,
  minSwitchIntervalMs: 600,
  seekHoldMs: 2_000,
  underrunHoldMs: 12_000,
  sharedStressHoldMs: 8_000,
  outputErrorHoldMs: 10_000,
};

function createController(): NativeAudioDynamicSrcPolicyController {
  return new NativeAudioDynamicSrcPolicyController({
    defaults: DEFAULT_SETTINGS,
    thresholds: {
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      severeUnderrunFramesThreshold: 1024,
      degradationL2HoldFloorMs: 4_000,
    },
  });
}

function createHost(controller = createController(), initialStressScore = 0) {
  let settingsListenerCleanup: (() => void) | null = null;
  let settingsListenerInitPromise: Promise<void> | null = null;
  let stressScore = initialStressScore;

  const learningController = new NativeAudioDynamicSrcLearningController({
    maxItems: 64,
    persistMinIntervalMs: 2_000,
    updateMinIntervalMs: 250,
    minDelta: 0.0005,
    persistProfile: vi.fn(),
  });
  const evaluateDynamicSrcAutoDegradation = vi.fn();
  const emitRobustnessSnapshot = vi.fn();
  const clearPersistTimer = vi.spyOn(learningController, 'clearPersistTimer');
  const scheduleDynamicSrcRestoreEvaluation = vi.fn();
  const captureCurrentQualitySrcPolicy = vi.fn(() => {
    controller.currentQualityPolicy = {
      srcMode: 'source-native',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    };
  });
  const restoreQualitySrcPolicyForDisabled = vi.fn(async () => undefined);

  const host: DynamicSrcAutoSettingsHost = {
    policyController: controller,
    learningController,
    getDynamicSrcSettingsListenerCleanup: () => settingsListenerCleanup,
    setDynamicSrcSettingsListenerCleanup: (cleanup) => {
      settingsListenerCleanup = cleanup;
    },
    getDynamicSrcSettingsListenerInitPromise: () => settingsListenerInitPromise,
    setDynamicSrcSettingsListenerInitPromise: (promise) => {
      settingsListenerInitPromise = promise;
    },
    getDynamicSrcStressScore: () => stressScore,
    getCurrentQualitySrcPolicy: () => controller.currentQualityPolicy,
    captureCurrentQualitySrcPolicy,
    restoreQualitySrcPolicyForDisabled,
    evaluateDynamicSrcAutoDegradation,
    emitRobustnessSnapshot,
    scheduleDynamicSrcRestoreEvaluation,
  };

  return {
    controller,
    host,
    clearDynamicSrcLearningPersistTimer: clearPersistTimer,
    captureCurrentQualitySrcPolicy,
    emitRobustnessSnapshot,
    evaluateDynamicSrcAutoDegradation,
    getLearningLastPersistAtMs: () => learningController.getLastPersistAtMs(),
    getLearningLastPersistedSignature: () => learningController.getLastPersistedSignature(),
    getLearningProfile: () => learningController.getProfile(),
    learningController,
    restoreQualitySrcPolicyForDisabled,
    scheduleDynamicSrcRestoreEvaluation,
    setStressScore: (nextStressScore: number) => {
      stressScore = nextStressScore;
    },
  };
}

function writeJson(storageKey: string, value: unknown): void {
  mocks.storage.set(storageKey, JSON.stringify(value));
}

function triggerListener(storageKey: string): void {
  const listener = mocks.listeners.find((entry) => entry.storageKeys.includes(storageKey));
  expect(listener).toBeTruthy();
  listener?.callback();
}

describe('nativeAudioDynamicSrcAutoSettings', () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.listeners.length = 0;
    mocks.broadcastDataUpdate.mockClear();
    mocks.setupDualListener.mockClear();
  });

  it('restores learning and auto settings through the policy controller host', async () => {
    const settings: AudioDynamicSrcAutoSettings = {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: false,
      restoreDebounceMs: 5_000,
      minSwitchIntervalMs: 700,
      seekHoldMs: 1_500,
      underrunHoldMs: 9_000,
      sharedStressHoldMs: 6_000,
      outputErrorHoldMs: 7_000,
    };
    const learningProfile = {
      'wasapi::default': { stressIndex: 2, updatedAtMs: 50 },
    };
    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS, settings);
    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE, learningProfile);

    const context = createHost(createController(), 5);
    await restoreDynamicSrcAutoSettingsFromStorageImpl(context.host);

    expect(context.controller.getSettings()).toEqual(settings);
    expect(context.controller.currentAdaptiveProfile).toBe('elevated');
    expect(context.getLearningProfile()).toEqual(learningProfile);
    expect(context.getLearningLastPersistedSignature()).toBe(JSON.stringify(learningProfile));
    expect(context.getLearningLastPersistAtMs()).toBe(0);
    expect(context.evaluateDynamicSrcAutoDegradation).toHaveBeenCalledWith({
      triggerActions: false,
    });
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledWith(true);
    expect(mocks.setupDualListener).toHaveBeenCalledTimes(2);
  });

  it('applies settings listener changes without service dynamicSrc setter compatibility', async () => {
    const context = createHost(createController(), 0);
    await restoreDynamicSrcAutoSettingsFromStorageImpl(context.host);

    const effectiveTiming = context.controller.getEffectiveTiming({
      stressScore: 0,
      learningScale: 1,
    });
    context.controller.withHold({
      reason: 'underrun-spike',
      holdMs: 5_000,
      nowMs: 1_000,
      effectiveTiming,
      hasPendingSeekWork: false,
    });
    expect(context.controller.holdUntil).toBeGreaterThan(0);

    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS, {
      ...DEFAULT_SETTINGS,
      enabled: false,
      adaptiveEnabled: false,
      learningEnabled: false,
    });
    triggerListener(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS);

    expect(context.controller.getSettings()).toMatchObject({
      enabled: false,
      adaptiveEnabled: false,
      learningEnabled: false,
    });
    expect(context.controller.profile).toBe('quality');
    expect(context.controller.currentAdaptiveProfile).toBe('baseline');
    expect(context.controller.holdUntil).toBe(0);
    expect(context.clearDynamicSrcLearningPersistTimer).toHaveBeenCalledTimes(1);
    expect(context.scheduleDynamicSrcRestoreEvaluation).not.toHaveBeenCalled();

    context.setStressScore(9);
    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS, DEFAULT_SETTINGS);
    triggerListener(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS);

    expect(context.controller.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(context.controller.currentAdaptiveProfile).toBe('critical');
    expect(context.scheduleDynamicSrcRestoreEvaluation).toHaveBeenCalledTimes(1);
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledTimes(3);
  });

  it('persists manual settings and restores quality before disabling latency auto SRC', async () => {
    const context = createHost(createController(), 0);
    context.controller.profile = 'latency';

    await setDynamicSrcAutoSettingsImpl(context.host, {
      enabled: false,
      learningEnabled: false,
      seekHoldMs: 1_234,
    });

    expect(context.restoreQualitySrcPolicyForDisabled).toHaveBeenCalledWith(
      'dynamic-src-disabled'
    );
    expect(mocks.broadcastDataUpdate).toHaveBeenCalledWith(
      STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS,
      expect.objectContaining({
        enabled: false,
        learningEnabled: false,
        seekHoldMs: 1_234,
      }),
      TAURI_EVENTS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED
    );
    expect(
      context.restoreQualitySrcPolicyForDisabled.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.broadcastDataUpdate.mock.invocationCallOrder[0]);
    expect(context.controller.getSettings()).toMatchObject({
      enabled: false,
      learningEnabled: false,
      seekHoldMs: 1_234,
    });
    expect(context.controller.profile).toBe('quality');
    expect(context.clearDynamicSrcLearningPersistTimer).toHaveBeenCalledTimes(1);
    expect(context.evaluateDynamicSrcAutoDegradation).toHaveBeenCalledWith({
      triggerActions: false,
    });
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledTimes(1);
  });

  it('captures quality policy and enables runtime auto state for manual enable changes', async () => {
    const context = createHost(createController(), 9);
    context.controller.manualLockActive = true;

    await setDynamicSrcAutoSettingsImpl(context.host, {
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
    });

    expect(context.restoreQualitySrcPolicyForDisabled).not.toHaveBeenCalled();
    expect(context.captureCurrentQualitySrcPolicy).toHaveBeenCalledTimes(1);
    expect(context.controller.manualLockActive).toBe(false);
    expect(context.controller.currentAdaptiveProfile).toBe('critical');
    expect(context.controller.currentQualityPolicy).toEqual({
      srcMode: 'source-native',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: null,
    });
    expect(context.scheduleDynamicSrcRestoreEvaluation).toHaveBeenCalledTimes(1);
    expect(context.evaluateDynamicSrcAutoDegradation).toHaveBeenCalledWith({
      triggerActions: false,
    });
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledTimes(1);
  });

  it('applies learning profile listener updates only when the persisted signature changes', async () => {
    const initialProfile = {
      'wasapi::default': { stressIndex: 1, updatedAtMs: 10 },
    };
    const nextProfile = {
      'wasapi::default': { stressIndex: 3, updatedAtMs: 20 },
    };
    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE, initialProfile);

    const context = createHost();
    await restoreDynamicSrcAutoSettingsFromStorageImpl(context.host);
    expect(context.getLearningProfile()).toEqual(initialProfile);

    writeJson(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE, nextProfile);
    triggerListener(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE);

    expect(context.getLearningProfile()).toEqual(nextProfile);
    expect(context.getLearningLastPersistedSignature()).toBe(JSON.stringify(nextProfile));
    expect(context.getLearningLastPersistAtMs()).toBeGreaterThan(0);
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledTimes(2);

    triggerListener(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE);
    expect(context.emitRobustnessSnapshot).toHaveBeenCalledTimes(2);
  });

  it('owns storage listener lifecycle through the settings coordinator', async () => {
    const context = createHost(createController(), 5);
    const coordinator = new NativeAudioDynamicSrcAutoSettingsCoordinator({
      policyController: context.controller,
      learningController: context.learningController,
      host: {
        getDynamicSrcStressScore: () => 5,
        getCurrentQualitySrcPolicy: () => context.controller.currentQualityPolicy,
        captureCurrentQualitySrcPolicy: context.captureCurrentQualitySrcPolicy,
        restoreQualitySrcPolicyForDisabled: context.restoreQualitySrcPolicyForDisabled,
        evaluateDynamicSrcAutoDegradation: context.evaluateDynamicSrcAutoDegradation,
        emitRobustnessSnapshot: context.emitRobustnessSnapshot,
        scheduleDynamicSrcRestoreEvaluation: context.scheduleDynamicSrcRestoreEvaluation,
      },
    });

    await coordinator.restoreFromStorage();
    await coordinator.restoreFromStorage();

    expect(mocks.setupDualListener).toHaveBeenCalledTimes(2);
    expect(coordinator.getSettings()).toEqual(DEFAULT_SETTINGS);

    coordinator.dispose();

    expect(mocks.listeners).toHaveLength(2);
    expect(mocks.listeners[0]?.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.listeners[1]?.cleanup).toHaveBeenCalledTimes(1);
  });
});
