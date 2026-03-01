import { describe, expect, it, vi } from 'vitest';

import { ConnectorScopedLruTtlCache } from '../connectorScopedCache';

describe('ConnectorScopedLruTtlCache', () => {
  it('keeps connector buckets isolated', () => {
    const cache = new ConnectorScopedLruTtlCache<string>({
      maxEntriesPerConnector: 4,
      defaultTtlMs: 60_000,
    });

    cache.set('connector.platform.a', 'key-1', 'A-1');
    cache.set('connector.platform.b', 'key-1', 'B-1');

    expect(cache.get('connector.platform.a', 'key-1')).toBe('A-1');
    expect(cache.get('connector.platform.b', 'key-1')).toBe('B-1');
  });

  it('expires entries by ttl', () => {
    vi.useFakeTimers();

    const cache = new ConnectorScopedLruTtlCache<string>({
      maxEntriesPerConnector: 4,
      defaultTtlMs: 1_000,
    });

    cache.set('connector.platform.a', 'key-1', 'A-1');
    expect(cache.get('connector.platform.a', 'key-1')).toBe('A-1');

    vi.advanceTimersByTime(1_100);
    expect(cache.get('connector.platform.a', 'key-1')).toBeUndefined();

    vi.useRealTimers();
  });

  it('evicts least-recently-used entries per connector', () => {
    const cache = new ConnectorScopedLruTtlCache<string>({
      maxEntriesPerConnector: 2,
      defaultTtlMs: 60_000,
    });

    cache.set('connector.platform.a', 'k1', 'v1');
    cache.set('connector.platform.a', 'k2', 'v2');
    expect(cache.get('connector.platform.a', 'k1')).toBe('v1');

    cache.set('connector.platform.a', 'k3', 'v3');

    expect(cache.get('connector.platform.a', 'k1')).toBe('v1');
    expect(cache.get('connector.platform.a', 'k2')).toBeUndefined();
    expect(cache.get('connector.platform.a', 'k3')).toBe('v3');
  });
});

