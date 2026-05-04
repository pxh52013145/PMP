import { describe, expect, it } from 'vitest';
import {
  applyNativeAudioEngineStatePayload,
  type NativeAudioEngineState,
} from './nativeAudioEngineStatePayloadAdapter';
import type { NativeAudioStatePayload } from './nativeAudioServiceTypes';

function createState(): NativeAudioEngineState {
  return {
    lastSchedulerProfile: 'normal',
    stabilityActionProfile: 'normal',
    stabilityProfile: 'balanced',
    sourcePrepareProfile: 'baseline',
    stabilityPrimaryReason: null,
    stabilityReasonCodes: [],
    stabilityHintProfile: undefined,
    stabilityHintPrimaryReason: null,
    stabilityHintReasonCodes: [],
    transportMode: 'robust',
    hqSrcPhaseMode: 'linear',
    srcMode: 'match-output',
    srcBackend: 'rubato',
    srcTargetSampleRate: null,
    outputQuantizationMode: 'round',
    hqSrcStopbandDb: 140,
    hqSrcActive: false,
    hqSrcRatio: 1,
    transportExactInt32Container: true,
  };
}

describe('nativeAudioEngineStatePayloadAdapter', () => {
  it('applies engine and stability state fields from native payloads', () => {
    const state = createState();

    applyNativeAudioEngineStatePayload(state, {
      schedulerProfile: 'critical',
      stabilityActionProfile: 'guarded',
      stabilityProfile: 'game-safe',
      sourcePrepareProfile: 'aggressive',
      stabilityPrimaryReason: 'render-stress',
      stabilityReasonCodes: ['underrun', '', 'shared-stress'],
      stabilityHintProfile: 'normal',
      stabilityHintPrimaryReason: 'source-prepare',
      stabilityHintReasonCodes: ['warmup', ''],
      transportMode: 'transport-exact',
      hqSrcPhaseMode: 'minimum',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96_000.9,
      outputQuantizationMode: 'tpdf',
      hqSrcStopbandDb: 201.8,
      hqSrcActive: true,
      hqSrcRatio: 2.5,
      transportExactInt32Container: false,
    });

    expect(state.lastSchedulerProfile).toBe('critical');
    expect(state.stabilityActionProfile).toBe('guarded');
    expect(state.stabilityProfile).toBe('game-safe');
    expect(state.sourcePrepareProfile).toBe('aggressive');
    expect(state.stabilityPrimaryReason).toBe('render-stress');
    expect(state.stabilityReasonCodes).toEqual(['underrun', 'shared-stress']);
    expect(state.stabilityHintProfile).toBe('normal');
    expect(state.stabilityHintPrimaryReason).toBe('source-prepare');
    expect(state.stabilityHintReasonCodes).toEqual(['warmup']);
    expect(state.transportMode).toBe('transport-exact');
    expect(state.hqSrcPhaseMode).toBe('minimum');
    expect(state.srcMode).toBe('target-rate');
    expect(state.srcBackend).toBe('linear-simd');
    expect(state.srcTargetSampleRate).toBe(96000);
    expect(state.outputQuantizationMode).toBe('tpdf');
    expect(state.hqSrcStopbandDb).toBe(200);
    expect(state.hqSrcActive).toBe(true);
    expect(state.hqSrcRatio).toBe(2.5);
    expect(state.transportExactInt32Container).toBe(false);
  });

  it('preserves invalid enum values while applying clear and clamp semantics', () => {
    const state = createState();
    state.lastSchedulerProfile = 'critical';
    state.stabilityActionProfile = 'critical';
    state.stabilityProfile = 'safe-mode';
    state.sourcePrepareProfile = 'failsafe';
    state.stabilityHintProfile = 'guarded';
    state.stabilityHintReasonCodes = ['previous'];
    state.transportMode = 'transport-exact';
    state.hqSrcPhaseMode = 'intermediate';
    state.srcMode = 'target-rate';
    state.srcBackend = 'linear-simd';
    state.srcTargetSampleRate = 192000;
    state.outputQuantizationMode = 'tpdf';
    state.hqSrcRatio = 1.5;
    state.transportExactInt32Container = false;

    applyNativeAudioEngineStatePayload(state, {
      schedulerProfile: 'invalid',
      stabilityActionProfile: 'invalid',
      stabilityProfile: 'invalid',
      sourcePrepareProfile: 'invalid',
      stabilityPrimaryReason: null,
      stabilityReasonCodes: ['kept', ''],
      stabilityHintProfile: null,
      stabilityHintPrimaryReason: null,
      stabilityHintReasonCodes: null,
      transportMode: 'invalid',
      hqSrcPhaseMode: 'invalid',
      srcMode: 'invalid',
      srcBackend: 'invalid',
      outputQuantizationMode: 'invalid',
      hqSrcStopbandDb: -1.2,
      hqSrcRatio: Number.POSITIVE_INFINITY,
    } as unknown as NativeAudioStatePayload);

    expect(state.lastSchedulerProfile).toBe('critical');
    expect(state.stabilityActionProfile).toBe('critical');
    expect(state.stabilityProfile).toBe('safe-mode');
    expect(state.sourcePrepareProfile).toBe('failsafe');
    expect(state.stabilityPrimaryReason).toBeNull();
    expect(state.stabilityReasonCodes).toEqual(['kept']);
    expect(state.stabilityHintProfile).toBeUndefined();
    expect(state.stabilityHintPrimaryReason).toBeNull();
    expect(state.stabilityHintReasonCodes).toEqual([]);
    expect(state.transportMode).toBe('transport-exact');
    expect(state.hqSrcPhaseMode).toBe('intermediate');
    expect(state.srcMode).toBe('target-rate');
    expect(state.srcBackend).toBe('linear-simd');
    expect(state.srcTargetSampleRate).toBeNull();
    expect(state.outputQuantizationMode).toBe('tpdf');
    expect(state.hqSrcStopbandDb).toBe(0);
    expect(state.hqSrcRatio).toBe(1.5);
    expect(state.transportExactInt32Container).toBe(false);
  });

  it('clamps SRC target sample rates to the native policy range', () => {
    const state = createState();

    applyNativeAudioEngineStatePayload(state, { srcTargetSampleRate: 4000 });
    expect(state.srcTargetSampleRate).toBe(8000);

    applyNativeAudioEngineStatePayload(state, { srcTargetSampleRate: 800000 });
    expect(state.srcTargetSampleRate).toBe(768000);

    applyNativeAudioEngineStatePayload(state, { srcTargetSampleRate: -1 });
    expect(state.srcTargetSampleRate).toBe(768000);
  });
});
