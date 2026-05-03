import {
  evaluateAutoOutputSwitch,
  isSharedOutputBackendId,
  resolveAutoOutputBackendChain,
  resolveNextAutoOutputBackend,
  type AutoOutputFailoverConfig,
  type EvaluateAutoOutputSwitchResult,
} from './audioOutputFailoverController';
import type { NativeAudioComponentsStatePayload } from './nativeAudioServiceTypes';

export type NativeAudioOutputBackendControllerSnapshot = {
  availableOutputBackends: string[];
  currentOutputBackendId: string | null;
  currentOutputDeviceId: string | null;
  currentOutputDeviceName: string | null;
  backendSwitchInFlight: boolean;
  autoBackendSwitchCount: number;
  lastAutoBackendSwitchAtMs: number | null;
  lastAutoBackendSwitchReason: string | null;
};

export type NativeAudioOutputBackendControllerOptions = {
  config: AutoOutputFailoverConfig;
  isWindowsOutputPlatform: () => boolean;
};

function normalizeBackendList(backends: string[]): string[] {
  return Array.from(new Set(backends.filter((backend) => backend.length > 0)));
}

export class NativeAudioOutputBackendController {
  private availableBackends: string[] = [];
  private outputBackendId: string | null = null;
  private outputDeviceId: string | null = null;
  private outputDeviceName: string | null = null;
  private switchInFlight = false;
  private switchCount = 0;
  private lastSwitchAtMs: number | null = null;
  private lastSwitchReason: string | null = null;

  constructor(private readonly options: NativeAudioOutputBackendControllerOptions) {}

  get availableOutputBackends(): string[] {
    return [...this.availableBackends];
  }

  get currentOutputBackendId(): string | null {
    return this.outputBackendId;
  }

  get currentOutputDeviceId(): string | null {
    return this.outputDeviceId;
  }

  get currentOutputDeviceName(): string | null {
    return this.outputDeviceName;
  }

  get backendSwitchInFlight(): boolean {
    return this.switchInFlight;
  }

  set backendSwitchInFlight(value: boolean) {
    this.switchInFlight = value;
  }

  get autoBackendSwitchCount(): number {
    return this.switchCount;
  }

  get lastAutoBackendSwitchAtMs(): number | null {
    return this.lastSwitchAtMs;
  }

  get lastAutoBackendSwitchReason(): string | null {
    return this.lastSwitchReason;
  }

  replaceOutputBackends(backends: string[]): void {
    this.availableBackends = normalizeBackendList(backends);
  }

  mergeOutputBackends(backends: string[]): void {
    this.availableBackends = normalizeBackendList([...this.availableBackends, ...backends]);
  }

  setCurrentOutputBackendId(backendId: string | null): void {
    this.outputBackendId = backendId;
    if (backendId) {
      this.mergeOutputBackends([backendId]);
    }
  }

  applyRuntimeAudioComponentsState(components: NativeAudioComponentsStatePayload): void {
    this.outputBackendId = components.outputBackendId ?? null;
    this.outputDeviceId = components.outputDeviceId ?? null;
    this.outputDeviceName = components.outputDevice ?? null;
    if (components.outputBackendId) {
      this.mergeOutputBackends([components.outputBackendId]);
    }
  }

  isSharedOutputBackend(backendId: string | null | undefined): backendId is string {
    return isSharedOutputBackendId(backendId);
  }

  resolveAutoBackendChain(): string[] {
    return resolveAutoOutputBackendChain({
      availableBackends: this.availableBackends,
      currentBackendId: this.outputBackendId,
      isWindows: this.options.isWindowsOutputPlatform(),
    });
  }

  resolveNextAutoBackend(): string | null {
    return resolveNextAutoOutputBackend(this.resolveAutoBackendChain(), this.outputBackendId);
  }

  evaluateAutoSwitch(input: {
    reason: string;
    nowMs: number;
    lastUnderrunFrames: number;
    underrunSpikeTimestampsMs: number[];
  }): EvaluateAutoOutputSwitchResult {
    return evaluateAutoOutputSwitch({
      reason: input.reason,
      nowMs: input.nowMs,
      backendSwitchInFlight: this.switchInFlight,
      lastAutoSwitchAtMs: this.lastSwitchAtMs,
      lastUnderrunFrames: input.lastUnderrunFrames,
      underrunSpikeTimestampsMs: input.underrunSpikeTimestampsMs,
      config: this.options.config,
    });
  }

  canTryAutoSwitch(input: { nowMs: number; pinned: boolean }): boolean {
    if (this.switchInFlight) return false;
    if (!this.isSharedOutputBackend(this.outputBackendId)) return false;
    if (input.pinned) return false;
    if (
      this.lastSwitchAtMs !== null &&
      input.nowMs - this.lastSwitchAtMs < this.options.config.switchCooldownMs
    ) {
      return false;
    }
    return true;
  }

  beginSwitch(): boolean {
    if (this.switchInFlight) return false;
    this.switchInFlight = true;
    return true;
  }

  finishSwitch(): void {
    this.switchInFlight = false;
  }

  markAutoSwitch(reason: string, nowMs: number): void {
    this.switchCount += 1;
    this.lastSwitchAtMs = nowMs;
    this.lastSwitchReason = reason;
  }

  collectSnapshot(): NativeAudioOutputBackendControllerSnapshot {
    return {
      availableOutputBackends: this.availableOutputBackends,
      currentOutputBackendId: this.outputBackendId,
      currentOutputDeviceId: this.outputDeviceId,
      currentOutputDeviceName: this.outputDeviceName,
      backendSwitchInFlight: this.switchInFlight,
      autoBackendSwitchCount: this.switchCount,
      lastAutoBackendSwitchAtMs: this.lastSwitchAtMs,
      lastAutoBackendSwitchReason: this.lastSwitchReason,
    };
  }
}
