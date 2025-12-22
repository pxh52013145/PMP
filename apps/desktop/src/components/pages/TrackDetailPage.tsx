import React, { useEffect, useState, useCallback } from 'react';
import { Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import './TrackDetailPage.css';

interface TrackDetailPageProps {
  initialTrack?: Track;
}

/**
 * 歌曲详情页组件
 * 显示当前播放歌曲的详细信息、歌词等
 */
export const TrackDetailPage: React.FC<TrackDetailPageProps> = ({ initialTrack }) => {
  const audioService = useAudioService();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(initialTrack || null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dominantColor, setDominantColor] = useState<string>('#1a1a1a');
  const [accentColor, setAccentColor] = useState<string>('rgba(255, 255, 255, 0.1)');

  // 从图片提取主色调
  const extractColorFromImage = useCallback((imageUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 50;
      canvas.height = 50;
      ctx.drawImage(img, 0, 0, 50, 50);

      try {
        const imageData = ctx.getImageData(0, 0, 50, 50);
        const data = imageData.data;

        let r = 0,
          g = 0,
          b = 0;
        let brightR = 0,
          brightG = 0,
          brightB = 0;
        let count = 0;
        let brightCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const brightness = (pr + pg + pb) / 3;

          if (brightness > 30 && brightness < 240) {
            r += pr;
            g += pg;
            b += pb;
            count++;
          }

          if (brightness > 100) {
            brightR += pr;
            brightG += pg;
            brightB += pb;
            brightCount++;
          }
        }

        if (count > 0) {
          r = Math.floor(r / count);
          g = Math.floor(g / count);
          b = Math.floor(b / count);

          const enhanceSaturation = (r: number, g: number, b: number, factor: number) => {
            const avg = (r + g + b) / 3;

            return {
              r: Math.min(255, Math.floor(avg + (r - avg) * factor)),
              g: Math.min(255, Math.floor(avg + (g - avg) * factor)),
              b: Math.min(255, Math.floor(avg + (b - avg) * factor)),
            };
          };

          const enhanced = enhanceSaturation(r, g, b, 1.5);
          setDominantColor(`rgb(${enhanced.r}, ${enhanced.g}, ${enhanced.b})`);
        }

        if (brightCount > 0) {
          brightR = Math.floor(brightR / brightCount);
          brightG = Math.floor(brightG / brightCount);
          brightB = Math.floor(brightB / brightCount);

          setAccentColor(`rgba(${brightR}, ${brightG}, ${brightB}, 0.3)`);
        }
      } catch (error) {
        console.error('Error extracting color:', error);
      }
    };

    img.src = imageUrl;
  }, []);

  // 监听音频状态变化
  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setCurrentTrack(state.currentTrack);
      setIsPlaying(state.playbackState === 'playing');
    });

    const state = audioService.getState();
    if (!initialTrack) {
      setCurrentTrack(state.currentTrack);
    }
    setIsPlaying(state.playbackState === 'playing');

    return unsubscribe;
  }, [audioService, initialTrack]);

  // 尝试从磁盘缓存中懒加载封面（Desktop/Tauri）
  useEffect(() => {
    let cancelled = false;
    const current = currentTrack;
    if (!current) return;

    void musicLibraryService.getCoverUrlForTrack(current).then((url) => {
      if (cancelled) return;
      if (!url) return;
      setCurrentTrack((prev) => {
        if (!prev || prev.id !== current.id) return prev;
        if (prev.coverUrl === url) return prev;
        return { ...prev, coverUrl: url };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  // 提取封面颜色
  useEffect(() => {
    if (currentTrack?.coverUrl) {
      extractColorFromImage(currentTrack.coverUrl);
    }
  }, [currentTrack?.coverUrl, extractColorFromImage]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!currentTrack) {
    return (
      <div className="track-detail-page">
        <div className="track-detail-empty">
          <div className="track-detail-empty-icon">♪</div>
          <div className="track-detail-empty-text">暂无歌曲播放</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="track-detail-page"
      style={
        {
          '--track-color': dominantColor,
          '--track-accent': accentColor,
        } as React.CSSProperties
      }
    >
      {/* 背景效果 */}
      <div className="track-detail-background" />

      {/* 封面区域 */}
      <div className="track-detail-cover-section">
        <div className={`track-detail-cover ${isPlaying ? 'playing' : ''}`}>
          {currentTrack.coverUrl ? (
            <img src={currentTrack.coverUrl} alt="Album Cover" />
          ) : (
            <div className="track-detail-cover-placeholder">♪</div>
          )}
        </div>
      </div>

      {/* 信息区域 */}
      <div className="track-detail-info-section">
        <h1 className="track-detail-title">{currentTrack.title}</h1>
        <p className="track-detail-artist">{currentTrack.artist || '未知艺术家'}</p>
        <p className="track-detail-album">{currentTrack.album || '未知专辑'}</p>

        {/* 详细信息 */}
        <div className="track-detail-metadata">
          {currentTrack.year && (
            <div className="track-detail-meta-item">
              <span className="meta-label">年份</span>
              <span className="meta-value">{currentTrack.year}</span>
            </div>
          )}
          {currentTrack.genre && (
            <div className="track-detail-meta-item">
              <span className="meta-label">流派</span>
              <span className="meta-value">{currentTrack.genre}</span>
            </div>
          )}
          {currentTrack.duration && (
            <div className="track-detail-meta-item">
              <span className="meta-label">时长</span>
              <span className="meta-value">{formatDuration(currentTrack.duration)}</span>
            </div>
          )}
          {currentTrack.bitrate && (
            <div className="track-detail-meta-item">
              <span className="meta-label">比特率</span>
              <span className="meta-value">{currentTrack.bitrate} kbps</span>
            </div>
          )}
          {currentTrack.sampleRate && (
            <div className="track-detail-meta-item">
              <span className="meta-label">采样率</span>
              <span className="meta-value">{(currentTrack.sampleRate / 1000).toFixed(1)} kHz</span>
            </div>
          )}
          {currentTrack.format && (
            <div className="track-detail-meta-item">
              <span className="meta-label">格式</span>
              <span className="meta-value">{currentTrack.format.toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* 歌词区域（占位） */}
        <div className="track-detail-lyrics">
          <div className="lyrics-placeholder">
            <span>暂无歌词</span>
          </div>
        </div>
      </div>
    </div>
  );
};
