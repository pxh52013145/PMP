import type { PlaybackState } from './types';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface NativeAudioSpectrumControllerOptions {
  idleTimeoutMs?: number;
  playbackGraceMs?: number;
  now?: () => number;
  setBackendEnabled: (enabled: boolean) => Promise<void> | void;
  onBackendSetFailed?: (enabled: boolean, error: unknown) => void;
  onClearData?: () => void;
}

function isPlaybackSpectrumActive(playbackState: PlaybackState): boolean {
  return playbackState === 'playing' || playbackState === 'buffering';
}

function isPlaybackTerminal(playbackState: PlaybackState): boolean {
  return playbackState === 'stopped' || playbackState === 'idle' || playbackState === 'error';
}

export class NativeAudioSpectrumController {
  private readonly idleTimeoutMs: number;
  private readonly playbackGraceMs: number;
  private readonly now: () => number;

  private enabled = false;
  private enablePending = false;
  private disableTimer: TimerHandle | null = null;
  private lastTouchAtMs = 0;
  private lastPlaybackActiveAtMs = 0;
  private disposed = false;

  constructor(private readonly options: NativeAudioSpectrumControllerOptions) {
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 2500);
    this.playbackGraceMs = Math.max(0, options.playbackGraceMs ?? 4000);
    this.now = options.now ?? (() => Date.now());
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  handlePlaybackState(playbackState: PlaybackState): void {
    if (this.disposed) return;
    if (isPlaybackSpectrumActive(playbackState)) {
      this.lastPlaybackActiveAtMs = this.now();
    }
    if (isPlaybackTerminal(playbackState)) {
      this.lastTouchAtMs = 0;
      this.maybeDisable();
    }
  }

  touch(playbackState: PlaybackState): void {
    if (this.disposed) return;

    const nowMs = this.now();
    const playbackActive = isPlaybackSpectrumActive(playbackState);
    const withinPlaybackGrace = nowMs - this.lastPlaybackActiveAtMs <= this.playbackGraceMs;

    if (!playbackActive && !withinPlaybackGrace) {
      this.lastTouchAtMs = 0;
      this.maybeDisable();
      return;
    }

    this.lastTouchAtMs = nowMs;
    this.ensureEnabled();
    this.scheduleDisable();
  }

  reset(): void {
    this.clearDisableTimer();
    this.lastTouchAtMs = 0;
    this.lastPlaybackActiveAtMs = 0;
    if (this.enabled) {
      void this.setEnabled(false);
      return;
    }
    this.options.onClearData?.();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDisableTimer();
    this.lastTouchAtMs = 0;
    this.lastPlaybackActiveAtMs = 0;
    if (this.enabled) {
      void this.setEnabled(false);
      return;
    }
    this.options.onClearData?.();
  }

  private ensureEnabled(): void {
    if (this.enabled || this.enablePending) return;
    this.enablePending = true;
    void this.setEnabled(true).finally(() => {
      this.enablePending = false;
    });
  }

  private scheduleDisable(): void {
    if (this.disableTimer !== null) return;
    if (typeof globalThis.setTimeout !== 'function') return;

    const timeout = Math.max(500, this.idleTimeoutMs + 100);
    this.disableTimer = globalThis.setTimeout(() => {
      this.disableTimer = null;
      this.maybeDisable();
    }, timeout);
  }

  private clearDisableTimer(): void {
    if (this.disableTimer === null) return;
    if (typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(this.disableTimer);
    }
    this.disableTimer = null;
  }

  private maybeDisable(): void {
    const nowMs = this.now();
    const idleMs =
      this.lastTouchAtMs > 0 ? nowMs - this.lastTouchAtMs : Number.POSITIVE_INFINITY;
    if (idleMs < this.idleTimeoutMs) {
      this.scheduleDisable();
      return;
    }
    if (!this.enabled) return;
    void this.setEnabled(false);
  }

  private async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    try {
      await this.options.setBackendEnabled(enabled);
    } catch (error) {
      this.options.onBackendSetFailed?.(enabled, error);
    }
    if (!enabled) {
      this.options.onClearData?.();
    }
  }
}
