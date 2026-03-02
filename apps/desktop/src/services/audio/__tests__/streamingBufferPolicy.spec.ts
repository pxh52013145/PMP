import { describe, expect, it } from 'vitest';

import {
  isSameStreamingBufferSettings,
  normalizeStreamingBufferSettings,
  resolveStreamingBufferPolicyTarget,
} from '../streamingBufferPolicy';

describe('streamingBufferPolicy', () => {
  it('normalizes and clamps raw settings', () => {
    const normalized = normalizeStreamingBufferSettings({
      startOrSeekSeconds: 9,
      crossfadeSeconds: -2,
      decodeMode: 'streaming',
      interactiveProfile: 'balanced',
    });

    expect(normalized).toEqual({
      startOrSeekSeconds: 4,
      crossfadeSeconds: 0,
      decodeMode: 'streaming',
      interactiveProfile: 'balanced',
    });
  });

  it('applies layered policy upgrades for hidden/recovery/protection/shared stress', () => {
    const target = resolveStreamingBufferPolicyTarget({
      storedSettings: {
        startOrSeekSeconds: 1.2,
        crossfadeSeconds: 0.5,
        decodeMode: 'streaming',
        interactiveProfile: 'balanced',
      },
      documentHidden: true,
      underrunRecoveryActive: true,
      protectionWindowActive: true,
      sharedStressWindowActive: true,
    });

    expect(target).toEqual({
      startOrSeekSeconds: 3.8,
      crossfadeSeconds: 1.9,
      decodeMode: 'streaming',
      interactiveProfile: 'balanced',
    });
  });

  it('returns normalized base policy when no stress flags are active', () => {
    const target = resolveStreamingBufferPolicyTarget({
      storedSettings: {
        startOrSeekSeconds: null,
        crossfadeSeconds: null,
        decodeMode: 'full-track',
        interactiveProfile: 'stable',
      },
      documentHidden: false,
      underrunRecoveryActive: false,
      protectionWindowActive: false,
      sharedStressWindowActive: false,
    });

    expect(target).toEqual({
      startOrSeekSeconds: null,
      crossfadeSeconds: null,
      decodeMode: 'full-track',
      interactiveProfile: 'stable',
    });
  });

  it('compares policy equality structurally', () => {
    const left = {
      startOrSeekSeconds: 3.2,
      crossfadeSeconds: 1.4,
      decodeMode: 'streaming' as const,
      interactiveProfile: 'fast' as const,
    };
    const right = { ...left };
    const changed = { ...left, crossfadeSeconds: 1.5 };

    expect(isSameStreamingBufferSettings(left, right)).toBe(true);
    expect(isSameStreamingBufferSettings(left, changed)).toBe(false);
    expect(isSameStreamingBufferSettings(null, right)).toBe(false);
  });
});
