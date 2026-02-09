/**
 * TrackInfo 变体：极简模式
 * 纯文字，无封面
 */

import React, { useRef, useEffect, useState } from 'react';
import { TrackInfoVariantProps } from './TrackInfoTypes';
import './MinimalView.css';

export const MinimalView: React.FC<TrackInfoVariantProps> = ({ data, logic }) => {
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [artistOverflow, setArtistOverflow] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const artistRef = useRef<HTMLSpanElement>(null);

  // 检测文本溢出
  useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current) {
        const container = titleRef.current;
        const inner = container.querySelector('.minimal-text-inner') as HTMLElement;
        if (inner) {
          setTitleOverflow(inner.offsetWidth > container.clientWidth);
        }
      }
      if (artistRef.current) {
        const container = artistRef.current;
        const inner = container.querySelector('.minimal-text-inner') as HTMLElement;
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.track) return;
    logic.onNavigateToTrack(data.track);
  };

  return (
    <div
      className="track-info-minimal"
      onClick={handleClick}
      title={data.track ? '点击进入歌曲页' : '未加载音频'}
    >
      <div className="minimal-text">
        <span ref={titleRef} className={`minimal-title ${titleOverflow ? 'overflow' : ''}`}>
          <span className="minimal-text-inner">{data.track?.title || '未加载音频'}</span>
        </span>
        <span className="minimal-separator">—</span>
        <span ref={artistRef} className={`minimal-artist ${artistOverflow ? 'overflow' : ''}`}>
          <span className="minimal-text-inner">{data.track?.artist || '请选择音频文件'}</span>
        </span>
      </div>
    </div>
  );
};
