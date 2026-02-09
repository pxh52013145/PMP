import { describe, expect, it } from 'vitest';
import { hasEnabledPmpmPluginCandidates } from '../KernelContext';

describe('KernelContext plugin activation guard', () => {
  it('returns false for empty payloads', () => {
    expect(hasEnabledPmpmPluginCandidates(null)).toBe(false);
    expect(hasEnabledPmpmPluginCandidates(undefined)).toBe(false);
    expect(hasEnabledPmpmPluginCandidates('')).toBe(false);
    expect(hasEnabledPmpmPluginCandidates('[]')).toBe(false);
    expect(hasEnabledPmpmPluginCandidates('invalid-json')).toBe(false);
  });

  it('returns false when every plugin entry is disabled', () => {
    expect(hasEnabledPmpmPluginCandidates(JSON.stringify([{ id: 'a', enabled: false }]))).toBe(false);
    expect(
      hasEnabledPmpmPluginCandidates(
        JSON.stringify([
          { id: 'a', enabled: false },
          { id: 'b', enabled: false },
        ])
      )
    ).toBe(false);
  });

  it('returns true when at least one plugin is enabled', () => {
    expect(hasEnabledPmpmPluginCandidates(JSON.stringify([{ id: 'a' }]))).toBe(true);
    expect(
      hasEnabledPmpmPluginCandidates(
        JSON.stringify([
          { id: 'a', enabled: false },
          { id: 'b', enabled: true },
        ])
      )
    ).toBe(true);
  });
});

