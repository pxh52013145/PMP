import { describe, expect, it } from 'vitest';

import {
  createAudioTuningControllerState,
  resolveAudioTuningProfilePayload,
  resolveAudioTuningTransition,
  resolveOutputBackendClass,
} from '../audioTuningProfiles';

describe('audioTuningProfiles', () => {
  it('classifies output backend families', () => {
    expect(resolveOutputBackendClass('wasapi-exclusive')).toBe('exclusive');
    expect(resolveOutputBackendClass('wasapi-shared-raw')).toBe('shared-raw');
    expect(resolveOutputBackendClass('wasapi')).toBe('shared');
    expect(resolveOutputBackendClass('rodio-cpal')).toBe('fallback');
    expect(resolveOutputBackendClass(null)).toBe('fallback');
  });

  it('resolves extreme-ll payload for exclusive backend', () => {
    const payload = resolveAudioTuningProfilePayload({
      profileId: 'extreme-ll',
      outputBackendId: 'wasapi-exclusive',
    });

    expect(payload.outputBackendClass).toBe('exclusive');
    expect(payload.streamingBuffer.startOrSeekSeconds).toBe(0.24);
    expect(payload.streamingBuffer.crossfadeSeconds).toBe(0.9);
    expect(payload.streamingBuffer.decodeMode).toBe('streaming');
    expect(payload.streamingBuffer.interactiveProfile).toBe('fast');
    expect(payload.enginePolicy.transportMode).toBe('robust');
    expect(payload.enginePolicy.srcMode).toBe('match-output');
    expect(payload.enginePolicy.srcBackend).toBe('linear-simd');
    expect(payload.dynamicSrcSettings.restoreDebounceMs).toBe(2800);
    expect(payload.dynamicSrcSettings.minSwitchIntervalMs).toBe(400);
    expect(payload.streamingBufferStoragePayload.userSetDecodeMode).toBe(true);
  });

  it('resolves robust-shield payload for fallback backend', () => {
    const payload = resolveAudioTuningProfilePayload({
      profileId: 'robust-shield',
      outputBackendId: 'rodio-cpal',
    });

    expect(payload.outputBackendClass).toBe('fallback');
    expect(payload.streamingBuffer.startOrSeekSeconds).toBe(1.2);
    expect(payload.streamingBuffer.crossfadeSeconds).toBe(1.95);
    expect(payload.streamingBuffer.interactiveProfile).toBe('stable');
    expect(payload.enginePolicy.srcBackend).toBe('linear-simd');
    expect(payload.dynamicSrcSettings.underrunHoldMs).toBe(22000);
  });

  it('switches immediately to robust-shield under critical pressure', () => {
    const decision = resolveAudioTuningTransition({
      nowMs: 7000,
      snapshot: {
        schedulerProfile: 'critical',
        dynamicSrcStressScore: 3,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: {
        activeProfile: 'extreme-ll',
        lastSwitchAtMs: 5000,
        stableSinceMs: null,
        lastOutputWaitTimeoutCount: 0,
        lastOutputRenderUnderrunEvents: 0,
      },
    });

    expect(decision.changed).toBe(true);
    expect(decision.nextProfile).toBe('robust-shield');
    expect(decision.reason).toBe('critical-pressure');
    expect(decision.state.lastSwitchAtMs).toBe(7000);
  });

  it('steps up from extreme-ll to ll-guarded when scheduler is guarded', () => {
    const decision = resolveAudioTuningTransition({
      nowMs: 10_000,
      snapshot: {
        schedulerProfile: 'guarded',
        dynamicSrcStressScore: 0,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: {
        activeProfile: 'extreme-ll',
        lastSwitchAtMs: 9500,
        stableSinceMs: null,
        lastOutputWaitTimeoutCount: 0,
        lastOutputRenderUnderrunEvents: 0,
      },
    });

    expect(decision.changed).toBe(true);
    expect(decision.nextProfile).toBe('ll-guarded');
    expect(decision.reason).toBe('guarded-pressure');
  });

  it('holds recovery switch during cooldown/observe windows', () => {
    const first = resolveAudioTuningTransition({
      nowMs: 11_000,
      snapshot: {
        schedulerProfile: 'normal',
        dynamicSrcStressScore: 0,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: {
        activeProfile: 'robust-shield',
        lastSwitchAtMs: 5000,
        stableSinceMs: 9000,
        lastOutputWaitTimeoutCount: 0,
        lastOutputRenderUnderrunEvents: 0,
      },
    });

    expect(first.changed).toBe(false);
    expect(first.nextProfile).toBe('robust-shield');
    expect(first.reason).toBe('cooldown-hold');

    const second = resolveAudioTuningTransition({
      nowMs: 14_000,
      snapshot: {
        schedulerProfile: 'normal',
        dynamicSrcStressScore: 0,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: {
        ...first.state,
        lastSwitchAtMs: 1000,
      },
    });

    expect(second.changed).toBe(false);
    expect(second.nextProfile).toBe('robust-shield');
    expect(second.reason).toBe('observe-window-hold');
  });

  it('promotes ll-guarded to extreme-ll only after stable window', () => {
    const base = createAudioTuningControllerState('ll-guarded');

    const first = resolveAudioTuningTransition({
      nowMs: 10_000,
      snapshot: {
        schedulerProfile: 'normal',
        dynamicSrcStressScore: 0,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: {
        ...base,
        lastSwitchAtMs: 0,
      },
    });

    expect(first.changed).toBe(false);
    expect(first.nextProfile).toBe('ll-guarded');

    const second = resolveAudioTuningTransition({
      nowMs: 42_000,
      snapshot: {
        schedulerProfile: 'normal',
        dynamicSrcStressScore: 0,
        underrunEventsWindow: 0,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
      },
      state: first.state,
    });

    expect(second.changed).toBe(true);
    expect(second.nextProfile).toBe('extreme-ll');
    expect(second.reason).toBe('stable-window');
  });
});
