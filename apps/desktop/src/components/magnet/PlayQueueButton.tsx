/**
 * 播放列表按钮组件
 * 点击显示当前播放队列
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { audioService, AudioState } from '../../services/audio';
import './PlayQueueButton.css';

export const PlayQueueButton: React.FC = () => {
  const [showQueue, setShowQueue] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>(audioService.getState());

  useEffect(() => {
    const unsubscribe = audioService.onStateChange(setAudioState);
    return unsubscribe;
  }, []);

  const handlePlayTrack = (index: number) => {
    audioService.playTrackAtIndex(index);
  };

  const handleRemoveTrack = (index: number) => {
    // 从队列移除
    const queue = audioService.getQueue();
    const newQueue = queue.filter((_, i) => i !== index);
    audioService.clearQueue();
    newQueue.forEach((track) => audioService.addToQueue(track));
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const modal = showQueue
    ? createPortal(
        <div className="queue-modal-overlay" onClick={() => setShowQueue(false)}>
          <div className="queue-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="queue-modal-header">
              <span className="queue-modal-title">📋 播放列表 ({audioState.queue.length})</span>
              <button className="queue-modal-close" onClick={() => setShowQueue(false)}>
                ✕
              </button>
            </div>
            <div className="queue-list">
              {audioState.queue.length === 0 ? (
                <div className="queue-empty">播放列表为空</div>
              ) : (
                audioState.queue.map((track, index) => (
                  <div
                    key={track.id}
                    className={`queue-item ${index === audioState.currentIndex ? 'queue-item-active' : ''}`}
                    onClick={() => handlePlayTrack(index)}
                  >
                    <div className="queue-item-index">{String(index + 1).padStart(2, '0')}</div>
                    <div className="queue-item-info">
                      <div className="queue-item-title">{track.title}</div>
                      <div className="queue-item-artist">{track.artist || '未知艺术家'}</div>
                    </div>
                    <div className="queue-item-duration">
                      {track.duration ? formatTime(track.duration) : '-'}
                    </div>
                    <button
                      className="queue-item-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTrack(index);
                      }}
                      title="从播放列表移除"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        className="play-queue-button"
        onClick={() => setShowQueue(!showQueue)}
        title="播放列表"
      >
        <span className="play-queue-icon">📋</span>
        {audioState.queue.length > 0 && (
          <span className="play-queue-count">{audioState.queue.length}</span>
        )}
      </button>
      {modal}
    </>
  );
};
