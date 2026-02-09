import React from 'react';
import { usePlayModeData } from './usePlayModeData';
import { usePlayModeLogic } from './usePlayModeLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { MinimalPlayMode } from './MinimalPlayMode';

export const PlayModeButton: React.FC = () => {
  const data = usePlayModeData();
  const logic = usePlayModeLogic();
  const themeConfig = useComponentTheme('btn-mode');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <MinimalPlayMode data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
