// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicLibraryService } from './MusicLibraryService';

type CoverRuntimeInternals = {
  coverUrlCache: Map<string, string>;
  coverBlobUrlCache: Map<string, { url: string; bytes: number; leaseKey?: string }>;
  coverBlobUrlTotalBytes: number;
  coverLeaseKeyByCacheKey: Map<string, string>;
  coverUrlRetainCounts: Map<string, number>;
  coverUrlHandoffProtectedUntil: Map<string, number>;
  pendingCoverUrlReleases: Set<string>;
  coverRuntimeBudgetTimer: number | null;
  coverUrlReleaseTimer: number | null;
  addCoverBlobUrlToCache(cacheKey: string, url: string, bytes: number, leaseKey: string): void;
};

function getInternals(service: MusicLibraryService): CoverRuntimeInternals {
  return service as unknown as CoverRuntimeInternals;
}

function resetCoverRuntime(service: MusicLibraryService): void {
  const internals = getInternals(service);
  if (internals.coverRuntimeBudgetTimer !== null) {
    window.clearTimeout(internals.coverRuntimeBudgetTimer);
  }
  if (internals.coverUrlReleaseTimer !== null) {
    window.clearTimeout(internals.coverUrlReleaseTimer);
  }
  internals.coverUrlCache.clear();
  internals.coverBlobUrlCache.clear();
  internals.coverBlobUrlTotalBytes = 0;
  internals.coverLeaseKeyByCacheKey.clear();
  internals.coverUrlRetainCounts.clear();
  internals.coverUrlHandoffProtectedUntil.clear();
  internals.pendingCoverUrlReleases.clear();
  internals.coverRuntimeBudgetTimer = null;
  internals.coverUrlReleaseTimer = null;
  service.applyCoverRuntimeCachePolicy('default');
}

describe('MusicLibraryService cover runtime lifetime', () => {
  let service: MusicLibraryService;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    service = MusicLibraryService.getInstance();
    resetCoverRuntime(service);
    revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  afterEach(() => {
    resetCoverRuntime(service);
    vi.useRealTimers();
  });

  it('keeps a new blob alive under the hidden zero-byte budget until a consumer retains it', () => {
    const internals = getInternals(service);
    const cacheKey = 'track-a|edge=96';
    const url = 'blob:cover-a';

    service.applyCoverRuntimeCachePolicy('hidden');
    internals.coverUrlCache.set(cacheKey, url);
    internals.addCoverBlobUrlToCache(cacheKey, url, 1024, 'cover-a-thumb-96px');

    expect(internals.coverUrlCache.get(cacheKey)).toBe(url);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    service.retainCoverUrls([url]);
    vi.advanceTimersByTime(1_000);

    expect(internals.coverUrlCache.get(cacheKey)).toBe(url);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    service.releaseCoverUrls([url]);
    vi.advanceTimersByTime(200);

    expect(internals.coverUrlCache.has(cacheKey)).toBe(false);
    expect(internals.coverLeaseKeyByCacheKey.has(cacheKey)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith(url);
  });

  it('does not revoke a shared blob until the last retained consumer releases it', () => {
    const internals = getInternals(service);
    const cacheKey = 'track-b|edge=96';
    const url = 'blob:cover-b';

    internals.coverUrlCache.set(cacheKey, url);
    internals.addCoverBlobUrlToCache(cacheKey, url, 1024, 'cover-b-thumb-96px');
    service.retainCoverUrls([url]);
    service.retainCoverUrls([url]);

    service.releaseCoverUrls([url]);
    vi.advanceTimersByTime(200);

    expect(internals.coverUrlCache.get(cacheKey)).toBe(url);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    service.releaseCoverUrls([url]);
    vi.advanceTimersByTime(200);

    expect(internals.coverUrlCache.has(cacheKey)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('discarding a cancelled handoff does not consume another active owner retention', () => {
    const internals = getInternals(service);
    const cacheKey = 'track-c|edge=96';
    const url = 'blob:cover-c';

    internals.coverUrlCache.set(cacheKey, url);
    internals.addCoverBlobUrlToCache(cacheKey, url, 1024, 'cover-c-thumb-96px');
    service.retainCoverUrls([url]);

    service.discardCoverUrls([url]);
    vi.advanceTimersByTime(1_000);

    expect(internals.coverUrlCache.get(cacheKey)).toBe(url);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    service.releaseCoverUrls([url]);
    vi.advanceTimersByTime(200);

    expect(internals.coverUrlCache.has(cacheKey)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });
});
