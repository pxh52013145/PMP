import React, { useEffect, useState } from 'react';
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

export const AlbumDetailPage: React.FC<AlbumDetailPageProps> = ({
  albumName,
  artist,
}) => {
  const t = useT();
  const audioService = useAudioService();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albumCover, setAlbumCover] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!albumName) {
      setTracks([]);
      setAlbumCover(undefined);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextTracks = await musicLibraryService.getTracksByAlbum(albumName);
      if (cancelled) return;

      setTracks(nextTracks);

      // 使用第一首歌的封面作为专辑封面（Desktop/Tauri 下优先走磁盘缓存懒加载）
      const candidate = nextTracks[0];
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
  }, [albumName]);

  useEffect(() => {
    if (initialTracks && initialTracks.length > 0) return;
    if (!albumName) return;

    let cancelled = false;

    void musicLibraryService
      .getTracksByAlbum(albumName)
      .then((result) => {
        if (cancelled) return;
        const filtered =
          artist && artist.trim()
            ? result.filter((track) => String(track.artist || '').trim() === artist.trim())
            : result;
        setTracks(filtered);

        const candidate = filtered[0];
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
          if (cancelled) return;
          if (coverUrl) setAlbumCover(coverUrl);
        });
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [albumName, artist, initialTracks]);

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
          <div className="album-tracks-list">
            {tracks.map((track, index) => (
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
