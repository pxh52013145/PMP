import { readString } from '../../modules/storage';
import {
  broadcastDataUpdate,
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupDualListener,
} from '../../utils/windowCommunication';
import { resolveStoredDynamicSrcAutoSettings } from './nativeAudioAutoSettingsStorage';
import type {
  AudioDynamicSrcAutoSettings,
  AudioDynamicSrcAutoSettingsPatch,
} from './types';
import type { NativeAudioDynamicSrcLearningController } from './nativeAudioDynamicSrcLearningController';
import {
  resolveNativeAudioDynamicSrcSettingsPatch,
  type NativeAudioDynamicSrcPolicyController,
} from './nativeAudioDynamicSrcPolicyController';
import type { NativeAudioSrcPolicy } from './nativeAudioServiceTypes';

type DynamicSrcSettingsListenerCleanup = (() => void) | null;

export type DynamicSrcAutoSettingsCoordinatorHost = {
  getDynamicSrcStressScore(): number;
  getCurrentQualitySrcPolicy(): NativeAudioSrcPolicy;
  captureCurrentQualitySrcPolicy(): void;
  restoreQualitySrcPolicyForDisabled(reason: string): Promise<void> | void;
  evaluateDynamicSrcAutoDegradation(options: { triggerActions: boolean }): void;
  emitRobustnessSnapshot(force?: boolean): void;
  scheduleDynamicSrcRestoreEvaluation(): void;
};

export type DynamicSrcAutoSettingsHost = {
  policyController: NativeAudioDynamicSrcPolicyController;
  learningController: NativeAudioDynamicSrcLearningController;
  getDynamicSrcSettingsListenerCleanup(): DynamicSrcSettingsListenerCleanup;
  setDynamicSrcSettingsListenerCleanup(cleanup: DynamicSrcSettingsListenerCleanup): void;
  getDynamicSrcSettingsListenerInitPromise(): Promise<void> | null;
  setDynamicSrcSettingsListenerInitPromise(promise: Promise<void> | null): void;
} & DynamicSrcAutoSettingsCoordinatorHost;

export type DynamicSrcHost = DynamicSrcAutoSettingsHost;

export type NativeAudioDynamicSrcAutoSettingsCoordinatorOptions = {
  policyController: NativeAudioDynamicSrcPolicyController;
  learningController: NativeAudioDynamicSrcLearningController;
  host: DynamicSrcAutoSettingsCoordinatorHost;
};

export class NativeAudioDynamicSrcAutoSettingsCoordinator {
  private listenerCleanup: DynamicSrcSettingsListenerCleanup = null;
  private listenerInitPromise: Promise<void> | null = null;
  private readonly host: DynamicSrcAutoSettingsHost;

  constructor(options: NativeAudioDynamicSrcAutoSettingsCoordinatorOptions) {
    this.host = {
      ...options.host,
      policyController: options.policyController,
      learningController: options.learningController,
      getDynamicSrcSettingsListenerCleanup: () => this.listenerCleanup,
      setDynamicSrcSettingsListenerCleanup: (cleanup) => {
        this.listenerCleanup = cleanup;
      },
      getDynamicSrcSettingsListenerInitPromise: () => this.listenerInitPromise,
      setDynamicSrcSettingsListenerInitPromise: (promise) => {
        this.listenerInitPromise = promise;
      },
    };
  }

  getSettings(): AudioDynamicSrcAutoSettings {
    return this.host.policyController.getSettings();
  }

  async setSettings(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void> {
    return setDynamicSrcAutoSettingsImpl(this.host, settings);
  }

  async restoreFromStorage(): Promise<void> {
    return restoreDynamicSrcAutoSettingsFromStorageImpl(this.host);
  }

  dispose(): void {
    this.listenerCleanup?.();
    this.listenerCleanup = null;
    this.listenerInitPromise = null;
  }
}

export function readDynamicSrcAutoSettingsFromStorage(
  policyController: NativeAudioDynamicSrcPolicyController
): AudioDynamicSrcAutoSettings {
  return resolveStoredDynamicSrcAutoSettings({
    raw: readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS),
    defaults: policyController.getSettings(),
  });
}

function restoreInitialDynamicSrcState(host: DynamicSrcAutoSettingsHost): void {
  const persisted = readDynamicSrcAutoSettingsFromStorage(host.policyController);
  host.policyController.applySettings(persisted);
  host.policyController.currentAdaptiveProfile = host.policyController.resolveAdaptiveProfile(
    host.getDynamicSrcStressScore()
  );
  host.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
  host.emitRobustnessSnapshot(true);
}

