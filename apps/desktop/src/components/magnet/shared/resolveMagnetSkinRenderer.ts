import type { ComponentType } from 'react';

import type { MagnetSkinModel } from '../../../themes/useMagnetSkin';

export function resolveMagnetSkinRenderer<P>(
  skin: MagnetSkinModel,
  renderers: Record<string, ComponentType<P>>,
  defaultRendererId: string
): ComponentType<P> {
  return (
    renderers[skin.rendererId] ??
    renderers[skin.variant] ??
    renderers[defaultRendererId] ??
    Object.values(renderers)[0]
  );
}
