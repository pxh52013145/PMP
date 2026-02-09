import React from 'react';
import { useVolumeData } from './useVolumeData';
import { useVolumeLogic } from './useVolumeLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardVolume } from './StandardVolume';

export const VolumeControl: React.FC = () => {
  const data = useVolumeData();
  const logic = useVolumeLogic();
  const themeConfig = useComponentTheme('btn-volume');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardVolume data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
