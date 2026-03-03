import { describe, expect, it } from 'vitest';

import { RobustnessEmissionGate } from '../nativeAudioRobustnessEmissionGate';

describe('nativeAudioRobustnessEmissionGate', () => {
  it('defers normal emission when within minimum interval', () => {
    const gate = new RobustnessEmissionGate({
      minIntervalMs: 120,
      forceBurstWindowMs: 300,
      forceBurstLimit: 3,
    });

    const first = gate.plan(false, 1_000);
    expect(first).toEqual({ action: 'emit', force: false });
    gate.markEmitted(1_000);

    const second = gate.plan(false, 1_070);
    expect(second.action).toBe('defer');
    if (second.action !== 'defer') {
      throw new Error('expected deferred plan');
    }
    expect(second.force).toBe(false);
    expect(second.delayMs).toBe(50);
  });

  it('limits forced burst within the same window', () => {
    const gate = new RobustnessEmissionGate({
      minIntervalMs: 120,
      forceBurstWindowMs: 300,
      forceBurstLimit: 2,
    });

    expect(gate.plan(true, 2_000)).toEqual({ action: 'emit', force: true });
    gate.markEmitted(2_000);

    expect(gate.plan(true, 2_030)).toEqual({ action: 'emit', force: true });
    gate.markEmitted(2_030);

    const third = gate.plan(true, 2_060);
    expect(third.action).toBe('defer');
    if (third.action !== 'defer') {
      throw new Error('expected forced deferred plan');
    }
    expect(third.force).toBe(true);
    expect(third.delayMs).toBeGreaterThan(0);
  });

  it('restores forced emission after burst window passes', () => {
    const gate = new RobustnessEmissionGate({
      minIntervalMs: 120,
      forceBurstWindowMs: 300,
      forceBurstLimit: 1,
    });

    expect(gate.plan(true, 3_000)).toEqual({ action: 'emit', force: true });
    gate.markEmitted(3_000);

    const throttled = gate.plan(true, 3_100);
    expect(throttled.action).toBe('defer');
    if (throttled.action !== 'defer') {
      throw new Error('expected forced deferred plan');
    }
    expect(throttled.force).toBe(true);

    const restored = gate.plan(true, 3_350);
    expect(restored).toEqual({ action: 'emit', force: true });
  });
});
