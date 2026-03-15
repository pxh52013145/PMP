import React from 'react';
import { useDebugButtonData } from './useDebugButtonData';
import { useDebugButtonLogic } from './useDebugButtonLogic';
import { StandardDebugButton } from './StandardDebugButton';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const DEBUG_BUTTON_RENDERERS = {
  default: StandardDebugButton,
};

export const DebugButton: React.FC = () => {
  const data = useDebugButtonData();
  const logic = useDebugButtonLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-debug', DEBUG_BUTTON_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
