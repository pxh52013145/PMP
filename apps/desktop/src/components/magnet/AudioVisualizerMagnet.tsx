import React, { useCallback, useEffect, useState } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { AudioVisualizer } from './AudioVisualizer';

export const AudioVisualizerMagnet: React.FC = () => {
  const audioService = useAudioService();
  const [playbackState, setPlaybackState] = useState(() => audioService.getState().playbackState);

  useEffect(() => {
    setPlaybackState(audioService.getState().playbackState);
    return audioService.onStateChange((state) => setPlaybackState(state.playbackState));
  }, [audioService]);

  const getFrequencyData = useCallback(
    () => audioService.getFrequencyData?.() ?? null,
    [audioService]
  );

  return <AudioVisualizer getFrequencyData={getFrequencyData} isPlaying={playbackState === 'playing'} />;
};

