import {
  createAudioTuningControllerState,
  resolveAudioTuningTransition,
  type AudioTuningControllerState,
  type AudioTuningTransitionDecision,
} from './audioTuningProfiles';
import type {
  AudioRobustnessSnapshot,
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
  AudioTuningProfileId,
} from './types';

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

export type NativeAudioTuningAutoControllerSnapshot = {
  settings: AudioTuningAutoSettings;
  state: AudioTuningControllerState;
  applyInFlight: boolean;
  lastReason: string | null;
  lastAppliedAtMs: number | null;
};

export type NativeAudioTuningAutoControllerOptions = {
  initialSettings: AudioTuningAutoSettings;
  initialProfile?: AudioTuningProfileId;
  isDisposed: () => boolean;
  onTick: () => void | Promise<void>;
  setIntervalFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
};

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeSettings(settings: AudioTuningAutoSettings): AudioTuningAutoSettings {
  const elevatedStressScore = clampCount(settings.elevatedStressScore, 4, 1, 20);
  return {
    enabled: settings.enabled,
    tickIntervalMs: clampMs(settings.tickIntervalMs, 1_500, 500, 10_000),
    stableWindowMs: clampMs(settings.stableWindowMs, 30_000, 5_000, 120_000),
    minSwitchIntervalMs: clampMs(settings.minSwitchIntervalMs, 10_000, 1_000, 120_000),
    postSwitchObserveWindowMs: clampMs(
      settings.postSwitchObserveWindowMs,
      15_000,
      1_000,
      120_000
    ),
    elevatedStressScore,
    criticalStressScore: clampCount(
      settings.criticalStressScore,
      Math.max(elevatedStressScore, 8),
      elevatedStressScore,
      30
    ),
    criticalUnderrunEventsWindow: clampCount(
      settings.criticalUnderrunEventsWindow,
      2,
      1,
      12
    ),
    criticalOverflowGrowthTicks: clampCount(settings.criticalOverflowGrowthTicks, 2, 1, 8),
  };
}

export function resolveNativeAudioTuningAutoSettingsPatch(input: {
  patch: AudioTuningAutoSettingsPatch;
  current: AudioTuningAutoSettings;
}): AudioTuningAutoSettings {
  const nextElevatedStressScore = clampCount(
    input.patch.elevatedStressScore,
    input.current.elevatedStressScore,
    1,
    20
  );

  return normalizeSettings({
    enabled:
      typeof input.patch.enabled === 'boolean' ? input.patch.enabled : input.current.enabled,
    tickIntervalMs: clampMs(
      input.patch.tickIntervalMs,
      input.current.tickIntervalMs,
      500,
      10_000
    ),
    stableWindowMs: clampMs(
      input.patch.stableWindowMs,
      input.current.stableWindowMs,
      5_000,
      120_000
    ),
    minSwitchIntervalMs: clampMs(
      input.patch.minSwitchIntervalMs,
      input.current.minSwitchIntervalMs,
      1_000,
      120_000
    ),
    postSwitchObserveWindowMs: clampMs(
      input.patch.postSwitchObserveWindowMs,
      input.current.postSwitchObserveWindowMs,
      1_000,
      120_000
    ),
    elevatedStressScore: nextElevatedStressScore,
    criticalStressScore: clampCount(
      input.patch.criticalStressScore,
      input.current.criticalStressScore,
      nextElevatedStressScore,
      30
    ),
    criticalUnderrunEventsWindow: clampCount(
      input.patch.criticalUnderrunEventsWindow,
      input.current.criticalUnderrunEventsWindow,
      1,
      12
    ),
    criticalOverflowGrowthTicks: clampCount(
      input.patch.criticalOverflowGrowthTicks,
      input.current.criticalOverflowGrowthTicks,
      1,
      8
    ),
  });
}

export class NativeAudioTuningAutoController {
  private settings: AudioTuningAutoSettings;
  private state: AudioTuningControllerState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private applyInFlight = false;
  private lastReason: string | null = null;
  private lastAppliedAtMs: number | null = null;

  constructor(private readonly options: NativeAudioTuningAutoControllerOptions) {
    this.settings = normalizeSettings(options.initialSettings);
    this.state = createAudioTuningControllerState(options.initialProfile ?? 'll-guarded');
  }

  getSettings(): AudioTuningAutoSettings {
    return { ...this.settings };
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get tickIntervalMs(): number {
    return this.settings.tickIntervalMs;
  }

  get stableWindowMs(): number {
    return this.settings.stableWindowMs;
  }

  get minSwitchIntervalMs(): number {
    return this.settings.minSwitchIntervalMs;
  }

  get postSwitchObserveWindowMs(): number {
    return this.settings.postSwitchObserveWindowMs;
  }

  get elevatedStressScore(): number {
    return this.settings.elevatedStressScore;
  }

  get criticalStressScore(): number {
    return this.settings.criticalStressScore;
  }

  get criticalUnderrunEventsWindow(): number {
    return this.settings.criticalUnderrunEventsWindow;
  }

  get criticalOverflowGrowthTicks(): number {
    return this.settings.criticalOverflowGrowthTicks;
  }

  getControllerState(): AudioTuningControllerState {
    return { ...this.state };
  }

  getLastReason(): string | null {
    return this.lastReason;
  }

  getLastAppliedAtMs(): number | null {
    return this.lastAppliedAtMs;
  }

  applySettings(settings: AudioTuningAutoSettings): void {
    this.settings = normalizeSettings(settings);
    this.restartLoop();
  }

  clearLoop(): void {
    if (this.timer === null) return;
    const clearIntervalFn = this.options.clearIntervalFn ?? clearInterval;
    clearIntervalFn(this.timer);
    this.timer = null;
  }

  restartLoop(): void {
    this.clearLoop();
    if (!this.settings.enabled || this.options.isDisposed()) return;

    const setIntervalFn = this.options.setIntervalFn ?? setInterval;
    this.timer = setIntervalFn(() => {
      void this.options.onTick();
    }, this.settings.tickIntervalMs);
  }

  evaluateTick(input: {
    nowMs: number;
    snapshot: AudioRobustnessSnapshot;
  }): AudioTuningTransitionDecision | null {
    if (!this.settings.enabled || this.options.isDisposed()) return null;
    if (this.applyInFlight) return null;

    const decision = resolveNativeAudioTuningAutoControllerDecision({
      nowMs: input.nowMs,
      snapshot: input.snapshot,
      state: this.state,
      settings: this.settings,
    });

    this.state = decision.state;
    this.lastReason = decision.reason;
    return decision;
  }

  beginApply(): boolean {
    if (this.applyInFlight) return false;
    this.applyInFlight = true;
    return true;
  }

  finishApply(): void {
    this.applyInFlight = false;
  }

  markAutoApplied(reason: string, nowMs: number): void {
    this.lastReason = `auto:${reason}`;
    this.lastAppliedAtMs = nowMs;
  }

  markManualApplied(profileId: AudioTuningProfileId, nowMs: number): void {
    this.state = {
      ...this.state,
      activeProfile: profileId,
      lastSwitchAtMs: nowMs,
    };
    this.lastReason = `manual:${profileId}`;
    this.lastAppliedAtMs = nowMs;
  }

  collectSnapshot(): NativeAudioTuningAutoControllerSnapshot {
    return {
      settings: this.getSettings(),
      state: this.getControllerState(),
      applyInFlight: this.applyInFlight,
      lastReason: this.lastReason,
      lastAppliedAtMs: this.lastAppliedAtMs,
    };
  }

  dispose(): void {
    this.clearLoop();
    this.applyInFlight = false;
  }
}
