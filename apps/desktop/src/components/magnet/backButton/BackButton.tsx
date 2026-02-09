import React from 'react';
import { useBackButtonData } from './useBackButtonData';
import { useBackButtonLogic } from './useBackButtonLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardBackButton } from './StandardBackButton';

export const BackButton: React.FC = () => {
  const data = useBackButtonData();
  const logic = useBackButtonLogic();
  const themeConfig = useComponentTheme('btn-back');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardBackButton data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
