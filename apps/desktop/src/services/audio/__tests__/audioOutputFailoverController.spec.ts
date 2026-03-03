import { describe, expect, it } from 'vitest';

import {
  evaluateAutoOutputSwitch,
  pruneUnderrunSpikeTimestamps,
  resolveAutoOutputBackendChain,
  resolveNextAutoOutputBackend,
} from '../audioOutputFailoverController';

describe('audioOutputFailoverController', () => {
  const baseConfig = {
    underrunWindowMs: 15_000,
    underrunTriggerCount: 3,
    underrunFrameSpikeTrigger: 1024,
    switchCooldownMs: 45_000,
  };

  it('orders Windows shared backends by preferred priority', () => {
    const chain = resolveAutoOutputBackendChain({
      availableBackends: ['rodio-cpal', 'wasapi', 'wasapi-shared-raw'],
      currentBackendId: 'wasapi',
      isWindows: true,
    });

    expect(chain).toEqual(['wasapi-shared-raw', 'wasapi', 'rodio-cpal']);
  });

  it('keeps non-Windows backend chain order stable', () => {
    const chain = resolveAutoOutputBackendChain({
      availableBackends: ['rodio-cpal', 'wasapi'],
      currentBackendId: 'wasapi',
      isWindows: false,
    });

    expect(chain).toEqual(['rodio-cpal', 'wasapi']);
  });

  it('evaluates auto switch trigger with cooldown and underrun window pruning', () => {
    const nowMs = 100_000;
    const decision = evaluateAutoOutputSwitch({
      reason: 'underrun-spike',
      nowMs,
      backendSwitchInFlight: false,
      lastAutoSwitchAtMs: nowMs - 1_000,
      lastUnderrunFrames: 128,
      underrunSpikeTimestampsMs: [nowMs - 20_000, nowMs - 10_000, nowMs - 8_000],
      config: baseConfig,
    });

    expect(decision.shouldSwitch).toBe(false);
    expect(decision.prunedUnderrunSpikeTimestampsMs).toEqual([nowMs - 10_000, nowMs - 8_000]);

    const afterCooldown = evaluateAutoOutputSwitch({
      reason: 'underrun-spike',
      nowMs,
      backendSwitchInFlight: false,
      lastAutoSwitchAtMs: nowMs - 60_000,
      lastUnderrunFrames: 128,
      underrunSpikeTimestampsMs: [nowMs - 12_000, nowMs - 10_000, nowMs - 8_000],
      config: baseConfig,
    });

    expect(afterCooldown.shouldSwitch).toBe(true);
  });

  it('rotates to next backend in chain', () => {
    const next = resolveNextAutoOutputBackend(
      ['wasapi-shared-raw', 'wasapi', 'rodio-cpal'],
      'wasapi'
    );
    expect(next).toBe('rodio-cpal');

    const wrap = resolveNextAutoOutputBackend(
      ['wasapi-shared-raw', 'wasapi', 'rodio-cpal'],
      'rodio-cpal'
    );
    expect(wrap).toBe('wasapi-shared-raw');
  });

  it('prunes underrun spikes by sliding window', () => {
    const nowMs = 20_000;
    const pruned = pruneUnderrunSpikeTimestamps([1_000, 7_000, 18_000], nowMs, 10_000);
    expect(pruned).toEqual([18_000]);
  });
});

