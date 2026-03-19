/**
 * PlayQueueButton 逻辑层 Hook
 * 负责播放队列操作逻辑
 */

import { useState } from 'react';
import { Track } from '../../../services/audio';
import { parseAudioFile } from '../../../utils/audioMetadata';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { open } from '@tauri-apps/api/dialog';

const telemetry = getTelemetryLogger('audio', 'usePlayQueueLogic');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableIdFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `track-${(hash >>> 0).toString(16)}`;
}

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
  const audioService = useAudioService();
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
    void audioService.playTrackAtIndex(index).catch((error) => {
      telemetry.error('play_queue.play_track.failed', {
        message: readErrorMessage(error),
        fields: {
          index,
          queueSize: audioService.getQueue().length,
        },
      });
    });
  };

  const removeTrack = (index: number) => {
    audioService.removeFromQueue(index);
  };

  const clearQueue = () => {
    audioService.clearQueue();
  };

  const addFiles = async () => {
    try {
      const isTauriRuntime =
        typeof window !== 'undefined' &&
        typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined';

      if (isTauriRuntime) {
        const selected = await open({
          multiple: true,
          directory: false,
          title: '选择音频文件',
          filters: [
            {
              name: 'Audio Files',
              extensions: ['mp3', 'flac', 'wav', 'm4a', 'mp4', 'ogg', 'weba', 'aac'],
            },
          ],
        });

        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];

        const tracks: Track[] = [];
        for (const filePath of paths) {
          const name = filePath.split(/[/\\]/).pop() || filePath;
          tracks.push({
            id: stableIdFromPath(filePath),
            title: name.replace(/\.[^/.]+$/, ''),
            filePath,
            originalPath: filePath,
            path: filePath,
            addedAt: new Date(),
          });
        }

        if (tracks.length > 0) {
          audioService.addMultipleToQueue(tracks);
          telemetry.info('play_queue.add_files.completed', {
            fields: {
              source: 'tauri-dialog',
              selectedCount: paths.length,
              addedCount: tracks.length,
              queueSize: audioService.getQueue().length,
            },
          });
        }
        return;
      }

      const showOpenFilePicker = (window as unknown as {
        showOpenFilePicker?: (options: {
          multiple?: boolean;
          types?: Array<{
            description?: string;
            accept?: Record<string, string[]>;
          }>;
        }) => Promise<Array<{ getFile: () => Promise<File> }>>;
      }).showOpenFilePicker;
      if (!showOpenFilePicker) return;

      const fileHandles = await showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Audio Files',
            accept: {
              'audio/*': ['.mp3', '.flac', '.wav', '.dsf', '.m4a', '.mp4', '.ogg', '.weba', '.aac'],
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
          telemetry.warn('play_queue.add_files.parse_failed', {
            message: readErrorMessage(error),
            fields: {
              fileName: file.name,
              fileSize: file.size,
            },
          });
        }
      }

      if (tracks.length > 0) {
        audioService.addMultipleToQueue(tracks);
        telemetry.info('play_queue.add_files.completed', {
          fields: {
            source: 'web-picker',
            selectedCount: fileHandles.length,
            addedCount: tracks.length,
            queueSize: audioService.getQueue().length,
          },
        });
      }
    } catch (error) {
      telemetry.error('play_queue.add_files.failed', {
        message: readErrorMessage(error),
        fields: {
          queueSize: audioService.getQueue().length,
        },
      });
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
