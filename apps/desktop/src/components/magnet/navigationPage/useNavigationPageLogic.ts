import { Track } from '../../../services/audio';
import { NavigationPageType } from '../../../contexts/NavigationContext';
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

  const getPageTitle = (pageType: NavigationPageType): string => {
    switch (pageType) {
      case 'home':
        return '首页';
      case 'settings':
        return '设置';
      case 'music-library':
        return '音乐库';
      case 'playlists':
        return '歌单';
      case 'play-queue':
        return '播放列表';
      case 'track':
        return '歌曲详情';
      case 'album':
        return '专辑';
      case 'artist':
        return '艺术家';
      case 'native-debug':
        return '原生引擎调试';
      default:
        return '首页';
    }
  };

  return {
    handlePlayNow,
    handleAddToQueue,
    getPageTitle,
  };
}
