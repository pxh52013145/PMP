import { describe, expect, it, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import {
  isPmpmSigningKeyTrusted,
  readPmpmTrustedKeyIds,
  trustPmpmSigningKeyId,
  untrustPmpmSigningKeyId,
} from '../pmpmTrust';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('pmpmTrust', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1);
  });

  it('adds and removes trusted signing key ids', () => {
    expect(readPmpmTrustedKeyIds()).toEqual([]);
    expect(isPmpmSigningKeyTrusted(KEY_A)).toBe(false);

    trustPmpmSigningKeyId(KEY_A);
    expect(isPmpmSigningKeyTrusted(KEY_A)).toBe(true);
    expect(readPmpmTrustedKeyIds()).toEqual([KEY_A]);

    untrustPmpmSigningKeyId(KEY_A);
    expect(isPmpmSigningKeyTrusted(KEY_A)).toBe(false);
    expect(readPmpmTrustedKeyIds()).toEqual([]);
  });

  it('normalizes and deduplicates key ids', () => {
    trustPmpmSigningKeyId(KEY_B.toUpperCase());
    trustPmpmSigningKeyId(KEY_B);
    trustPmpmSigningKeyId(` ${KEY_A} `);

    expect(readPmpmTrustedKeyIds()).toEqual([KEY_A, KEY_B]);
  });
});

