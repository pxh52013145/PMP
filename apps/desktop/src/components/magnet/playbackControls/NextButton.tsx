import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { StandardNext } from './StandardNext';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const NEXT_BUTTON_RENDERERS = {
  default: StandardNext,
};

export const NextButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-next', NEXT_BUTTON_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
