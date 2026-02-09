/**
 * TrackInfo 变体：旋转唱片
 * 当前的默认实现
 */

import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrackInfoVariantProps } from './TrackInfoTypes';
import { buildCoverGradient } from '../shared/useDynamicColor';
import './SpinningVinylView.css';

export const SpinningVinylView: React.FC<TrackInfoVariantProps> = ({
  data,
  logic,
  dynamicColors,
  dynamicColorConfig,
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const [infoPosition, setInfoPosition] = useState({ x: 0, y: 0 });
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [artistOverflow, setArtistOverflow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const artistRef = useRef<HTMLDivElement>(null);
  const vinylRef = useRef<HTMLDivElement>(null);

  const rpm = 33.33;
  const goldenRatio = 1.618;
  const silverRatio = Math.SQRT2;
  const secondsPerRotation = (60 / rpm) * goldenRatio * silverRatio;

  const effect = dynamicColorConfig?.effect ?? 'tone';
  const gradientAngle =
    typeof dynamicColorConfig?.gradientAngle === 'number' && isFinite(dynamicColorConfig.gradientAngle)
      ? dynamicColorConfig.gradientAngle
      : 90;

  const coverGradient =
    dynamicColors && (effect === 'gradient' || effect === 'dynamic')
      ? buildCoverGradient(dynamicColors, gradientAngle)
      : null;

  const containerStyle = dynamicColors
    ? ({
        '--vinyl-color': dynamicColors.dominantColor || '#1a1a1a',
        '--vinyl-glow': dynamicColors.accentColor || 'rgba(255, 255, 255, 0.6)',
        '--vinyl-glow-secondary':
          effect === 'tone'
            ? dynamicColors.accentColor || 'rgba(255, 255, 255, 0.6)'
            : dynamicColors.dominantColor || '#1a1a1a',
        '--text-color': dynamicColors.textColor || 'rgba(255, 255, 255, 0.9)',
        ...(coverGradient ? { '--cover-gradient': coverGradient } : {}),
      } as React.CSSProperties)
    : undefined;

  // 简化方案：只设置外圈动画，封面跟随父元素旋转
  useEffect(() => {
    if (!vinylRef.current) return;

    // 只设置外圈旋转
    const effect = dynamicColorConfig?.effect ?? 'tone';
    const dynamicSpeed =
      typeof dynamicColorConfig?.dynamicSpeed === 'number' && isFinite(dynamicColorConfig.dynamicSpeed)
        ? dynamicColorConfig.dynamicSpeed
        : 6;

    const animations: string[] = [];
    if (data.isPlaying) {
      animations.push(`spin ${secondsPerRotation}s linear infinite`);
    }
    if (effect === 'dynamic') {
      animations.push(`pmp-vinyl-glow-pulse ${dynamicSpeed}s ease-in-out infinite`);
    }

    vinylRef.current.style.animation = animations.length > 0 ? animations.join(', ') : 'none';
    vinylRef.current.style.animationPlayState = animations.length > 0 ? 'running' : 'paused';
  }, [data.isPlaying, dynamicColorConfig?.dynamicSpeed, dynamicColorConfig?.effect, secondsPerRotation]);

  // 检测文本溢出
  useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current) {
        const container = titleRef.current;
        const inner = container.querySelector('.track-text-inner') as HTMLElement;
        if (inner) {
          setTitleOverflow(inner.offsetWidth > container.clientWidth);
        }
      }
      if (artistRef.current) {
        const container = artistRef.current;
        const inner = container.querySelector('.track-text-inner') as HTMLElement;
        if (inner) {
          setArtistOverflow(inner.offsetWidth > container.clientWidth);
        }
      }
    };

    const timer = setTimeout(checkOverflow, 0);
    window.addEventListener('resize', checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [data.track]);

  // 计算信息弹窗位置
  const updateInfoPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const padding = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popupWidth = 280;
      const popupMaxHeight = Math.min(350, viewportHeight - 48);

      let x = rect.right + padding;
      let y = rect.top;

      if (x + popupWidth > viewportWidth - padding) {
        x = rect.left - popupWidth - padding;
      }

      if (x < padding) {
        x = Math.max(padding, (viewportWidth - popupWidth) / 2);
      }

      y = rect.top + rect.height / 2 - popupMaxHeight / 2;

      if (y < padding) {
        y = padding;
      }
      if (y + popupMaxHeight > viewportHeight - padding) {
        y = viewportHeight - popupMaxHeight - padding;
      }

      setInfoPosition({ x, y });
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.track) return;
    logic.onNavigateToTrack(data.track);
  };

  const handleMouseEnter = () => {
    if (!data.track) return;
    updateInfoPosition();
    setShowInfo(true);
  };

  const handleMouseLeave = () => {
    setShowInfo(false);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 渲染信息弹窗
  const renderInfo = () => {
    if (!showInfo || !data.track) return null;

    const infoElement = (
      <div
        className="track-info-popup"
        style={{
          left: `${infoPosition.x}px`,
          top: `${infoPosition.y}px`,
        }}
      >
        <div className="track-info-popup-header">
          <h3>歌曲信息</h3>
        </div>

        <div className="track-info-popup-body">
          <div className="track-info-popup-section">
            <div className="track-info-popup-item">
              <span className="label">标题</span>
              <span className="value">{data.track.title}</span>
            </div>
            <div className="track-info-popup-item">
              <span className="label">艺术家</span>
              <span className="value">{data.track.artist || '未知'}</span>
            </div>
            <div className="track-info-popup-item">
              <span className="label">专辑</span>
              <span className="value">{data.track.album || '未知'}</span>
            </div>
            {data.track.year && (
              <div className="track-info-popup-item">
                <span className="label">年份</span>
                <span className="value">{data.track.year}</span>
              </div>
            )}
            {data.track.genre && (
              <div className="track-info-popup-item">
                <span className="label">流派</span>
                <span className="value">{data.track.genre}</span>
              </div>
            )}
          </div>

          {(data.track.bitrate ||
            data.track.sampleRate ||
            data.track.format ||
            data.track.duration) && (
            <div className="track-info-popup-section">
              {data.track.duration && (
                <div className="track-info-popup-item">
                  <span className="label">时长</span>
                  <span className="value">{formatDuration(data.track.duration)}</span>
                </div>
              )}
              {data.track.bitrate && (
                <div className="track-info-popup-item">
                  <span className="label">比特率</span>
                  <span className="value">{data.track.bitrate} kbps</span>
                </div>
              )}
              {data.track.sampleRate && (
                <div className="track-info-popup-item">
                  <span className="label">采样率</span>
                  <span className="value">{(data.track.sampleRate / 1000).toFixed(1)} kHz</span>
                </div>
              )}
              {data.track.format && (
                <div className="track-info-popup-item">
                  <span className="label">格式</span>
                  <span className="value">{data.track.format}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );

    return createPortal(infoElement, document.body);
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`track-info-container ${data.track ? 'has-track' : ''}${effect === 'gradient' ? ' cover-color-gradient' : ''}${effect === 'dynamic' ? ' cover-color-dynamic' : ''}`}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={containerStyle}
        title={data.track ? '点击进入歌曲页 / 悬停查看信息' : '未加载音频'}
      >
        {/* 圆形唱片封面 */}
        <div
          ref={vinylRef}
          className={`track-vinyl ${data.isPlaying ? 'spinning' : ''}`}
        >
          {data.track?.coverUrl ? (
            <img src={data.track.coverUrl} alt="Cover" className="track-cover-image" />
          ) : (
            <div className="track-cover-placeholder">♪</div>
          )}
        </div>

        {/* 歌曲信息 */}
        <div className="track-info-text">
          <div ref={titleRef} className={`track-title-compact ${titleOverflow ? 'overflow' : ''}`}>
            <span className="track-text-inner">{data.track?.title || '未加载音频'}</span>
          </div>
          <div
            ref={artistRef}
            className={`track-artist-compact ${artistOverflow ? 'overflow' : ''}`}
          >
            <span className="track-text-inner">{data.track?.artist || '请选择音频文件'}</span>
          </div>
        </div>
      </div>
      {renderInfo()}
    </>
  );
};
