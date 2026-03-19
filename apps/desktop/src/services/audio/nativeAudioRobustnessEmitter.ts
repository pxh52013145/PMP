import type { AudioRobustnessSnapshot } from './types';
import type { RobustnessListener } from './nativeAudioServiceTypes';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

const telemetry = getTelemetryLogger('audio', 'nativeAudioRobustnessEmitter');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type NativeAudioRobustnessEmitterSource = {
  getCallbacks(): Set<RobustnessListener>;
  isEmissionInProgress(): boolean;
  setEmissionInProgress(value: boolean): void;
  isEmissionPendingForce(): boolean;
  setEmissionPendingForce(value: boolean): void;
  getLastEmittedSignature(): string | null;
  setLastEmittedSignature(value: string | null): void;
  buildSnapshot(): AudioRobustnessSnapshot;
  reEmit(force: boolean): void;
};

export function emitNativeAudioRobustnessSnapshot(
  source: NativeAudioRobustnessEmitterSource,
  force: boolean = false,
): void {
  const callbacks = source.getCallbacks();
  if (callbacks.size === 0) return;

  if (source.isEmissionInProgress()) {
    source.setEmissionPendingForce(source.isEmissionPendingForce() || force);
    return;
  }

  source.setEmissionInProgress(true);

  const snapshot = source.buildSnapshot();
  const signature = JSON.stringify(snapshot);
  try {
    if (!force && signature === source.getLastEmittedSignature()) {
      return;
    }
    source.setLastEmittedSignature(signature);
    callbacks.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (error) {
        telemetry.warn('native_audio.robustness_listener.callback_failed', {
          message: readErrorMessage(error),
        });
      }
    });
  } finally {
    source.setEmissionInProgress(false);
  }

  if (source.isEmissionPendingForce()) {
    const nextForce = source.isEmissionPendingForce();
    source.setEmissionPendingForce(false);
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => source.reEmit(nextForce));
    } else {
      void Promise.resolve().then(() => source.reEmit(nextForce));
    }
  }
}
