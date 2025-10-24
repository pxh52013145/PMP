/**
 * PlayQueueButton 逻辑层 Hook
 * 负责播放队列操作逻辑
 */

import { useState } from 'react';
import { audioService, Track } from '../../../services/audio';
import { parseAudioFile } from '../../../utils/audioMetadata';

export interface DragState {
  dragIndex: number | null;
  dragOverIndex: number | null;
}

export interface PlayQueueLogic {
  // UI状态
  showQueue: boolean;
  editMode: boolean;
  dragState: DragState;
  
  // UI控制
  toggleQueue: () => void;
  closeQueue: () => void;
  toggleEditMode: () => void;
  
  // 播放控制
  playTrack: (index: number) => void;
  removeTrack: (index: number) => void;
  clearQueue: () => void;
  addFiles: () => Promise<void>;
  
  // 拖拽控制
  handleDragStart: (index: number) => void;
  handleDragOver: (index: number) => void;
  handleDragLeave: () => void;
  handleDrop: (toIndex: number) => void;
  handleDragEnd: () => void;
  
  // 工具函数
  formatTime: (seconds: number) => string;
}

/**
 * PlayQueueButton的逻辑层
 */
export function usePlayQueueLogic(): PlayQueueLogic {
  const [showQueue, setShowQueue] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dragState, setDragState] = useState<DragState>({
    dragIndex: null,
    dragOverIndex: null,
  });

  const toggleQueue = () => {
    setShowQueue(!showQueue);
  };

  const closeQueue = () => {
    setShowQueue(false);
    setEditMode(false);
  };

  const toggleEditMode = () => {
    setEditMode(!editMode);
  };

  const playTrack = (index: number) => {
    audioService.playTrackAtIndex(index);
  };

  const removeTrack = (index: number) => {
    audioService.removeFromQueue(index);
  };

  const clearQueue = () => {
    audioService.clearQueue();
  };

  const addFiles = async () => {
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

  const handleDragStart = (index: number) => {
    setDragState({ ...dragState, dragIndex: index });
  };

  const handleDragOver = (index: number) => {
    if (dragState.dragIndex !== null && dragState.dragIndex !== index) {
      setDragState({ ...dragState, dragOverIndex: index });
    }
  };

  const handleDragLeave = () => {
    setDragState({ ...dragState, dragOverIndex: null });
  };

  const handleDrop = (toIndex: number) => {
    if (dragState.dragIndex !== null && dragState.dragIndex !== toIndex) {
      audioService.reorderQueue(dragState.dragIndex, toIndex);
    }
    setDragState({ dragIndex: null, dragOverIndex: null });
  };

  const handleDragEnd = () => {
    setDragState({ dragIndex: null, dragOverIndex: null });
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    showQueue,
    editMode,
    dragState,
    toggleQueue,
    closeQueue,
    toggleEditMode,
    playTrack,
    removeTrack,
    clearQueue,
    addFiles,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    formatTime,
  };
}
