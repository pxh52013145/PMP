import React from 'react';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { useNavigationPageData } from './useNavigationPageData';
import { useNavigationPageLogic } from './useNavigationPageLogic';
import { StandardNavigationPage } from './StandardNavigationPage';

export const NavigationPage: React.FC = () => {
  const data = useNavigationPageData();
  const logic = useNavigationPageLogic();
  const themeConfig = useComponentTheme('navigation-page');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardNavigationPage data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
