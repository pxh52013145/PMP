import { useMemo, type ComponentType } from 'react';

import { type MagnetSkinModel, useMagnetSkin } from '../../../themes/useMagnetSkin';

import { resolveMagnetSkinRenderer } from './resolveMagnetSkinRenderer';

export function useResolvedMagnetSkinRenderer<P>(
  componentId: string,
  renderers: Record<string, ComponentType<P>>,
  options: {
    defaultRendererId: string;
    defaultVariant?: string;
  }
): {
  skin: MagnetSkinModel;
  Renderer: ComponentType<P>;
} {
  const skin = useMagnetSkin(componentId, {
    defaultRendererId: options.defaultRendererId,
    defaultVariant: options.defaultVariant,
  });

  const Renderer = useMemo(
    () => resolveMagnetSkinRenderer(skin, renderers, options.defaultRendererId),
    [options.defaultRendererId, renderers, skin]
  );

  return { skin, Renderer };
}
