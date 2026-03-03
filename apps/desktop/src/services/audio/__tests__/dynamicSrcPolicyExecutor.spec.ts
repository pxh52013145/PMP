import { describe, expect, it } from 'vitest';

import {
  DynamicSrcPolicyExecutor,
  isSameDynamicSrcPolicy,
} from '../dynamicSrcPolicyExecutor';
import type { NativeAudioSrcPolicy } from '../nativeAudioServiceTypes';

const QUALITY_POLICY: NativeAudioSrcPolicy = {
  srcMode: 'match-output',
  srcBackend: 'rubato',
  srcTargetSampleRate: null,
};

const LATENCY_POLICY: NativeAudioSrcPolicy = {
  srcMode: 'target-rate',
  srcBackend: 'linear-simd',
  srcTargetSampleRate: 48_000,
};

describe('dynamicSrcPolicyExecutor', () => {
  it('detects equivalent policies', () => {
    expect(isSameDynamicSrcPolicy(QUALITY_POLICY, { ...QUALITY_POLICY })).toBe(true);
    expect(isSameDynamicSrcPolicy(QUALITY_POLICY, LATENCY_POLICY)).toBe(false);
  });

  it('skips when target already equals current policy', () => {
    const executor = new DynamicSrcPolicyExecutor();
    const plan = executor.plan({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: { ...QUALITY_POLICY },
      nowMs: 1_000,
      minSwitchIntervalMs: 600,
    });

    expect(plan.action).toBe('skip-current');
  });

  it('skips when the same target is already pending', () => {
    const executor = new DynamicSrcPolicyExecutor();
    executor.beginApply(LATENCY_POLICY, 1_000);

    const plan = executor.plan({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: { ...LATENCY_POLICY },
      nowMs: 1_050,
      minSwitchIntervalMs: 600,
    });

    expect(plan.action).toBe('skip-pending');
  });

  it('defers when min switch interval is not satisfied', () => {
    const executor = new DynamicSrcPolicyExecutor();
    executor.beginApply(QUALITY_POLICY, 2_000);
    executor.finishApply(QUALITY_POLICY);

    const plan = executor.plan({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: LATENCY_POLICY,
      nowMs: 2_200,
      minSwitchIntervalMs: 600,
    });

    expect(plan.action).toBe('defer');
    if (plan.action === 'defer') {
      expect(plan.delayMs).toBe(400);
    }
  });

  it('applies immediately when no pending and interval is satisfied', () => {
    const executor = new DynamicSrcPolicyExecutor();
    const plan = executor.plan({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: LATENCY_POLICY,
      nowMs: 3_000.8,
      minSwitchIntervalMs: 0,
    });

    expect(plan.action).toBe('apply');
    if (plan.action === 'apply') {
      expect(plan.nowMs).toBe(3_000);
    }
  });

  it('clears pending marker after finishApply', () => {
    const executor = new DynamicSrcPolicyExecutor();
    executor.beginApply(LATENCY_POLICY, 1_000);
    executor.finishApply(LATENCY_POLICY);

    const plan = executor.plan({
      currentPolicy: QUALITY_POLICY,
      targetPolicy: LATENCY_POLICY,
      nowMs: 2_000,
      minSwitchIntervalMs: 0,
    });

    expect(plan.action).toBe('apply');
  });
});

