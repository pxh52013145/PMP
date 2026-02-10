import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { useT } from '../../i18n';
import './AlbumDetailPage.css';

interface AlbumDetailPageProps {
  albumName?: string;
  artist?: string;
}

const ALBUM_TRACK_RENDER_CHUNK_SIZE = 120;
const ALBUM_SCROLL_RENDER_TRIGGER_PX = 240;
const ALBUM_TRACK_TEXT_INTERN_POOL_MAX = 2048;

const albumTrackTextInternPool = new Map<string, string>();

function trimAlbumTrackText(value: unknown, maxChars: number = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function internAlbumTrackText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const existing = albumTrackTextInternPool.get(value);
  if (existing) return existing;
  albumTrackTextInternPool.set(value, value);
  if (albumTrackTextInternPool.size > ALBUM_TRACK_TEXT_INTERN_POOL_MAX) {
    const oldestKey = albumTrackTextInternPool.keys().next().value as string | undefined;
    if (oldestKey) albumTrackTextInternPool.delete(oldestKey);
  }
  return value;
}

function compactAlbumTrack(track: Track): Track {
  const safePath =
    typeof track.filePath === 'string' && track.filePath ? track.filePath : track.path;
  const normalizedCoverUrl = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
  const normalizedCoverLower = normalizedCoverUrl.toLowerCase();
  const safeCoverUrl =
    normalizedCoverLower.startsWith('blob:') ||
    normalizedCoverLower.startsWith('http://') ||
    normalizedCoverLower.startsWith('https://')
      ? normalizedCoverUrl
      : undefined;
  const safeTitle = internAlbumTrackText(trimAlbumTrackText(track.title) || track.id) || track.id;
  const safeArtist = internAlbumTrackText(trimAlbumTrackText(track.artist));
  const safeAlbum = internAlbumTrackText(trimAlbumTrackText(track.album));
  const safeCoverKey = internAlbumTrackText(trimAlbumTrackText(track.coverKey, 256));
  const safeOriginalPath = internAlbumTrackText(trimAlbumTrackText(track.originalPath, 512));

  return {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    album: safeAlbum,
    duration: track.duration,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    filePath: typeof safePath === 'string' && safePath ? safePath : track.filePath,
    path: safePath,
    originalPath: safeOriginalPath,
    fileHandle: safePath ? undefined : track.fileHandle,
    coverKey: safeCoverKey,
    coverUrl: safeCoverUrl,
    replayGainTrackGainDb: track.replayGainTrackGainDb,
    replayGainAlbumGainDb: track.replayGainAlbumGainDb,
  };
}

function compactAlbumTracks(tracks: Track[]): Track[] {
  if (tracks.length === 0) return tracks;
  return tracks.map(compactAlbumTrack);
}

