import React from 'react';
import { usePlayModeData } from './usePlayModeData';
import { usePlayModeLogic } from './usePlayModeLogic';
import { MinimalPlayMode } from './MinimalPlayMode';
import { PLAY_MODE_VARIANT_PRESETS } from './playModeSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAY_MODE_RENDERERS = {
  ...buildMagnetVariantRenderers(MinimalPlayMode, PLAY_MODE_VARIANT_PRESETS),
};

export const PlayModeButton: React.FC = () => {
  const data = usePlayModeData();
  const logic = usePlayModeLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-mode', PLAY_MODE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};

