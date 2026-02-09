import React from 'react';
import { useProgressBarLogic } from './useProgressBarLogic';
import { useProgressBarData } from './useProgressBarData';
import { useDynamicColor } from '../shared/useDynamicColor';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardProgressBar } from './StandardProgressBar';

export const ProgressBar: React.FC = () => {
  const logic = useProgressBarLogic();
  const data = useProgressBarData(logic.isSeeking);
  const themeConfig = useComponentTheme('progress-bar');

  const dynamicColorEnabled = themeConfig.dynamicColor?.extractFromCover !== false;
  const dynamicColors = useDynamicColor(data.coverUrl, dynamicColorEnabled);
  const dynamicColorConfig = themeConfig.dynamicColor;

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return (
      <CustomRenderer
        data={data}
        logic={logic}
        dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
        dynamicColorConfig={dynamicColorConfig}
        variantConfig={themeConfig.variantConfig}
      />
    );
  }

  return (
    <StandardProgressBar
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={dynamicColorConfig}
      variantConfig={themeConfig.variantConfig}
    />
  );
};
