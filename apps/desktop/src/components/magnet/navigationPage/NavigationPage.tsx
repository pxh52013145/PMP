import React from 'react';
import { useNavigationPageData } from './useNavigationPageData';
import { useNavigationPageLogic } from './useNavigationPageLogic';
import { StandardNavigationPage } from './StandardNavigationPage';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const NAVIGATION_PAGE_RENDERERS = {
  default: StandardNavigationPage,
};

export const NavigationPage: React.FC = () => {
  const data = useNavigationPageData();
  const logic = useNavigationPageLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('navigation-page', NAVIGATION_PAGE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
