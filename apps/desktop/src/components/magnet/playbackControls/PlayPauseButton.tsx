import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';
import { useDynamicColor } from '../shared/useDynamicColor';
import { CyberPlayPause } from './CyberPlayPause';
import { PLAY_PAUSE_VARIANT_PRESETS } from './playPauseSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAY_PAUSE_RENDERERS = {
  cyber: CyberPlayPause,
  ...buildMagnetVariantRenderers(CyberPlayPause, PLAY_PAUSE_VARIANT_PRESETS),
};

export const PlayPauseButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-play-pause', PLAY_PAUSE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  const dynamicColorEnabled = skin.dynamicColor?.extractFromCover !== false;
  const coverUrl = useCoverUrlForTrack(dynamicColorEnabled ? data.currentTrack : null, {
    coverSizeHint: 'small',
  });
  const dynamicColors = useDynamicColor(coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
    releaseAfterExtract: true,
  });

  return (
    <Renderer
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={skin.dynamicColor}
      skinProps={skin.props}
    />
  );
};

