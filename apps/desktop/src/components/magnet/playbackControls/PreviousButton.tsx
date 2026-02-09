import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardPrevious } from './StandardPrevious';

export const PreviousButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const themeConfig = useComponentTheme('btn-previous');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardPrevious data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
