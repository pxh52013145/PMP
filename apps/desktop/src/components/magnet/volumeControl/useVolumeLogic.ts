import { useEffect, useRef, useState } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PopupState {
  show: boolean;
}

export interface VolumeLogic {
  popupState: PopupState;
  containerRef: React.RefObject<HTMLDivElement>;
  popupRef: React.RefObject<HTMLDivElement>;
  togglePopup: (e: React.MouseEvent<HTMLButtonElement>) => void;
  setVolume: (volume: number) => void;
  toggleMute: (e: React.MouseEvent) => void;
  getVolumeIcon: (volume: number, muted: boolean) => string;
  formatVolumePercent: (volume: number) => string;
}

export function useVolumeLogic(): VolumeLogic {
  const audioService = useAudioService();
  const [popupState, setPopupState] = useState<PopupState>({ show: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popupState.show) return;

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const insideContainer = containerRef.current?.contains(targetNode) ?? false;
      const insidePopup = popupRef.current?.contains(targetNode) ?? false;

      if (!insideContainer && !insidePopup) {
        setPopupState({ show: false });
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopupState({ show: false });
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [popupState.show]);

  const togglePopup = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setPopupState((prev) => ({ show: !prev.show }));
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
