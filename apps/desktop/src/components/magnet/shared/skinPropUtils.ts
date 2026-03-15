export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readBooleanProp(source: unknown, key: string, fallback: boolean): boolean {
  if (!isRecord(source)) return fallback;
  return typeof source[key] === 'boolean' ? source[key] : fallback;
}

export function readIntegerProp(
  source: unknown,
  key: string,
  fallback: number,
  options: {
    min?: number;
    max?: number;
  } = {}
): number {
  if (!isRecord(source)) return fallback;
  const candidate = source[key];
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return fallback;
  }

  const rounded = Math.round(candidate);
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(rounded, min), max);
}

export function readStringProp(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const candidate = source[key];
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readEnumProp<TValue extends string>(
  source: unknown,
  key: string,
  allowed: readonly TValue[],
  fallback: TValue
): TValue {
  const candidate = readStringProp(source, key);
  if (!candidate) return fallback;
  return allowed.includes(candidate as TValue) ? (candidate as TValue) : fallback;
}
