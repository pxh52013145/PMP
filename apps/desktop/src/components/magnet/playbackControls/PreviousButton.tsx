import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { StandardPrevious } from './StandardPrevious';
import { PLAYBACK_STEP_VARIANT_PRESETS } from './playbackStepSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PREVIOUS_BUTTON_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardPrevious, PLAYBACK_STEP_VARIANT_PRESETS),
};

export const PreviousButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-previous', PREVIOUS_BUTTON_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};

