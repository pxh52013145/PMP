import type { Track } from '../../../services/audio';
import { NavigationPageLogic } from './NavigationPageTypes';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export function useNavigationPageLogic(): NavigationPageLogic {
  const audioService = useAudioService();
  const handlePlayNow = async (tracks: Track[], startIndex: number = 0) => {
    if (tracks.length === 0) return;
    audioService.clearQueue();
    audioService.addMultipleToQueue(tracks);
    await audioService.playTrackAtIndex(Math.max(0, startIndex));
  };

  const handleAddToQueue = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    audioService.addMultipleToQueue(tracks);
  };

  return {
    handlePlayNow,
    handleAddToQueue,
  };
}
