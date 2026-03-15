import React from 'react';
import { useWindowPinDataWithSetter } from './useWindowPinData';
import { useWindowPinLogic } from './useWindowPinLogic';
import { StandardWindowPin } from './StandardWindowPin';
import { WINDOW_PIN_VARIANT_PRESETS } from './windowPinSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const WINDOW_PIN_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardWindowPin, WINDOW_PIN_VARIANT_PRESETS),
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
