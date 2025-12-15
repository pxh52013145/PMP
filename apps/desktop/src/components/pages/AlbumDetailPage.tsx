import React, { useEffect, useState } from 'react';
import { Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import './AlbumDetailPage.css';

interface AlbumDetailPageProps {
  albumName?: string;
  artist?: string;
  tracks?: Track[];
}

export const AlbumDetailPage: React.FC<AlbumDetailPageProps> = ({
  albumName,
  artist,
  tracks: initialTracks,
}) => {
  const audioService = useAudioService();
  const [tracks, setTracks] = useState<Track[]>(initialTracks || []);
  const [albumCover, setAlbumCover] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  useEffect(() => {
    if (initialTracks && initialTracks.length > 0) {
      setTracks(initialTracks);
      // 使用第一首歌的封面作为专辑封面
      setAlbumCover(initialTracks[0].coverUrl);
    }
  }, [initialTracks]);

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
        label: '播放此歌曲',
        icon: '▶',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: '添加此歌曲到队列',
        icon: '+',
        onClick: () => handleAddTrackToQueue(track, e),
      },
      { divider: true } as ContextMenuItem,
      {
        label: '播放整张专辑（从此开始）',
        icon: '🎵',
        onClick: () => handlePlayTrack(track, index),
      },
      {
        label: '播放整张专辑',
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
        <div className="empty-text">未选择专辑</div>
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
              <span>{tracks.length} 首歌曲</span>
              <span>•</span>
              <span>{formatDuration(totalDuration)}</span>
            </div>
            <div className="album-actions">
              <button className="album-action-btn primary" onClick={handlePlayAll}>
                ▶ 播放全部
              </button>
              <button className="album-action-btn" onClick={handleAddAllToQueue}>
                + 添加到队列
              </button>
            </div>
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="album-tracks">
          <div className="album-tracks-header">
            <div className="track-number">#</div>
            <div className="track-title">标题</div>
            <div className="track-duration">时长</div>
            <div className="track-actions">操作</div>
          </div>
          <div className="album-tracks-list">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className="album-track-item"
                onDoubleClick={() => handlePlayTrack(track, index)}
                onContextMenu={(e) => handleTrackContextMenu(track, index, e)}
                title="双击播放整个专辑（从此歌曲开始） / 右键菜单"
              >
                <div className="track-number">{index + 1}</div>
                <div className="track-title">{track.title}</div>
                <div className="track-duration">{formatDuration(track.duration)}</div>
                <div className="track-actions">
                  <button
                    className="track-action-btn"
                    onClick={(e) => handlePlaySingleTrack(track, e)}
                    title="只播放此歌曲"
                  >
                    ▶
                  </button>
                  <button
                    className="track-action-btn"
                    onClick={(e) => handleAddTrackToQueue(track, e)}
                    title="只添加此歌曲到队列"
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
