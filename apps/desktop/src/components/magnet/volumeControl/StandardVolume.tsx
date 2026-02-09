/**
 * 标准音量控制变体
 * 包含按钮和弹出滑块
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { VolumeVariantProps } from './VolumeTypes';
import './StandardVolume.css';

export const StandardVolume: React.FC<VolumeVariantProps> = ({ data, logic }) => {
  const { volume, muted } = data;
  const {
    popupState,
    containerRef,
    popupRef,
    togglePopup,
    setVolume,
    toggleMute,
    getVolumeIcon,
    formatVolumePercent,
  } = logic;

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  // 渲染弹窗（使用Portal渲染到body）
  const renderPopup = () => {
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
        <span className="volume-value">{formatVolumePercent(volume)}</span>
        <div className="volume-slider-container">
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
        </div>
        <button
          className="volume-mute-btn"
          onClick={toggleMute}
          title={muted ? '取消静音' : '静音'}
        >
          {muted ? '⊗' : '♪'}
        </button>
      </div>
    );

    return createPortal(popupElement, document.body);
  };

  return (
    <>
      <div className="volume-control-container" ref={containerRef}>
        <button
          className="volume-btn"
          onClick={togglePopup}
          title={`音量: ${formatVolumePercent(volume)}`}
        >
          {getVolumeIcon(volume, muted)}
        </button>
      </div>
      {renderPopup()}
    </>
  );
};
