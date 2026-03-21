import React from 'react';
import { useDebugButtonData } from './useDebugButtonData';
import { useDebugButtonLogic } from './useDebugButtonLogic';
import { StandardDebugButton } from './StandardDebugButton';
import { DEBUG_BUTTON_VARIANT_PRESETS } from './debugButtonSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const DEBUG_BUTTON_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardDebugButton, DEBUG_BUTTON_VARIANT_PRESETS),
};

export const DebugButton: React.FC = () => {
  const data = useDebugButtonData();
  const logic = useDebugButtonLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-debug', DEBUG_BUTTON_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};
