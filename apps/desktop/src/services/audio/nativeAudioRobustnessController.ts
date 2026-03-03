import { RobustnessEmissionGate } from './nativeAudioRobustnessEmissionGate';
import type { RobustnessListener } from './nativeAudioServiceTypes';
import type { AudioRobustnessSnapshot } from './types';

export type NativeAudioRobustnessControllerOptions = {
  minIntervalMs: number;
  forceBurstWindowMs: number;
  forceBurstLimit: number;
  buildSnapshot: () => AudioRobustnessSnapshot;
  onListenerError?: (error: unknown) => void;
};

export class NativeAudioRobustnessController {
  private readonly callbacks = new Set<RobustnessListener>();
  private readonly gate: RobustnessEmissionGate;
  private lastEmittedSignature: string | null = null;
  private emissionInProgress = false;
  private emissionPendingForce = false;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledForce = false;

  constructor(private readonly options: NativeAudioRobustnessControllerOptions) {
    this.gate = new RobustnessEmissionGate({
      minIntervalMs: options.minIntervalMs,
      forceBurstWindowMs: options.forceBurstWindowMs,
      forceBurstLimit: options.forceBurstLimit,
    });
  }

  getSnapshot(): AudioRobustnessSnapshot {
    return this.options.buildSnapshot();
  }

  subscribe(callback: RobustnessListener): () => void {
    this.callbacks.add(callback);
    callback(this.options.buildSnapshot());
    return () => {
      this.callbacks.delete(callback);
    };
  }

  emit(force: boolean = false): void {
    if (this.callbacks.size === 0) return;

    const plan = this.gate.plan(force);
    if (plan.action === 'defer') {
      this.emissionPendingForce = this.emissionPendingForce || plan.force;
      this.scheduleDeferredEmission(plan.delayMs, plan.force);
      return;
    }

    const effectiveForce = plan.force;
    if (effectiveForce) {
      this.clearScheduledEmission();
    }

    if (this.emissionInProgress) {
      this.emissionPendingForce = this.emissionPendingForce || effectiveForce;
      return;
    }

    this.emissionInProgress = true;

    const snapshot = this.options.buildSnapshot();
    const signature = JSON.stringify(snapshot);
    try {
      if (!effectiveForce && signature === this.lastEmittedSignature) {
        this.gate.markEmitted();
        return;
      }
      this.lastEmittedSignature = signature;
      this.gate.markEmitted();
      this.callbacks.forEach((callback) => {
        try {
          callback(snapshot);
        } catch (error) {
          this.options.onListenerError?.(error);
        }
      });
    } finally {
      this.emissionInProgress = false;
    }

    if (this.emissionPendingForce) {
      const nextForce = this.emissionPendingForce;
      this.emissionPendingForce = false;
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => this.emit(nextForce));
      } else {
        void Promise.resolve().then(() => this.emit(nextForce));
      }
    }
  }

  resetRuntimeState(): void {
    this.emissionPendingForce = false;
    this.emissionInProgress = false;
    this.clearScheduledEmission();
    this.gate.reset();
    this.lastEmittedSignature = null;
  }

  destroy(): void {
    this.callbacks.clear();
    this.resetRuntimeState();
  }

  private clearScheduledEmission(): void {
    if (this.scheduledTimer === null) return;
    clearTimeout(this.scheduledTimer);
    this.scheduledTimer = null;
    this.scheduledForce = false;
  }

  private scheduleDeferredEmission(delayMs: number, force: boolean = false): void {
    if (this.scheduledTimer !== null) {
      this.scheduledForce = this.scheduledForce || force;
      return;
    }

    this.scheduledForce = force;
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      const scheduledForce = this.scheduledForce;
      this.scheduledForce = false;
      this.emit(scheduledForce);
    }, Math.max(1, Math.floor(delayMs)));
  }
}

