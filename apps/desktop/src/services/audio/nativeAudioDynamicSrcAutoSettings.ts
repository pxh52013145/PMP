import { readString } from '../../modules/storage';
import { STORAGE_KEYS, setupDualListener } from '../../utils/windowCommunication';
import { resolveStoredDynamicSrcAutoSettings } from './nativeAudioAutoSettingsStorage';
import type { AudioDynamicSrcAutoSettings } from './types';
import type { NativeAudioDynamicSrcPolicyController } from './nativeAudioDynamicSrcPolicyController';
import type { DynamicSrcLearningMap } from './nativeAudioServiceTypes';

type DynamicSrcSettingsListenerCleanup = (() => void) | null;

export type DynamicSrcAutoSettingsHost = {
  policyController: NativeAudioDynamicSrcPolicyController;
  getDynamicSrcSettingsListenerCleanup(): DynamicSrcSettingsListenerCleanup;
  setDynamicSrcSettingsListenerCleanup(cleanup: DynamicSrcSettingsListenerCleanup): void;
  getDynamicSrcSettingsListenerInitPromise(): Promise<void> | null;
  setDynamicSrcSettingsListenerInitPromise(promise: Promise<void> | null): void;
  setDynamicSrcLearningProfile(profile: DynamicSrcLearningMap): void;
  getDynamicSrcLearningLastPersistedSignature(): string | null;
  setDynamicSrcLearningLastPersistedSignature(signature: string | null): void;
  setDynamicSrcLearningLastPersistAtMs(timestampMs: number): void;
  parseDynamicSrcLearningProfile(raw: string | null): DynamicSrcLearningMap;
  normalizeDynamicSrcLearningProfileForPersistence(): DynamicSrcLearningMap;
  getDynamicSrcStressScore(): number;
  evaluateDynamicSrcAutoDegradation(options: { triggerActions: boolean }): void;
  emitRobustnessSnapshot(force?: boolean): void;
  clearDynamicSrcLearningPersistTimer(): void;
  scheduleDynamicSrcRestoreEvaluation(): void;
};

export type DynamicSrcHost = DynamicSrcAutoSettingsHost;

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

function applyPersistedDynamicSrcSettings(host: DynamicSrcAutoSettingsHost): void {
  const previous = host.policyController.getSettings();
  const next = readDynamicSrcAutoSettingsFromStorage(host.policyController);
  const changed =
    next.enabled !== previous.enabled ||
    next.adaptiveEnabled !== previous.adaptiveEnabled ||
    next.learningEnabled !== previous.learningEnabled;

  host.policyController.applySettings(next);
  if (!next.learningEnabled) {
    host.clearDynamicSrcLearningPersistTimer();
  }

  if (!next.enabled) {
    host.policyController.disableAuto();
  } else {
    host.policyController.currentAdaptiveProfile = host.policyController.resolveAdaptiveProfile(
      host.getDynamicSrcStressScore()
    );
    host.scheduleDynamicSrcRestoreEvaluation();
  }

  host.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
  if (changed) {
    host.emitRobustnessSnapshot(true);
  }
}

function applyPersistedDynamicSrcLearningProfile(host: DynamicSrcAutoSettingsHost): void {
  const nextProfile = host.parseDynamicSrcLearningProfile(
    readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
  );
  const nextSignature = JSON.stringify(nextProfile);
  if (nextSignature === host.getDynamicSrcLearningLastPersistedSignature()) {
    return;
  }

  host.setDynamicSrcLearningProfile(nextProfile);
  host.setDynamicSrcLearningLastPersistedSignature(nextSignature);
  host.setDynamicSrcLearningLastPersistAtMs(Date.now());
  host.emitRobustnessSnapshot(true);
}

export async function restoreDynamicSrcAutoSettingsFromStorageImpl(
  host: DynamicSrcAutoSettingsHost
): Promise<void> {
  host.setDynamicSrcLearningProfile(
    host.parseDynamicSrcLearningProfile(
      readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
    )
  );
  host.setDynamicSrcLearningLastPersistedSignature(
    JSON.stringify(host.normalizeDynamicSrcLearningProfileForPersistence())
  );
  host.setDynamicSrcLearningLastPersistAtMs(0);

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
