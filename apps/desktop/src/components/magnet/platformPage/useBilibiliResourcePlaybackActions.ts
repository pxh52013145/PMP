import { useCallback, useEffect, useRef, useState } from 'react';

import type { IAudioService, Track } from '../../../services/audio';
import {
  prepareBilibiliCachedPlayback,
  resolveBilibiliCoverAssetUrl,
  resolveBilibiliLyricLocator,
  searchBilibiliResourceByBvid,
  type BilibiliFavoriteResourceItem,
  type BilibiliLyricLocatorResolved,
  type BilibiliPreparedPlayback,
} from '../../../modules/music-platform';

type Translator = (key: string, params?: Record<string, string | number>) => string;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || fallback;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || fallback;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

function toBilibiliWebUrl(item: BilibiliFavoriteResourceItem): string | null {
  const bvid = item.bvid?.trim();
  if (bvid) return `https://www.bilibili.com/video/${bvid}`;
  const locator = item.sourceLocator.trim();
  if (locator.startsWith('https://') || locator.startsWith('http://')) return locator;
  return null;
}

const BILIBILI_BVID_PATTERN = /BV[0-9A-Za-z]{10}/i;
const PREPARED_TRACK_CACHE_LIMIT = 96;

function extractBvidFromText(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const matched = normalized.match(BILIBILI_BVID_PATTERN);
  if (!matched || !matched[0]) return null;
  return matched[0].toUpperCase();
}

function buildStableBilibiliResourceIdentity(item: BilibiliFavoriteResourceItem): string {
  const resourceId = typeof item.resourceId === 'string' ? item.resourceId.trim() : '';
  if (resourceId) {
    return `rid:${resourceId}`;
  }

  const bvid = typeof item.bvid === 'string' ? item.bvid.trim().toUpperCase() : '';
  const cid = typeof item.cid === 'string' ? item.cid.trim() : '';
  if (bvid && cid) {
    return `bvid:${bvid}::cid:${cid}`;
  }
  if (bvid) {
    return `bvid:${bvid}`;
  }

  const sourceLocator = typeof item.sourceLocator === 'string' ? item.sourceLocator.trim() : '';
  if (sourceLocator) {
    return `locator:${sourceLocator}`;
  }

  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const ownerName = typeof item.ownerName === 'string' ? item.ownerName.trim() : '';
  const duration =
    typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
      ? String(Math.max(0, Math.floor(item.durationSeconds)))
      : '0';
  return `meta:${title || 'unknown'}::${ownerName}::${duration}`;
}

