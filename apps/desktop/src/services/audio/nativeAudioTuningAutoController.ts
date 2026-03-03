import {
  resolveAudioTuningTransition,
  type AudioTuningControllerState,
  type AudioTuningTransitionDecision,
} from './audioTuningProfiles';
import type { AudioRobustnessSnapshot } from './types';

export type NativeAudioTuningAutoControllerSettings = {
  elevatedStressScore: number;
  criticalStressScore: number;
  criticalUnderrunEventsWindow: number;
  criticalOverflowGrowthTicks: number;
  stableWindowMs: number;
  minSwitchIntervalMs: number;
  postSwitchObserveWindowMs: number;
};

export function resolveNativeAudioTuningAutoControllerDecision(input: {
  nowMs: number;
  snapshot: AudioRobustnessSnapshot;
  state: AudioTuningControllerState;
  settings: NativeAudioTuningAutoControllerSettings;
}): AudioTuningTransitionDecision {
  return resolveAudioTuningTransition({
    nowMs: input.nowMs,
    snapshot: input.snapshot,
    state: input.state,
    thresholds: {
      elevatedStressScore: input.settings.elevatedStressScore,
      criticalStressScore: input.settings.criticalStressScore,
      criticalUnderrunEventsWindow: input.settings.criticalUnderrunEventsWindow,
      criticalOverflowGrowthTicks: input.settings.criticalOverflowGrowthTicks,
      stableWindowMs: input.settings.stableWindowMs,
      minSwitchIntervalMs: input.settings.minSwitchIntervalMs,
      postSwitchObserveWindowMs: input.settings.postSwitchObserveWindowMs,
    },
  });
}

