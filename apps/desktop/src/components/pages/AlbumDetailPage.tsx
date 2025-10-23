import React, { useEffect, useState } from 'react';
import { Track, audioService } from '../../services/audio';
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
  const [tracks, setTracks] = useState<Track[]>(initialTracks || []);
  const [albumCover, setAlbumCover] = useState<string | undefined>();

  useEffect(() => {
    if (initialTracks && initialTracks.length > 0) {
      setTracks(initialTracks);
      // 使用第一首歌的封面作为专辑封面
      setAlbumCover(initialTracks[0].coverUrl);
    }
  }, [initialTracks]);

  const handlePlayTrack = (track: Track) => {
    audioService.clearQueue();
    audioService.addToQueue([track]);
    audioService.play();
  };

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      audioService.clearQueue();
      audioService.addToQueue(tracks);
      audioService.play();
    }
  };

  const handleAddAllToQueue = () => {
    if (tracks.length > 0) {
      audioService.addToQueue(tracks);
    }
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
        </div>
        <div className="album-tracks-list">
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className="album-track-item"
              onDoubleClick={() => handlePlayTrack(track)}
              title="双击播放"
            >
              <div className="track-number">{index + 1}</div>
              <div className="track-title">{track.title}</div>
              <div className="track-duration">{formatDuration(track.duration)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
