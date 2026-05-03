import { describe, expect, it } from 'vitest';
import { NativeAudioOutputBackendController } from './nativeAudioOutputBackendController';

const CONFIG = {
  underrunWindowMs: 15_000,
  underrunTriggerCount: 3,
  underrunFrameSpikeTrigger: 1024,
  switchCooldownMs: 45_000,
};

function createController(options?: { windows?: boolean }) {
  return new NativeAudioOutputBackendController({
    config: CONFIG,
    isWindowsOutputPlatform: () => options?.windows ?? true,
  });
}

describe('NativeAudioOutputBackendController', () => {
  it('orders shared Windows backends without exposing exclusive backends to auto failover', () => {
    const controller = createController({ windows: true });
    controller.replaceOutputBackends(['rodio-cpal', 'wasapi-exclusive', 'wasapi']);
    controller.setCurrentOutputBackendId('wasapi');

    expect(controller.resolveAutoBackendChain()).toEqual([
      'wasapi',
      'rodio-cpal',
    ]);
    expect(controller.resolveNextAutoBackend()).toBe('rodio-cpal');
  });

  it('prevents auto switching while pinned or inside cooldown', () => {
    const controller = createController();
    controller.replaceOutputBackends(['wasapi', 'rodio-cpal']);
    controller.setCurrentOutputBackendId('wasapi');

    expect(controller.canTryAutoSwitch({ nowMs: 1_000, pinned: true })).toBe(false);
    expect(controller.canTryAutoSwitch({ nowMs: 1_000, pinned: false })).toBe(true);

    controller.markAutoSwitch('underrun-spike', 1_000);

    expect(controller.canTryAutoSwitch({ nowMs: 20_000, pinned: false })).toBe(false);
    expect(controller.canTryAutoSwitch({ nowMs: 47_000, pinned: false })).toBe(true);
  });

  it('coalesces in-flight switch attempts and records completed auto switches', () => {
    const controller = createController();
    controller.setCurrentOutputBackendId('wasapi');

    expect(controller.beginSwitch()).toBe(true);
    expect(controller.beginSwitch()).toBe(false);
    expect(controller.canTryAutoSwitch({ nowMs: 1_000, pinned: false })).toBe(false);

    controller.finishSwitch();
    controller.markAutoSwitch('output-error', 2_000);

    expect(controller.collectSnapshot()).toMatchObject({
      backendSwitchInFlight: false,
      autoBackendSwitchCount: 1,
      lastAutoBackendSwitchAtMs: 2_000,
      lastAutoBackendSwitchReason: 'output-error',
    });
  });

  it('uses underrun window pressure before allowing underrun failover', () => {
    const controller = createController();
    controller.setCurrentOutputBackendId('wasapi');

    expect(
      controller.evaluateAutoSwitch({
        reason: 'underrun-spike',
        nowMs: 10_000,
        lastUnderrunFrames: 128,
        underrunSpikeTimestampsMs: [1_000, 2_000],
      })
    ).toMatchObject({
      shouldSwitch: false,
      prunedUnderrunSpikeTimestampsMs: [1_000, 2_000],
    });

    expect(
      controller.evaluateAutoSwitch({
        reason: 'underrun-spike',
        nowMs: 10_000,
        lastUnderrunFrames: 128,
        underrunSpikeTimestampsMs: [1_000, 2_000, 3_000],
      })
    ).toMatchObject({
      shouldSwitch: true,
      prunedUnderrunSpikeTimestampsMs: [1_000, 2_000, 3_000],
    });
  });
});
