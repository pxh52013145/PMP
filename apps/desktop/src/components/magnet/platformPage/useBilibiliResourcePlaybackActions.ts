import { useCallback, useEffect, useRef, useState } from 'react';

import type { IAudioService, Track } from '../../../services/audio';
import {
  buildBilibiliPreparedResourceKey,
  extractBilibiliBvid,
  prepareBilibiliCachedPlayback,
  resolveBilibiliCoverAssetUrl,
  resolveBilibiliLyricLocator,
  resolveBilibiliWebUrl,
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

const PREPARED_TRACK_CACHE_LIMIT = 96;

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
  workspaceConnectorId: string | null;
  activeBilibiliInstanceId: string | null;
  audioService: IAudioService;
  normalizedPlaybackQualityHint: string;
  preferredQualityLabel: string;
  targetPlaylistId: string | null;
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
    workspaceConnectorId,
    activeBilibiliInstanceId,
    audioService,
    normalizedPlaybackQualityHint,
    preferredQualityLabel,
    targetPlaylistId,
    t,
    setResourceError,
    setPlaylistError,
    buildTrackFromPreparedPlayback,
  } = params;
  void workspaceConnectorId;

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
  }, [activeBilibiliInstanceId, normalizedPlaybackQualityHint]);

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
        const resolved = await resolveBilibiliLyricLocator(locator, activeBilibiliInstanceId);
        if (!resolved) {
          setLyricError(t('magnet.platform.bilibili.lyric.notFound'));
          setResolvedLyric(null);
          return;
        }
        setResolvedLyric(resolved satisfies BilibiliLyricLocatorResolved);
      } catch (error) {
        setLyricError(toErrorMessage(error, t('magnet.platform.bilibili.lyric.error')));
        setResolvedLyric(null);
      } finally {
        setLyricResolvingId(null);
      }
    },
    [activeBilibiliInstanceId, t]
  );

  const ensurePreparedTrack = useCallback(
    async (item: BilibiliFavoriteResourceItem): Promise<Track> => {
      const cacheKey = buildBilibiliPreparedResourceKey(item, normalizedPlaybackQualityHint);
      const cached = preparedTrackMapRef.current.get(cacheKey);
      if (cached) return cached;

      setPreparingResourceId(cacheKey);
      try {
        const bilibiliPrepared = await prepareBilibiliCachedPlayback(
          item.sourceLocator,
          normalizedPlaybackQualityHint,
          activeBilibiliInstanceId
        );
        if (!bilibiliPrepared) {
          throw new Error(t('magnet.platform.bilibili.player.error.prepareFailed'));
        }

        let resolvedCoverUrl = await resolveBilibiliCoverAssetUrl(
          item.coverUrl,
          activeBilibiliInstanceId
        );
        if (!resolvedCoverUrl) {
          const bvid =
            extractBilibiliBvid(item.bvid) ||
            extractBilibiliBvid(item.sourceLocator) ||
            extractBilibiliBvid(item.lyricLocator);
          if (bvid) {
            const matched = await searchBilibiliResourceByBvid(
              bvid,
              activeBilibiliInstanceId
            ).catch(() => null);
            const discoveredCoverUrl =
              typeof matched?.coverUrl === 'string' ? matched.coverUrl.trim() : '';
            if (discoveredCoverUrl) {
              resolvedCoverUrl =
                (await resolveBilibiliCoverAssetUrl(
                  discoveredCoverUrl,
                  activeBilibiliInstanceId
                )) || discoveredCoverUrl;
            }
          }
        }

        setResourceInfo(
          t('magnet.platform.bilibili.player.qualityResolved', {
            preferred: preferredQualityLabel,
            actual:
              bilibiliPrepared.selectedQualityLabel || bilibiliPrepared.selectedQualityKey,
          })
        );
        setResourceError(null);

        const track = buildTrackFromPreparedPlayback(
          item,
          bilibiliPrepared,
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
      activeBilibiliInstanceId,
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
      if (!targetPlaylistId) {
        setPlaylistError(t('magnet.platform.bilibili.playlist.addHintNoSelection'));
        return;
      }

      try {
        const track = await ensurePreparedTrack(item);
        audioService.addTrackToPlaylist(targetPlaylistId, track);
        setPlaylistError(null);
      } catch (error) {
        setPlaylistError(toErrorMessage(error, t('magnet.platform.bilibili.playlist.error.addTrackFailed')));
      }
    },
    [audioService, ensurePreparedTrack, setPlaylistError, t, targetPlaylistId]
  );

  const handleOpenBilibiliResource = useCallback(
    (item: BilibiliFavoriteResourceItem) => {
      const url = resolveBilibiliWebUrl(item);
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