function setPreparedTrackWithBoundedLru(cache: Map<string, Track>, cacheKey: string, track: Track): void {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  cache.set(cacheKey, track);
  while (cache.size > PREPARED_TRACK_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

type UseBilibiliResourcePlaybackActionsParams = {
  audioService: IAudioService;
  normalizedPlaybackQualityHint: string;
  preferredQualityLabel: string;
  selectedPlaylistId: string | null;
  t: Translator;
  setResourceError: (value: string | null) => void;
  setPlaylistError: (value: string | null) => void;
  buildTrackFromPreparedPlayback: (
    item: BilibiliFavoriteResourceItem,
    prepared: BilibiliPreparedPlayback,
    coverUrl: string | undefined
  ) => Track;
};

export function useBilibiliResourcePlaybackActions(params: UseBilibiliResourcePlaybackActionsParams) {
  const {
    audioService,
    normalizedPlaybackQualityHint,
    preferredQualityLabel,
    selectedPlaylistId,
    t,
    setResourceError,
    setPlaylistError,
    buildTrackFromPreparedPlayback,
  } = params;

  const [resourceInfo, setResourceInfo] = useState<string | null>(null);
  const [preparingResourceId, setPreparingResourceId] = useState<string | null>(null);
  const [lyricResolvingId, setLyricResolvingId] = useState<string | null>(null);
  const [resolvedLyric, setResolvedLyric] = useState<BilibiliLyricLocatorResolved | null>(null);
  const [lyricError, setLyricError] = useState<string | null>(null);

  const preparedTrackMapRef = useRef<Map<string, Track>>(new Map());

  useEffect(() => {
    const preparedTrackCache = preparedTrackMapRef.current;
    preparedTrackCache.clear();
    return () => {
      preparedTrackCache.clear();
    };
  }, [normalizedPlaybackQualityHint]);

  const handleResolveLyric = useCallback(
    async (item: BilibiliFavoriteResourceItem) => {
      const locator = item.lyricLocator?.trim();
      if (!locator) {
        setLyricError(t('magnet.platform.bilibili.lyric.noLocator'));
        setResolvedLyric(null);
        return;
      }

      setLyricResolvingId(item.resourceId);
      setLyricError(null);
      try {
        const resolved = await resolveBilibiliLyricLocator(locator);
        if (!resolved) {
          setLyricError(t('magnet.platform.bilibili.lyric.notFound'));
          setResolvedLyric(null);
          return;
        }
        setResolvedLyric(resolved);
      } catch (error) {
        setLyricError(toErrorMessage(error, t('magnet.platform.bilibili.lyric.error')));
        setResolvedLyric(null);
      } finally {
        setLyricResolvingId(null);
      }
    },
    [t]
  );

  const ensurePreparedTrack = useCallback(
    async (item: BilibiliFavoriteResourceItem): Promise<Track> => {
      const stableIdentity = buildStableBilibiliResourceIdentity(item);
      const cacheKey = `${stableIdentity}::${normalizedPlaybackQualityHint}`;
      const cached = preparedTrackMapRef.current.get(cacheKey);
      if (cached) return cached;

      setPreparingResourceId(cacheKey);
      try {
        const prepared = await prepareBilibiliCachedPlayback(item.sourceLocator, normalizedPlaybackQualityHint);
        if (!prepared) {
          throw new Error(t('magnet.platform.bilibili.player.error.prepareFailed'));
        }

        let resolvedCoverUrl = await resolveBilibiliCoverAssetUrl(item.coverUrl);
        if (!resolvedCoverUrl) {
          const bvid =
            extractBvidFromText(item.bvid) ||
            extractBvidFromText(item.sourceLocator) ||
            extractBvidFromText(item.lyricLocator);
          if (bvid) {
            const matched = await searchBilibiliResourceByBvid(bvid).catch(() => null);
            const discoveredCoverUrl =
              typeof matched?.coverUrl === 'string' ? matched.coverUrl.trim() : '';
            if (discoveredCoverUrl) {
              resolvedCoverUrl =
                (await resolveBilibiliCoverAssetUrl(discoveredCoverUrl)) || discoveredCoverUrl;
            }
          }
        }

        setResourceInfo(
          t('magnet.platform.bilibili.player.qualityResolved', {
            preferred: preferredQualityLabel,
            actual: prepared.selectedQualityLabel,
          })
        );
        setResourceError(null);

        const track = buildTrackFromPreparedPlayback(
          item,
          prepared,
          resolvedCoverUrl ?? item.coverUrl
        );
        setPreparedTrackWithBoundedLru(preparedTrackMapRef.current, cacheKey, track);
        return track;
      } finally {
        setPreparingResourceId((prev) => (prev === cacheKey ? null : prev));
      }
    },
    [
      buildTrackFromPreparedPlayback,
      normalizedPlaybackQualityHint,
      preferredQualityLabel,
      setResourceError,
      t,
    ]
  );

  const handlePlayResource = useCallback(
    async (item: BilibiliFavoriteResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        const queueLengthBefore = audioService.getQueue().length;
        audioService.addMultipleToQueue([track]);
        const targetIndex = Math.max(0, queueLengthBefore);
        await audioService.playTrackAtIndex(targetIndex);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.bilibili.player.error.playFailed')));
      }
    },
    [audioService, ensurePreparedTrack, setResourceError, t]
  );

  const handleQueueResource = useCallback(
    async (item: BilibiliFavoriteResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        audioService.addToQueue(track);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.bilibili.player.error.queueFailed')));
      }
    },
    [audioService, ensurePreparedTrack, setResourceError, t]
  );

  const handleAddToPlaylist = useCallback(
    async (item: BilibiliFavoriteResourceItem) => {
      if (!selectedPlaylistId) {
        setPlaylistError(t('magnet.platform.bilibili.playlist.addHintNoSelection'));
        return;
      }

      try {
        const track = await ensurePreparedTrack(item);
        audioService.addTrackToPlaylist(selectedPlaylistId, track);
        setPlaylistError(null);
      } catch (error) {
        setPlaylistError(toErrorMessage(error, t('magnet.platform.bilibili.playlist.error.addTrackFailed')));
      }
    },
    [audioService, ensurePreparedTrack, selectedPlaylistId, setPlaylistError, t]
  );

  const handleOpenBilibiliResource = useCallback(
    (item: BilibiliFavoriteResourceItem) => {
      const url = toBilibiliWebUrl(item);
      if (!url) {
        setResourceError(t('magnet.platform.bilibili.resource.noLink'));
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [setResourceError, t]
  );

  return {
    resourceInfo,
    preparingResourceId,
    lyricResolvingId,
    resolvedLyric,
    lyricError,
    handleResolveLyric,
    handlePlayResource,
    handleQueueResource,
    handleAddToPlaylist,
    handleOpenBilibiliResource,
  };
}

