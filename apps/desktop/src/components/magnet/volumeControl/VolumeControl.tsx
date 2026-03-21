import React from 'react';
import { useVolumeData } from './useVolumeData';
import { useVolumeLogic } from './useVolumeLogic';
import { StandardVolume } from './StandardVolume';
import { VOLUME_VARIANT_PRESETS } from './volumeSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const VOLUME_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardVolume, VOLUME_VARIANT_PRESETS),
};

export const VolumeControl: React.FC = () => {
  const data = useVolumeData();
  const logic = useVolumeLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-volume', VOLUME_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};

