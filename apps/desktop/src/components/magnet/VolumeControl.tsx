/**
 * 音量控制组件
 * 点击按钮会弹出音量拖动条
 * 使用React Portal确保弹窗在最上层，不被其他Magnet遮挡
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { audioService } from '../../services/audio';
import './VolumeControl.css';

export const VolumeControl: React.FC = () => {
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [showSlider, setShowSlider] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setVolume(state.volume);
      setMuted(state.muted);
    });

    // 初始化
    const state = audioService.getState();
    setVolume(state.volume);
    setMuted(state.muted);

    return unsubscribe;
  }, []);

  // 计算弹窗位置
  const updatePopupPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // 弹窗显示在按钮上方居中
      setPopupPosition({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
  };

  // 点击外部关闭滑块
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setShowSlider(false);
      }
    };

    if (showSlider) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSlider]);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showSlider) {
      updatePopupPosition();
    }
    setShowSlider(!showSlider);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    audioService.setVolume(newVolume);
  };

  const handleMuteToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    audioService.toggleMute();
  };

  const getVolumeIcon = () => {
    if (muted) return '🔇';
    if (volume > 0.5) return '🔊';
    if (volume > 0) return '🔉';
    return '🔇';
  };

  // 渲染弹窗（使用Portal渲染到body）
  const renderPopup = () => {
    if (!showSlider) return null;

    const popupElement = (
      <div
        ref={popupRef}
        className="volume-slider-popup volume-slider-popup-portal"
        style={{
          left: `${popupPosition.x}px`,
          top: `${popupPosition.y}px`,
        }}
      >
        <button
          className="volume-mute-btn"
          onClick={handleMuteToggle}
          title={muted ? '取消静音' : '静音'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="volume-slider"
          disabled={muted}
        />
        <span className="volume-value">{Math.round(volume * 100)}%</span>
      </div>
    );

    return createPortal(popupElement, document.body);
  };

  return (
    <>
      <div className="volume-control-container" ref={containerRef}>
        <button
          className="volume-btn"
          onClick={handleButtonClick}
          title={`音量: ${Math.round(volume * 100)}%`}
        >
          {getVolumeIcon()}
        </button>
      </div>
      {renderPopup()}
    </>
  );
};
