import type { ComponentType } from 'react';

import type { MagnetSkinModel } from '../../../themes/useMagnetSkin';

export function resolveMagnetSkinRenderer<P>(
  skin: MagnetSkinModel,
  renderers: Record<string, ComponentType<P>>,
  defaultRendererId: string
): ComponentType<P> {
  const explicitRenderer =
    skin.rendererId !== defaultRendererId ? renderers[skin.rendererId] : undefined;

  return (
    explicitRenderer ??
    renderers[skin.variant] ??
    renderers[skin.rendererId] ??
    renderers[defaultRendererId] ??
    Object.values(renderers)[0]
  );
}
