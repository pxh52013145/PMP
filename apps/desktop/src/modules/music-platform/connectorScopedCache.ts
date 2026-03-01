type ConnectorScopedCacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

export type ConnectorScopedLruTtlCacheOptions = {
  maxEntriesPerConnector: number;
  defaultTtlMs: number;
};

function normalizeConnectorId(connectorId: string): string {
  return connectorId.trim().toLowerCase();
}

function normalizeCacheKey(cacheKey: string): string {
  return cacheKey.trim();
}

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

export class ConnectorScopedLruTtlCache<T> {
  private readonly maxEntriesPerConnector: number;
  private readonly defaultTtlMs: number;
  private readonly buckets = new Map<string, Map<string, ConnectorScopedCacheEntry<T>>>();

  constructor(options: ConnectorScopedLruTtlCacheOptions) {
    this.maxEntriesPerConnector = normalizePositiveInt(options.maxEntriesPerConnector, 128);
    this.defaultTtlMs = normalizePositiveInt(options.defaultTtlMs, 60_000);
  }

  clearAll(): void {
    this.buckets.clear();
  }

  clearConnector(connectorId: string): void {
    const normalizedConnectorId = normalizeConnectorId(connectorId);
    if (!normalizedConnectorId) return;
    this.buckets.delete(normalizedConnectorId);
  }

  get(connectorId: string, cacheKey: string): T | undefined {
    const bucket = this.getValidBucket(connectorId);
    if (!bucket) return undefined;

    const normalizedKey = normalizeCacheKey(cacheKey);
    if (!normalizedKey) return undefined;

    const nowMs = Date.now();
    const entry = bucket.get(normalizedKey);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= nowMs) {
      bucket.delete(normalizedKey);
      if (bucket.size === 0) {
        this.clearConnector(connectorId);
      }
      return undefined;
    }

    bucket.delete(normalizedKey);
    bucket.set(normalizedKey, entry);
    return entry.value;
  }

  set(connectorId: string, cacheKey: string, value: T, ttlMs?: number): void {
    const normalizedConnectorId = normalizeConnectorId(connectorId);
    const normalizedKey = normalizeCacheKey(cacheKey);
    if (!normalizedConnectorId || !normalizedKey) return;

    const bucket = this.getOrCreateBucket(normalizedConnectorId);
    const expiresAtMs =
      Date.now() + normalizePositiveInt(typeof ttlMs === 'number' ? ttlMs : this.defaultTtlMs, this.defaultTtlMs);

    if (bucket.has(normalizedKey)) {
      bucket.delete(normalizedKey);
    }

    bucket.set(normalizedKey, {
      value,
      expiresAtMs,
    });

    while (bucket.size > this.maxEntriesPerConnector) {
      const oldestKey = bucket.keys().next().value as string | undefined;
      if (!oldestKey) break;
      bucket.delete(oldestKey);
    }
  }

  private getValidBucket(connectorId: string): Map<string, ConnectorScopedCacheEntry<T>> | null {
    const normalizedConnectorId = normalizeConnectorId(connectorId);
    if (!normalizedConnectorId) return null;

    const bucket = this.buckets.get(normalizedConnectorId);
    if (!bucket) return null;

    const nowMs = Date.now();
    for (const [cacheKey, entry] of bucket.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        bucket.delete(cacheKey);
      }
    }

    if (bucket.size === 0) {
      this.buckets.delete(normalizedConnectorId);
      return null;
    }

    return bucket;
  }

  private getOrCreateBucket(connectorId: string): Map<string, ConnectorScopedCacheEntry<T>> {
    const existing = this.buckets.get(connectorId);
    if (existing) return existing;

    const created = new Map<string, ConnectorScopedCacheEntry<T>>();
    this.buckets.set(connectorId, created);
    return created;
  }
}

