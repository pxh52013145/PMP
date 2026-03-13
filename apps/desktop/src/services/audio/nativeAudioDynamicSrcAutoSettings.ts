import { readString } from '../../modules/storage';
import { STORAGE_KEYS, setupDualListener } from '../../utils/windowCommunication';
import { resolveDynamicSrcAdaptiveProfile } from './dynamicSrcAdaptiveTiming';
import type { AudioDynamicSrcAdaptiveProfile, AudioDynamicSrcAutoSettings } from './types';
import type { DynamicSrcLearningMap } from './nativeAudioServiceTypes';

type DynamicSrcSettingsListenerCleanup = (() => void) | null;

export type DynamicSrcHost = {
  dynamicSrcLearningProfile: DynamicSrcLearningMap;
  dynamicSrcLearningLastPersistedSignature: string;
  dynamicSrcLearningLastPersistAtMs: number;
  dynamicSrcAutoEnabled: boolean;
  dynamicSrcAdaptiveEnabled: boolean;
  dynamicSrcLearningEnabled: boolean;
  dynamicSrcRestoreDebounceMs: number;
  dynamicSrcMinSwitchIntervalMs: number;
  dynamicSrcSeekHoldMs: number;
  dynamicSrcUnderrunHoldMs: number;
  dynamicSrcSharedStressHoldMs: number;
  dynamicSrcOutputErrorHoldMs: number;
  dynamicSrcAdaptiveProfile: AudioDynamicSrcAdaptiveProfile;
  dynamicSrcProfile: 'quality' | 'latency';
  dynamicSrcHoldUntilMs: number;
  dynamicSrcSettingsListenerCleanup: DynamicSrcSettingsListenerCleanup;
  dynamicSrcSettingsListenerInitPromise: Promise<void> | null;
  parseDynamicSrcLearningProfile(raw: string | null): DynamicSrcLearningMap;
  normalizeDynamicSrcLearningProfileForPersistence(): DynamicSrcLearningMap;
  readDynamicSrcAutoSettings(): AudioDynamicSrcAutoSettings;
  getDynamicSrcStressScore(): number;
  evaluateDynamicSrcAutoDegradation(options: { triggerActions: boolean }): void;
  emitRobustnessSnapshot(force?: boolean): void;
  clearDynamicSrcLearningPersistTimer(): void;
  clearDynamicSrcRestoreTimer(): void;
  scheduleDynamicSrcRestoreEvaluation(): void;
};

