import React from 'react';
import { useVolumeData } from './useVolumeData';
import { useVolumeLogic } from './useVolumeLogic';
import { StandardVolume } from './StandardVolume';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const VOLUME_RENDERERS = {
  default: StandardVolume,
};

export const VolumeControl: React.FC = () => {
  const data = useVolumeData();
  const logic = useVolumeLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-volume', VOLUME_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
