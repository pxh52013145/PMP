/**
 * 播放列表按钮组件
 * 点击显示当前播放队列
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { audioService, AudioState, Track } from '../../services/audio';
import { parseAudioFile } from '../../utils/audioMetadata';
import './PlayQueueButton.css';

export const PlayQueueButton: React.FC = () => {
  const [showQueue, setShowQueue] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>(audioService.getState());
  const [editMode, setEditMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange(setAudioState);
    return unsubscribe;
  }, []);

  const handlePlayTrack = (index: number) => {
    audioService.playTrackAtIndex(index);
  };

  const handleRemoveTrack = (index: number) => {
    audioService.removeFromQueue(index);
  };

  const handleClearQueue = () => {
    audioService.clearQueue();
  };

  const handleAddFiles = async () => {
    try {
      // @ts-ignore - File System Access API
      const fileHandles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Audio Files',
            accept: {
              'audio/*': ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.weba', '.aac'],
            },
          },
        ],
      });

      const tracks: Track[] = [];
      for (const handle of fileHandles) {
        const file = await handle.getFile();
        try {
          const track = await parseAudioFile(file);
          tracks.push(track);
        } catch (error) {
          console.error(`Failed to parse ${file.name}:`, error);
        }
      }

      if (tracks.length > 0) {
        audioService.addMultipleToQueue(tracks);
      }
    } catch (error) {
      console.error('Failed to add files:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && dragIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      audioService.reorderQueue(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const modal = showQueue
    ? createPortal(
        <div className="queue-modal-overlay" onClick={() => setShowQueue(false)}>
          <div className="queue-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="queue-modal-header">
              <span className="queue-modal-title">☰ 播放列表 ({audioState.queue.length})</span>
              <div className="queue-header-actions">
                <button
                  className={`queue-header-btn ${editMode ? 'queue-header-btn-active' : ''}`}
                  onClick={() => setEditMode(!editMode)}
                  title={editMode ? '完成编辑' : '编辑排序'}
                >
                  {editMode ? '✓' : '⚙'}
                </button>
                <button
                  className="queue-header-btn"
                  onClick={handleAddFiles}
                  title="添加文件到列表"
                >
                  +
                </button>
                <button
                  className="queue-header-btn"
                  onClick={handleClearQueue}
                  disabled={audioState.queue.length === 0}
                  title="清空播放列表"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="queue-list">
              {audioState.queue.length === 0 ? (
                <div className="queue-empty">
                  <div className="queue-empty-icon">♪</div>
                  <div className="queue-empty-text">播放列表为空</div>
                  <button className="queue-empty-btn" onClick={handleAddFiles}>
                    添加音乐文件
                  </button>
                </div>
              ) : (
                audioState.queue.map((track, index) => (
                  <div
                    key={track.id}
                    className={`queue-item ${index === audioState.currentIndex ? 'queue-item-active' : ''} ${
                      editMode ? 'queue-item-edit-mode' : ''
                    } ${dragIndex === index ? 'queue-item-dragging' : ''} ${
                      dragOverIndex === index ? 'queue-item-drag-over' : ''
                    }`}
                    draggable={editMode}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onDoubleClick={() => !editMode && handlePlayTrack(index)}
                  >
                    <div className="queue-item-index">{String(index + 1).padStart(2, '0')}</div>
                    <div className="queue-item-info">
                      <div className="queue-item-title" title={track.title}>
                        {track.title}
                      </div>
                      <div className="queue-item-artist" title={track.artist || '未知艺术家'}>
                        {track.artist || '未知艺术家'}
                      </div>
                    </div>
                    <div className="queue-item-duration">
                      {track.duration ? formatTime(track.duration) : '-'}
                    </div>
                    <div
                      className={`queue-item-actions ${editMode ? 'queue-item-actions-hidden' : ''}`}
                    >
                      <button
                        className="queue-item-action-btn queue-item-play"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayTrack(index);
                        }}
                        title="播放"
                        disabled={editMode}
                      >
                        ▶
                      </button>
                      <button
                        className="queue-item-action-btn queue-item-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTrack(index);
                        }}
                        title="从播放列表移除"
                        disabled={editMode}
                      >
                        ✕
                      </button>
                    </div>
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
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowQueue(!showQueue);
        }}
        title="播放列表"
      >
        <span className="play-queue-icon">☰</span>
        {audioState.queue.length > 0 && (
          <span className="play-queue-count">{audioState.queue.length}</span>
        )}
      </button>
      {modal}
    </>
  );
};