export async function restoreDynamicSrcAutoSettingsFromStorageImpl(
  this: DynamicSrcHost,
  options: {
    elevatedScoreThreshold: number;
    criticalScoreThreshold: number;
  },
): Promise<void> {
    this.dynamicSrcLearningProfile = this.parseDynamicSrcLearningProfile(
      readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
    );
    this.dynamicSrcLearningLastPersistedSignature = JSON.stringify(
      this.normalizeDynamicSrcLearningProfileForPersistence()
    );
    this.dynamicSrcLearningLastPersistAtMs = 0;

    const persisted = this.readDynamicSrcAutoSettings();
    this.dynamicSrcAutoEnabled = persisted.enabled;
    this.dynamicSrcAdaptiveEnabled = persisted.adaptiveEnabled;
    this.dynamicSrcLearningEnabled = persisted.learningEnabled;
    this.dynamicSrcRestoreDebounceMs = persisted.restoreDebounceMs;
    this.dynamicSrcMinSwitchIntervalMs = persisted.minSwitchIntervalMs;
    this.dynamicSrcSeekHoldMs = persisted.seekHoldMs;
    this.dynamicSrcUnderrunHoldMs = persisted.underrunHoldMs;
    this.dynamicSrcSharedStressHoldMs = persisted.sharedStressHoldMs;
    this.dynamicSrcOutputErrorHoldMs = persisted.outputErrorHoldMs;
    this.dynamicSrcAdaptiveProfile = resolveDynamicSrcAdaptiveProfile({
      adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
      stressScore: this.getDynamicSrcStressScore(),
      elevatedScoreThreshold: options.elevatedScoreThreshold,
      criticalScoreThreshold: options.criticalScoreThreshold,
    });
    this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
    this.emitRobustnessSnapshot(true);

    if (this.dynamicSrcSettingsListenerCleanup) return;
    if (this.dynamicSrcSettingsListenerInitPromise) {
      await this.dynamicSrcSettingsListenerInitPromise;
      return;
    }

    const applyPersistedDynamicSrcSettings = () => {
      const next = this.readDynamicSrcAutoSettings();
      const changed =
        next.enabled !== this.dynamicSrcAutoEnabled ||
        next.adaptiveEnabled !== this.dynamicSrcAdaptiveEnabled ||
        next.learningEnabled !== this.dynamicSrcLearningEnabled;
      this.dynamicSrcAutoEnabled = next.enabled;
      this.dynamicSrcAdaptiveEnabled = next.adaptiveEnabled;
      this.dynamicSrcLearningEnabled = next.learningEnabled;
      if (!this.dynamicSrcLearningEnabled) {
        this.clearDynamicSrcLearningPersistTimer();
      }
      this.dynamicSrcRestoreDebounceMs = next.restoreDebounceMs;
      this.dynamicSrcMinSwitchIntervalMs = next.minSwitchIntervalMs;
      this.dynamicSrcSeekHoldMs = next.seekHoldMs;
      this.dynamicSrcUnderrunHoldMs = next.underrunHoldMs;
      this.dynamicSrcSharedStressHoldMs = next.sharedStressHoldMs;
      this.dynamicSrcOutputErrorHoldMs = next.outputErrorHoldMs;
      if (!this.dynamicSrcAutoEnabled) {
        this.dynamicSrcProfile = 'quality';
        this.dynamicSrcAdaptiveProfile = 'baseline';
        this.dynamicSrcHoldUntilMs = 0;
        this.clearDynamicSrcRestoreTimer();
      } else {
        this.dynamicSrcAdaptiveProfile = resolveDynamicSrcAdaptiveProfile({
          adaptiveEnabled: this.dynamicSrcAdaptiveEnabled,
          stressScore: this.getDynamicSrcStressScore(),
          elevatedScoreThreshold: options.elevatedScoreThreshold,
          criticalScoreThreshold: options.criticalScoreThreshold,
        });
        this.scheduleDynamicSrcRestoreEvaluation();
      }
      this.evaluateDynamicSrcAutoDegradation({ triggerActions: false });
      if (changed) {
        this.emitRobustnessSnapshot(true);
      }
    };

    this.dynamicSrcSettingsListenerInitPromise = (async () => {
      if (this.dynamicSrcSettingsListenerCleanup) return;

      const settingsCleanup = await setupDualListener(
        [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS],
        [],
        applyPersistedDynamicSrcSettings
      );

      const learningCleanup = await setupDualListener(
        [STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE],
        [],
        () => {
          const nextProfile = this.parseDynamicSrcLearningProfile(
            readString(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE)
          );
          const nextSignature = JSON.stringify(nextProfile);
          if (nextSignature === this.dynamicSrcLearningLastPersistedSignature) {
            return;
          }
          this.dynamicSrcLearningProfile = nextProfile;
          this.dynamicSrcLearningLastPersistedSignature = nextSignature;
          this.dynamicSrcLearningLastPersistAtMs = Date.now();
          this.emitRobustnessSnapshot(true);
        }
      );

      this.dynamicSrcSettingsListenerCleanup = () => {
        settingsCleanup();
        learningCleanup();
      };
    })().finally(() => {
      this.dynamicSrcSettingsListenerInitPromise = null;
    });

    await this.dynamicSrcSettingsListenerInitPromise;
  
}