export const AlbumDetailPage: React.FC<AlbumDetailPageProps> = ({
  albumName,
  artist,
}) => {
  const t = useT();
  const audioService = useAudioService();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albumCover, setAlbumCover] = useState<string | undefined>();
  const [renderedTrackLimit, setRenderedTrackLimit] = useState(ALBUM_TRACK_RENDER_CHUNK_SIZE);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const tracksListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!albumName) {
      setTracks([]);
      setRenderedTrackLimit(ALBUM_TRACK_RENDER_CHUNK_SIZE);
      setAlbumCover(undefined);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextTracks = await musicLibraryService.getTracksByAlbum(albumName);
      if (cancelled) return;

      const filteredTracks =
        artist && artist.trim()
          ? nextTracks.filter((track) => String(track.artist || '').trim() === artist.trim())
          : nextTracks;

      const compactTracks = compactAlbumTracks(filteredTracks);

      setTracks(compactTracks);
      setRenderedTrackLimit(ALBUM_TRACK_RENDER_CHUNK_SIZE);

      // 使用第一首歌的封面作为专辑封面（Desktop/Tauri 下优先走磁盘缓存懒加载）
      const candidate = compactTracks[0];
      if (!candidate) {
        setAlbumCover(undefined);
        return;
      }

      const url = typeof candidate.coverUrl === 'string' ? candidate.coverUrl : undefined;
      const lower = (url || '').toLowerCase();
      const isDisplayable =
        !!url &&
        (lower.startsWith('data:') ||
          lower.startsWith('blob:') ||
          lower.startsWith('http:') ||
          lower.startsWith('https:'));
      setAlbumCover(isDisplayable ? url : undefined);

      void musicLibraryService.getCoverUrlForTrack(candidate).then((coverUrl) => {
        if (!cancelled && coverUrl) setAlbumCover(coverUrl);
      });
    })().catch((error) => {
      if (!cancelled) {
        console.warn('[AlbumDetailPage] Failed to load album tracks:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [albumName, artist]);

  useEffect(() => {
    setRenderedTrackLimit((prev) => {
      if (!Number.isFinite(prev) || prev <= 0) {
        return Math.min(tracks.length, ALBUM_TRACK_RENDER_CHUNK_SIZE);
      }
      return Math.min(tracks.length, prev);
    });
  }, [tracks.length]);

  const renderedTracks = useMemo(() => {
    if (renderedTrackLimit >= tracks.length) return tracks;
    return tracks.slice(0, renderedTrackLimit);
  }, [renderedTrackLimit, tracks]);

  const handleTracksScroll = useCallback(() => {
    const root = tracksListRef.current;
    if (!root) return;

    const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
    if (remaining <= ALBUM_SCROLL_RENDER_TRIGGER_PX) {
      setRenderedTrackLimit((prev) => Math.min(tracks.length, prev + ALBUM_TRACK_RENDER_CHUNK_SIZE));
    }
  }, [tracks.length]);

  // 双击播放：添加整个专辑，从选中的歌曲开始播放
  const handlePlayTrack = async (track: Track, index: number) => {
    console.log('🎵 Playing track:', track.title, 'from album');
    audioService.clearQueue();
    audioService.addMultipleToQueue(tracks);
    await audioService.playTrackAtIndex(index);
    console.log('✅ Album added to queue, playing from track', index + 1);
  };

  // 播放全部：从第一首开始播放
  const handlePlayAll = async () => {
    if (tracks.length > 0) {
      console.log('🎵 Playing all tracks:', tracks.length);
      audioService.clearQueue();
      audioService.addMultipleToQueue(tracks);
      await audioService.playTrackAtIndex(0);
      console.log('✅ All tracks loaded and playing');
    }
  };

  // 添加整个专辑到队列
  const handleAddAllToQueue = () => {
    if (tracks.length > 0) {
      console.log('➕ Adding all tracks to queue:', tracks.length);
      audioService.addMultipleToQueue(tracks);
      console.log('✅ Tracks added to queue:', audioService.getQueue().length);
    }
  };

  // 只添加单首歌曲到队列（不播放）
  const handleAddTrackToQueue = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('➕ Adding single track to queue:', track.title);
    audioService.addToQueue(track);
    console.log('✅ Track added to queue');
  };

  // 点击播放按钮：只播放这一首歌
  const handlePlaySingleTrack = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('🎵 Playing single track:', track.title);
    audioService.clearQueue();
    audioService.addToQueue(track);
    await audioService.playTrackAtIndex(0);
    console.log('✅ Single track loaded and playing');
  };

  // 处理歌曲右键菜单
  const handleTrackContextMenu = (track: Track, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.album.context.playTrack'),
        icon: '▶',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: t('pages.album.context.addTrackToQueue'),
        icon: '+',
        onClick: () => handleAddTrackToQueue(track, e),
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.album.context.playAlbumFromHere'),
        icon: '🎵',
        onClick: () => handlePlayTrack(track, index),
      },
      {
        label: t('pages.album.context.playAlbum'),
        icon: '💿',
        onClick: () => handlePlayAll(),
      },
    ];

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
    });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDuration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);

  if (!albumName) {
    return (
      <div className="album-detail-page empty">
        <div className="empty-icon">◉</div>
        <div className="empty-text">{t('pages.album.empty.noSelection')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="album-detail-page">
        {/* 专辑头部 */}
        <div className="album-header">
          <div className="album-cover-large">
            {albumCover ? <img src={albumCover} alt={albumName} /> : '◉'}
          </div>
          <div className="album-info">
            <h1 className="album-title">{albumName}</h1>
            {artist && <h2 className="album-artist">{artist}</h2>}
            <div className="album-stats">
              <span>{t('pages.album.stats.trackCount', { count: tracks.length })}</span>
              <span>•</span>
              <span>{formatDuration(totalDuration)}</span>
            </div>
            <div className="album-actions">
              <button className="album-action-btn primary" onClick={handlePlayAll}>
                ▶ {t('pages.album.action.playAll')}
              </button>
              <button className="album-action-btn" onClick={handleAddAllToQueue}>
                + {t('common.action.addToQueue')}
              </button>
            </div>
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="album-tracks">
          <div className="album-tracks-header">
            <div className="track-number">#</div>
            <div className="track-title">{t('pages.album.table.title')}</div>
            <div className="track-duration">{t('pages.album.table.duration')}</div>
            <div className="track-actions">{t('pages.album.table.actions')}</div>
          </div>
          <div className="album-tracks-list" ref={tracksListRef} onScroll={handleTracksScroll}>
            {renderedTracks.map((track, index) => (
              <div
                key={track.id}
                className="album-track-item"
                onDoubleClick={() => handlePlayTrack(track, index)}
                onContextMenu={(e) => handleTrackContextMenu(track, index, e)}
                title={t('pages.album.trackItem.titleHint')}
              >
                <div className="track-number">{index + 1}</div>
                <div className="track-title">{track.title}</div>
                <div className="track-duration">{formatDuration(track.duration)}</div>
                <div className="track-actions">
                  <button
                    className="track-action-btn"
                    onClick={(e) => handlePlaySingleTrack(track, e)}
                    title={t('pages.album.trackItem.tooltip.playTrack')}
                  >
                    ▶
                  </button>
                  <button
                    className="track-action-btn"
                    onClick={(e) => handleAddTrackToQueue(track, e)}
                    title={t('pages.album.trackItem.tooltip.addTrackToQueue')}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
