import { describe, expect, it } from 'vitest';

import { compareSemver, formatSemver, parseSemver, satisfiesSemverRange } from '../semver';

describe('themes/packs semver', () => {
  it('parses basic semver', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.2.3-alpha')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.2.3+build.1')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('rejects invalid semver', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });

  it('compares versions', () => {
    expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 0 })).toBe(0);
    expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 1 })).toBe(-1);
    expect(compareSemver({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBe(1);
  });

  it('formats versions', () => {
    expect(formatSemver({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('satisfies exact and comparator ranges', () => {
    expect(satisfiesSemverRange('1.2.3', '1.2.3')).toBe('satisfies');
    expect(satisfiesSemverRange('1.2.3', '=1.2.3')).toBe('satisfies');
    expect(satisfiesSemverRange('1.2.3', '>=1.2.0 <2.0.0')).toBe('satisfies');
    expect(satisfiesSemverRange('1.2.3', '>=1.2.4')).toBe('violates');
  });

  it('supports caret ranges', () => {
    expect(satisfiesSemverRange('1.5.0', '^1.2.3')).toBe('satisfies');
    expect(satisfiesSemverRange('2.0.0', '^1.2.3')).toBe('violates');

    expect(satisfiesSemverRange('0.5.9', '^0.5.0')).toBe('satisfies');
    expect(satisfiesSemverRange('0.6.0', '^0.5.0')).toBe('violates');

    expect(satisfiesSemverRange('0.0.5', '^0.0.5')).toBe('satisfies');
    expect(satisfiesSemverRange('0.0.6', '^0.0.5')).toBe('violates');
    expect(satisfiesSemverRange('0.1.0', '^0.0.5')).toBe('violates');
  });

  it('supports tilde ranges', () => {
    expect(satisfiesSemverRange('1.2.3', '~1.2.3')).toBe('satisfies');
    expect(satisfiesSemverRange('1.2.9', '~1.2.3')).toBe('satisfies');
    expect(satisfiesSemverRange('1.3.0', '~1.2.3')).toBe('violates');
  });

  it('returns unknown for unsupported/invalid ranges', () => {
    expect(satisfiesSemverRange('1.2.3', '')).toBe('unknown');
    expect(satisfiesSemverRange('nope', '^1.2.3')).toBe('unknown');
    expect(satisfiesSemverRange('1.2.3', '>=1.0.0 || <2.0.0')).toBe('unknown');
    expect(satisfiesSemverRange('1.2.3', '>=oops')).toBe('unknown');
  });
});

