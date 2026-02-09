import React from 'react';
import { usePlayQueueData } from './usePlayQueueData';
import { usePlayQueueLogic } from './usePlayQueueLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardPlayQueue } from './StandardPlayQueue';

export const PlayQueueButton: React.FC = () => {
  const data = usePlayQueueData();
  const logic = usePlayQueueLogic();
  const themeConfig = useComponentTheme('btn-play-queue');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardPlayQueue data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
