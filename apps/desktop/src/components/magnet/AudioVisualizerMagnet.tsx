import React, { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import type { Track } from '../../services/audio';
import { AudioVisualizer } from './AudioVisualizer';
import {
  AUDIO_VISUALIZER_VARIANT_PRESETS,
  parseAudioVisualizerSkinProps,
} from './audioVisualizerSkin';
import { buildMagnetVariantRenderers } from './shared/magnetVariantCatalog';
import { useCoverUrlForTrack } from './shared/useCoverUrlForTrack';
import { useDynamicColor } from './shared/useDynamicColor';
import { useResolvedMagnetSkinRenderer } from './shared/useResolvedMagnetSkinRenderer';
import { isSameTrackRenderIdentity, sanitizeTrackForRuntime } from './shared/sanitizeTrackForRuntime';

type AudioVisualizerRendererProps = {
  accentColor?: string;
  getFrequencyData: () => Uint8Array | null;
  isPlaying: boolean;
  skinProps?: Record<string, unknown>;
};

const AudioVisualizerDefaultRenderer = memo(function AudioVisualizerDefaultRenderer({
  accentColor,
  getFrequencyData,
  isPlaying,
  skinProps,
}: AudioVisualizerRendererProps) {
  const resolvedSkinProps = useMemo(() => parseAudioVisualizerSkinProps(skinProps), [skinProps]);

  return (
    <AudioVisualizer
      getFrequencyData={getFrequencyData}
      isPlaying={isPlaying}
      accentColor={accentColor}
      fallbackAccentColor={resolvedSkinProps.fallbackAccentColor}
      density={resolvedSkinProps.density}
      energyProfile={resolvedSkinProps.energyProfile}
      backdrop={resolvedSkinProps.backdrop}
    />
  );
});

const AUDIO_VISUALIZER_RENDERERS = {
  ...buildMagnetVariantRenderers(AudioVisualizerDefaultRenderer, AUDIO_VISUALIZER_VARIANT_PRESETS),
} satisfies Record<string, ComponentType<AudioVisualizerRendererProps>>;

export const AudioVisualizerMagnet: React.FC = () => {
  const audioService = useAudioService();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('audio-visualizer', AUDIO_VISUALIZER_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });
  const [playbackState, setPlaybackState] = useState(() => audioService.getState().playbackState);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() =>
    sanitizeTrackForRuntime(audioService.getState().currentTrack)
  );

  const dynamicColorEnabled = skin.dynamicColor?.extractFromCover !== false;
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
    <Renderer
      getFrequencyData={getFrequencyData}
      isPlaying={playbackState === 'playing'}
      accentColor={dynamicColorEnabled ? dynamicColors.accentColor : undefined}
      skinProps={skin.props}
    />
  );
};
