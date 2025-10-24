/**
 * VolumeControl 逻辑层 Hook
 * 负责音量控制逻辑和弹出窗口管理
 */

import { useState, useRef, useEffect } from 'react';
import { audioService } from '../../../services/audio';

export interface PopupState {
  show: boolean;
  position: { x: number; y: number } | null;
}

export interface VolumeLogic {
  // 弹出窗口相关
  popupState: PopupState;
  containerRef: React.RefObject<HTMLDivElement>;
  popupRef: React.RefObject<HTMLDivElement>;
  togglePopup: (e: React.MouseEvent) => void;
  
  // 音量控制
  setVolume: (volume: number) => void;
  toggleMute: (e: React.MouseEvent) => void;
  
  // UI辅助
  getVolumeIcon: (volume: number, muted: boolean) => string;
  formatVolumePercent: (volume: number) => string;
}

/**
 * VolumeControl的逻辑层
 */
export function useVolumeLogic(): VolumeLogic {
  const [popupState, setPopupState] = useState<PopupState>({
    show: false,
    position: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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

  const togglePopup = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!popupState.show && containerRef.current) {
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

  const setVolume = (volume: number) => {
    audioService.setVolume(volume);
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    audioService.toggleMute();
  };

  const getVolumeIcon = (volume: number, muted: boolean): string => {
    if (muted) return '⊗';
    if (volume > 0.5) return '♪+';
    if (volume > 0) return '♪';
    return '⊗';
  };

  const formatVolumePercent = (volume: number): string => {
    return `${Math.round(volume * 100)}%`;
  };

  return {
    popupState,
    containerRef,
    popupRef,
    togglePopup,
    setVolume,
    toggleMute,
    getVolumeIcon,
    formatVolumePercent,
  };
}
