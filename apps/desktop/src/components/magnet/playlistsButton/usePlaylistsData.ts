import { useEffect, useState } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PlaylistsData {
  playlistCount: number;
}

export function usePlaylistsData(): PlaylistsData {
  const audioService = useAudioService();
  const [playlistCount, setPlaylistCount] = useState(() => audioService.getState().playlists.length);

  useEffect(() => {
    setPlaylistCount(audioService.getState().playlists.length);
    return audioService.onStateChange((state) => {
      setPlaylistCount(state.playlists.length);
    });
  }, [audioService]);

  return { playlistCount };
}
