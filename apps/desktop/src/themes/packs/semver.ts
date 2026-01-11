export type Semver = { major: number; minor: number; patch: number };

type ComparatorOp = '<' | '<=' | '>' | '>=' | '=';

type Comparator = { op: ComparatorOp; version: Semver };

function parseIntStrict(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSemver(value: string): Semver | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  const major = parseIntStrict(match[1]);
  const minor = parseIntStrict(match[2]);
  const patch = parseIntStrict(match[3]);
  if (major === null || minor === null || patch === null) return null;
  return { major, minor, patch };
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

function bumpMajor(v: Semver): Semver {
  return { major: v.major + 1, minor: 0, patch: 0 };
}

function bumpMinor(v: Semver): Semver {
  return { major: v.major, minor: v.minor + 1, patch: 0 };
}

function bumpPatch(v: Semver): Semver {
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

function parseComparatorToken(token: string): Comparator[] | null {
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (trimmed.includes('||')) return null;

  if (trimmed.startsWith('^')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return null;
    const upper =
      base.major > 0
        ? bumpMajor(base)
        : base.minor > 0
          ? { major: 0, minor: base.minor + 1, patch: 0 }
          : bumpPatch(base);
    return [
      { op: '>=', version: base },
      { op: '<', version: upper },
    ];
  }

  if (trimmed.startsWith('~')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return null;
    return [
      { op: '>=', version: base },
      { op: '<', version: bumpMinor(base) },
    ];
  }

  for (const op of ['>=', '<=', '>', '<', '='] as const) {
    if (!trimmed.startsWith(op)) continue;
    const version = parseSemver(trimmed.slice(op.length));
    if (!version) return null;
    return [{ op, version }];
  }

  const exact = parseSemver(trimmed);
  if (!exact) return null;
  return [{ op: '=', version: exact }];
}

function satisfiesComparator(version: Semver, comparator: Comparator): boolean {
  const cmp = compareSemver(version, comparator.version);
  switch (comparator.op) {
    case '=':
      return cmp === 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return false;
  }
}

export type SemverSatisfaction = 'satisfies' | 'violates' | 'unknown';

export function satisfiesSemverRange(version: string, range?: string | null): SemverSatisfaction {
  if (!range || range.trim().length === 0) return 'unknown';
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return 'unknown';

  const tokens = range
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return 'unknown';

  const comparators: Comparator[] = [];
  for (const token of tokens) {
    const parsed = parseComparatorToken(token);
    if (!parsed) return 'unknown';
    comparators.push(...parsed);
  }

  return comparators.every((comp) => satisfiesComparator(parsedVersion, comp)) ? 'satisfies' : 'violates';
}

export function formatSemver(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

