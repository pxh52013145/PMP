import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardNext } from './StandardNext';

export const NextButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const themeConfig = useComponentTheme('btn-next');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardNext data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
