import { describe, it, expect } from 'vitest';
import { resolveMagnetConfigStorageKey } from '../config';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

describe('magnet config key', () => {
  it('uses legacy key for space1/empty', () => {
    expect(resolveMagnetConfigStorageKey(undefined)).toBe(STORAGE_KEYS.CONFIG);
    expect(resolveMagnetConfigStorageKey(null)).toBe(STORAGE_KEYS.CONFIG);
    expect(resolveMagnetConfigStorageKey('')).toBe(STORAGE_KEYS.CONFIG);
    expect(resolveMagnetConfigStorageKey('space1')).toBe(STORAGE_KEYS.CONFIG);
    expect(resolveMagnetConfigStorageKey(' space1 ')).toBe(STORAGE_KEYS.CONFIG);
  });

  it('namespaces non-primary spaces', () => {
    expect(resolveMagnetConfigStorageKey('space2')).toBe(`${STORAGE_KEYS.CONFIG}:space2`);
    expect(resolveMagnetConfigStorageKey(' space3 ')).toBe(`${STORAGE_KEYS.CONFIG}:space3`);
  });
});