function emitDynamicSrcSettingsSnapshot(
  host: DynamicSrcAutoSettingsHost,
  force: boolean = false
): void {
  if (force) {
    host.emitRobustnessSnapshot(true);
    return;
  }
  host.emitRobustnessSnapshot();
}

function applyDynamicSrcAutoSettingsState(
  host: DynamicSrcAutoSettingsHost,
  nextSettings: AudioDynamicSrcAutoSettings,
  options: {
    captureCurrentQualityPolicy?: boolean;
    enableAuto?: boolean;
    emitSnapshot?: boolean;
    forceSnapshot?: boolean;
    scheduleRestore?: boolean;
  } = {}
): void {
  host.policyController.applySettings(nextSettings);
  if (!nextSettings.learningEnabled) {
    host.learningController.clearPersistTimer();
  }

  if (!nextSettings.enabled) {
    host.policyController.disableAuto();
    host.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
    if (options.emitSnapshot) {
      emitDynamicSrcSettingsSnapshot(host, options.forceSnapshot);
    }
    return;
  }

  if (options.captureCurrentQualityPolicy) {
    host.captureCurrentQualitySrcPolicy();
  }

  const stressScore = host.getDynamicSrcStressScore();
  if (options.enableAuto) {
    host.policyController.enableAuto({
      currentQualityPolicy: host.getCurrentQualitySrcPolicy(),
      stressScore,
    });
  } else {
    host.policyController.currentAdaptiveProfile =
      host.policyController.resolveAdaptiveProfile(stressScore);
  }

  if (options.scheduleRestore) {
    host.scheduleDynamicSrcRestoreEvaluation();
  }

  host.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
  if (options.emitSnapshot) {
    emitDynamicSrcSettingsSnapshot(host, options.forceSnapshot);
  }
}

function applyPersistedDynamicSrcSettings(host: DynamicSrcAutoSettingsHost): void {
  const previous = host.policyController.getSettings();
  const next = readDynamicSrcAutoSettingsFromStorage(host.policyController);
  const changed =
    next.enabled !== previous.enabled ||
    next.adaptiveEnabled !== previous.adaptiveEnabled ||
    next.learningEnabled !== previous.learningEnabled;

  applyDynamicSrcAutoSettingsState(host, next, {
    emitSnapshot: changed,
    forceSnapshot: true,
    scheduleRestore: next.enabled,
  });
}

function applyPersistedDynamicSrcLearningProfile(host: DynamicSrcAutoSettingsHost): void {
  const changed = host.learningController.applyPersistedProfile(
    readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
  );
  if (!changed) {
    return;
  }

  host.emitRobustnessSnapshot(true);
}

export async function setDynamicSrcAutoSettingsImpl(
  host: DynamicSrcAutoSettingsHost,
  settings: AudioDynamicSrcAutoSettingsPatch
): Promise<void> {
  const nextSettings = resolveNativeAudioDynamicSrcSettingsPatch({
    patch: settings,
    current: host.policyController.getSettings(),
  });

  if (!nextSettings.enabled && host.policyController.profile === 'latency') {
    await host.restoreQualitySrcPolicyForDisabled('dynamic-src-disabled');
  }

  await broadcastDataUpdate(
    STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS,
    nextSettings,
    TAURI_EVENTS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED
  );

  applyDynamicSrcAutoSettingsState(host, nextSettings, {
    captureCurrentQualityPolicy: nextSettings.enabled,
    enableAuto: nextSettings.enabled,
    emitSnapshot: true,
    scheduleRestore: nextSettings.enabled,
  });
}

export async function restoreDynamicSrcAutoSettingsFromStorageImpl(
  host: DynamicSrcAutoSettingsHost
): Promise<void> {
  host.learningController.restorePersistedProfile(
    readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
  );

  restoreInitialDynamicSrcState(host);

  if (host.getDynamicSrcSettingsListenerCleanup()) return;
  const existingInitPromise = host.getDynamicSrcSettingsListenerInitPromise();
  if (existingInitPromise) {
    await existingInitPromise;
    return;
  }

  const initPromise = (async () => {
    if (host.getDynamicSrcSettingsListenerCleanup()) return;

    const settingsCleanup = await setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS],
      [],
      () => applyPersistedDynamicSrcSettings(host)
    );

    const learningCleanup = await setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE],
      [],
      () => applyPersistedDynamicSrcLearningProfile(host)
    );

    host.setDynamicSrcSettingsListenerCleanup(() => {
      settingsCleanup();
      learningCleanup();
    });
  })().finally(() => {
    host.setDynamicSrcSettingsListenerInitPromise(null);
  });

  host.setDynamicSrcSettingsListenerInitPromise(initPromise);
  await initPromise;
}
