import React, { useCallback, useEffect, useState } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import type { Track } from '../../services/audio';
import { useComponentTheme } from '../../themes/contexts/ThemeContextWithSync';
import { AudioVisualizer } from './AudioVisualizer';
import { useCoverUrlForTrack } from './shared/useCoverUrlForTrack';
import { useDynamicColor } from './shared/useDynamicColor';
import { isSameTrackRenderIdentity, sanitizeTrackForRuntime } from './shared/sanitizeTrackForRuntime';

export const AudioVisualizerMagnet: React.FC = () => {
  const audioService = useAudioService();
  const themeConfig = useComponentTheme('audio-visualizer');
  const [playbackState, setPlaybackState] = useState(() => audioService.getState().playbackState);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() =>
    sanitizeTrackForRuntime(audioService.getState().currentTrack)
  );

  const dynamicColorEnabled = themeConfig.dynamicColor?.extractFromCover !== false;
  const coverUrl = useCoverUrlForTrack(dynamicColorEnabled ? currentTrack : null, {
    coverSizeHint: 'small',
  });
  const dynamicColors = useDynamicColor(coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
    releaseAfterExtract: true,
  });

  useEffect(() => {
    const state = audioService.getState();
    setPlaybackState(state.playbackState);
    setCurrentTrack(sanitizeTrackForRuntime(state.currentTrack));

    return audioService.onStateChange((nextState) => {
      setPlaybackState(nextState.playbackState);
      const sanitizedTrack = sanitizeTrackForRuntime(nextState.currentTrack);
      setCurrentTrack((previousTrack) =>
        isSameTrackRenderIdentity(previousTrack, sanitizedTrack) ? previousTrack : sanitizedTrack
      );
    });
  }, [audioService]);

  const getFrequencyData = useCallback(
    () => audioService.getFrequencyData?.() ?? null,
    [audioService]
  );

  return (
    <AudioVisualizer
      getFrequencyData={getFrequencyData}
      isPlaying={playbackState === 'playing'}
      accentColor={dynamicColorEnabled ? dynamicColors.accentColor : undefined}
    />
  );
};

