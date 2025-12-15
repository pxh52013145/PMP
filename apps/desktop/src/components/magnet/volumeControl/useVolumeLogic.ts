/**
 * VolumeControl 逻辑层 Hook
 * 负责音量控制逻辑和弹出窗口管理
 */

import { useState, useRef, useEffect } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PopupState {
  show: boolean;
  position: { x: number; y: number } | null;
}

export interface VolumeLogic {
  // 弹出窗口相关
  popupState: PopupState;
  containerRef: React.RefObject<HTMLDivElement>;
  popupRef: React.RefObject<HTMLDivElement>;
  togglePopup: (e: React.MouseEvent<HTMLButtonElement>) => void;

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
  const audioService = useAudioService();
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

  const togglePopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    if (!popupState.show) {
      // 直接从点击的按钮元素获取位置
      const button = e.currentTarget;
      const rect = button.getBoundingClientRect();

      // 弹窗的估算尺寸（根据CSS中的实际内容）
      const popupWidth = 50; // 能量条弹窗的宽度（更窄）
      const popupHeight = 270; // 能量条弹窗的高度（减小高度）
      const gap = 8; // 按钮和弹窗之间的间距
      const padding = 8; // 窗口边缘的安全距离

      // 获取窗口尺寸
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // 计算理想位置：按钮上方居中
      let x = rect.left + rect.width / 2 - popupWidth / 2;
      let y = rect.top - popupHeight - gap;

      // 边界检测和调整
      // 如果弹窗超出窗口上方，显示在按钮下方
      if (y < padding) {
        y = rect.bottom + gap;
      }

      // 如果弹窗超出窗口下方，尽量贴近底部
      if (y + popupHeight > windowHeight - padding) {
        y = windowHeight - popupHeight - padding;
      }

      // 如果弹窗超出窗口左侧
      if (x < padding) {
        x = padding;
      }

      // 如果弹窗超出窗口右侧
      if (x + popupWidth > windowWidth - padding) {
        x = windowWidth - popupWidth - padding;
      }

      setPopupState({
        show: true,
        position: { x, y },
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
