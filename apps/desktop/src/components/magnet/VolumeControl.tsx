/**
 * 音量控制组件
 * 点击按钮会弹出音量拖动条
 * 使用React Portal确保弹窗在最上层，不被其他Magnet遮挡
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { audioService } from '../../services/audio';
import './VolumeControl.css';

interface PopupState {
  show: boolean;
  position: { x: number; y: number } | null;
}

export const VolumeControl: React.FC = () => {
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [popupState, setPopupState] = useState<PopupState>({
    show: false,
    position: null,
  });
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

  // 点击外部关闭滑块
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setPopupState({ show: false, position: null });
      }
    };

    if (popupState.show) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [popupState.show]);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!popupState.show && containerRef.current) {
      // 同步计算位置，并在同一次状态更新中设置显示和位置
      const rect = containerRef.current.getBoundingClientRect();
      setPopupState({
        show: true,
        position: {
          x: rect.left + rect.width / 2,
          y: rect.top,
        },
      });
    } else {
      setPopupState({ show: false, position: null });
    }
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
    if (muted) return '⊗';
    if (volume > 0.5) return '♪+';
    if (volume > 0) return '♪';
    return '⊗';
  };

  // 渲染弹窗（使用Portal渲染到body）
  const renderPopup = () => {
    // 只有当位置计算完成后才渲染弹窗，避免闪烁
    if (!popupState.show || !popupState.position) return null;

    const popupElement = (
      <div
        ref={popupRef}
        className="volume-slider-popup volume-slider-popup-portal"
        style={{
          left: `${popupState.position.x}px`,
          top: `${popupState.position.y}px`,
        }}
      >
        <button
          className="volume-mute-btn"
          onClick={handleMuteToggle}
          title={muted ? '取消静音' : '静音'}
        >
          {muted ? '⊗' : '♪'}
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
