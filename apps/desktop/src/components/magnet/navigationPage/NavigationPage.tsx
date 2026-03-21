import React from 'react';
import { useNavigationPageData } from './useNavigationPageData';
import { useNavigationPageLogic } from './useNavigationPageLogic';
import { StandardNavigationPage } from './StandardNavigationPage';
import { NAVIGATION_PAGE_VARIANT_PRESETS } from './navigationPageSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const NAVIGATION_PAGE_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardNavigationPage, NAVIGATION_PAGE_VARIANT_PRESETS),
};

export const NavigationPage: React.FC = () => {
  const data = useNavigationPageData();
  const logic = useNavigationPageLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('navigation-page', NAVIGATION_PAGE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};

