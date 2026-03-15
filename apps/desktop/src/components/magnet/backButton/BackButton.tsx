import React from 'react';
import { useBackButtonData } from './useBackButtonData';
import { useBackButtonLogic } from './useBackButtonLogic';
import { StandardBackButton } from './StandardBackButton';
import { BACK_BUTTON_VARIANT_PRESETS } from './backButtonSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const BACK_BUTTON_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardBackButton, BACK_BUTTON_VARIANT_PRESETS),
};

export const BackButton: React.FC = () => {
  const data = useBackButtonData();
  const logic = useBackButtonLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-back', BACK_BUTTON_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
