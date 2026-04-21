import { useCallback, useEffect, useRef, useState } from 'react';

import type { IAudioService, Track } from '../../../services/audio';
import {
  prepareMusicTemplatePlayback,
  type MusicTemplatePlaybackQualityState,
  type MusicTemplatePreparedPlayback,
  type MusicTemplateResourceItem,
  type MusicTemplateRuntimeTarget,
} from './musicTemplateRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const PREPARED_TRACK_CACHE_LIMIT = 96;

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

function buildTrackFromPreparedPlayback(
  item: MusicTemplateResourceItem,
  prepared: MusicTemplatePreparedPlayback,
  platformLabel: string
): Track {
  return {
    id: `${item.resourceId}:${item.sourceLocator}`,
    title: item.title,
    artist: item.artistNames || platformLabel,
    album: item.albumName,
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: prepared.cachePath,
    path: prepared.cachePath,
    originalPath: item.sourceLocator,
    coverUrl: item.coverUrl,
    genre: platformLabel,
    comment: item.sourceLocator,
    mimeType: prepared.mimeType,
  };
}

export interface UseMusicTemplatePlaybackActionsParams {
  musicRuntimeTarget: MusicTemplateRuntimeTarget | null;
  playbackQualityState: MusicTemplatePlaybackQualityState | null;
  audioService: IAudioService;
  selectedPlaylistId: string | null;
  t: Translator;
  setResourceError: (value: string | null) => void;
  setResourceInfo: (value: string | null) => void;
  setPlaylistError: (value: string | null) => void;
}

export interface MusicTemplatePlaybackActionController {
  preparingResourceId: string | null;
  handlePlaySong: (item: MusicTemplateResourceItem) => Promise<void>;
  handleQueueSong: (item: MusicTemplateResourceItem) => Promise<void>;
  handleAddSongToPlaylist: (item: MusicTemplateResourceItem) => Promise<void>;
  handleOpenSong: (item: MusicTemplateResourceItem) => void;
}

export function useMusicTemplatePlaybackActions(
  params: UseMusicTemplatePlaybackActionsParams
): MusicTemplatePlaybackActionController {
  const {
    musicRuntimeTarget,
    playbackQualityState,
    audioService,
    selectedPlaylistId,
    t,
    setResourceError,
    setResourceInfo,
    setPlaylistError,
  } = params;

  const [preparingResourceId, setPreparingResourceId] = useState<string | null>(null);
  const preparedTrackMapRef = useRef<Map<string, Track>>(new Map());

  useEffect(() => {
    preparedTrackMapRef.current.clear();
  }, [musicRuntimeTarget?.connectorId, musicRuntimeTarget?.instanceId, playbackQualityState?.currentKey]);

  const ensurePreparedTrack = useCallback(
    async (item: MusicTemplateResourceItem): Promise<Track> => {
      const cacheKey = item.resourceId.trim() || item.sourceLocator.trim();
      const cached = preparedTrackMapRef.current.get(cacheKey);
      if (cached) return cached;

      setPreparingResourceId(item.resourceId);
      try {
        if (!musicRuntimeTarget) {
          throw new Error(t('magnet.platform.music-template.player.error.prepareFailed'));
        }

        const prepared = await prepareMusicTemplatePlayback(musicRuntimeTarget, item, {
          qualityHint: playbackQualityState?.currentKey,
        });
        if (!prepared) {
          throw new Error(t('magnet.platform.music-template.player.error.prepareFailed'));
        }

        const track = buildTrackFromPreparedPlayback(item, prepared, musicRuntimeTarget.displayName);
        setPreparedTrackWithBoundedLru(preparedTrackMapRef.current, cacheKey, track);
        return track;
      } finally {
        setPreparingResourceId((prev) => (prev === item.resourceId ? null : prev));
      }
    },
    [musicRuntimeTarget, playbackQualityState?.currentKey, t]
  );

  const handlePlaySong = useCallback(
    async (item: MusicTemplateResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        const queueLengthBefore = audioService.getQueue().length;
        audioService.addMultipleToQueue([track]);
        await audioService.playTrackAtIndex(Math.max(0, queueLengthBefore));
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(
          toErrorMessage(error, t('magnet.platform.music-template.player.error.playFailed'))
        );
      }
    },
    [audioService, ensurePreparedTrack, setResourceError, setResourceInfo, t]
  );

  const handleQueueSong = useCallback(
    async (item: MusicTemplateResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        audioService.addToQueue(track);
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(
          toErrorMessage(error, t('magnet.platform.music-template.player.error.queueFailed'))
        );
      }
    },
    [audioService, ensurePreparedTrack, setResourceError, setResourceInfo, t]
  );

  const handleAddSongToPlaylist = useCallback(
    async (item: MusicTemplateResourceItem) => {
      if (!selectedPlaylistId) {
        setPlaylistError(t('magnet.platform.music-template.playlist.addHintNoSelection'));
        return;
      }

      try {
        const track = await ensurePreparedTrack(item);
        audioService.addTrackToPlaylist(selectedPlaylistId, track);
        setPlaylistError(null);
      } catch (error) {
        setPlaylistError(
          toErrorMessage(error, t('magnet.platform.music-template.playlist.errorAddTrackFailed'))
        );
      }
    },
    [audioService, ensurePreparedTrack, selectedPlaylistId, setPlaylistError, t]
  );

  const handleOpenSong = useCallback(
    (item: MusicTemplateResourceItem) => {
      const webUrl = item.webUrl?.trim();
      if (!webUrl) {
        setResourceError(t('magnet.platform.music-template.resource.noLink'));
        return;
      }
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    },
    [setResourceError, t]
  );

  return {
    preparingResourceId,
    handlePlaySong,
    handleQueueSong,
    handleAddSongToPlaylist,
    handleOpenSong,
  };
}
