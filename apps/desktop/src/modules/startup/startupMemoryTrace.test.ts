import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeKey, writeString } from '../storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  captureStartupMemoryCheckpoint,
  isStartupMemoryTraceEnabled,
  resetStartupMemoryTraceForTests,
  setStartupMemoryTraceFlag,
} from './startupMemoryTrace';

describe('startupMemoryTrace', () => {
  beforeEach(() => {
    removeKey(STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED);
    removeKey(STORAGE_KEYS.STARTUP_MEMORY_TRACE_V1);
    resetStartupMemoryTraceForTests();
  });

  afterEach(() => {
    removeKey(STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED);
    removeKey(STORAGE_KEYS.STARTUP_MEMORY_TRACE_V1);
    resetStartupMemoryTraceForTests();
  });

  it('does not capture checkpoints while disabled', async () => {
    expect(isStartupMemoryTraceEnabled()).toBe(false);

    const checkpoint = await captureStartupMemoryCheckpoint('frontend.main.before-render');

    expect(checkpoint).toBeNull();
    expect(globalThis.__pmpStartupMemoryTrace).toBeUndefined();
  });

  it('captures lightweight checkpoints when enabled', async () => {
    writeString(STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED, 'true');
    setStartupMemoryTraceFlag('pixelRendererCreated');

    const checkpoint = await captureStartupMemoryCheckpoint('pixel.renderer.created', {
      activeMagnetCount: 8,
      activeMagnetIdsCount: 9,
      fields: { renderScale: 0.35 },
    });

    expect(checkpoint).toMatchObject({
      label: 'pixel.renderer.created',
      activeMagnetCount: 8,
      activeMagnetIdsCount: 9,
      isTauri: false,
      backend: null,
      process: null,
      fields: { renderScale: 0.35 },
      flags: {
        pixelRendererCreated: true,
      },
    });
    expect(globalThis.__pmpStartupMemoryTrace?.checkpoints).toHaveLength(1);
  });
});
