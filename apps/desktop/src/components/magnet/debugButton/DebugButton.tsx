import React from 'react';
import { useDebugButtonData } from './useDebugButtonData';
import { useDebugButtonLogic } from './useDebugButtonLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardDebugButton } from './StandardDebugButton';

export const DebugButton: React.FC = () => {
  const data = useDebugButtonData();
  const logic = useDebugButtonLogic();
  const themeConfig = useComponentTheme('btn-debug');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardDebugButton data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
