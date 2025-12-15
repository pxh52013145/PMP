import React from 'react';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { NavigationPageVariantProps } from './NavigationPageTypes';
import { useNavigationPageData } from './useNavigationPageData';
import { useNavigationPageLogic } from './useNavigationPageLogic';
import { StandardNavigationPage } from './variants/StandardNavigationPage';

const NAVIGATION_VARIANTS: Record<string, React.ComponentType<NavigationPageVariantProps>> = {
  standard: StandardNavigationPage,
  default: StandardNavigationPage,
};

export const NavigationPage: React.FC = () => {
  const data = useNavigationPageData();
  const logic = useNavigationPageLogic();
  const themeConfig = useComponentTheme('navigation-page');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  const variant = themeConfig.variant || 'default';
  const Variant = NAVIGATION_VARIANTS[variant] || StandardNavigationPage;

  return <Variant data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
