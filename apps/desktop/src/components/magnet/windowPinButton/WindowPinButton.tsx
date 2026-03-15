import React from 'react';
import { useWindowPinDataWithSetter } from './useWindowPinData';
import { useWindowPinLogic } from './useWindowPinLogic';
import { StandardWindowPin } from './StandardWindowPin';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const WINDOW_PIN_RENDERERS = {
  default: StandardWindowPin,
};

export const WindowPinButton: React.FC = () => {
  const [data, setIsPinned] = useWindowPinDataWithSetter();
  const logic = useWindowPinLogic(data.isPinned, setIsPinned);
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-window-pin', WINDOW_PIN_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
