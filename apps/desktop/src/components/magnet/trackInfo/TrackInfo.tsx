import React from 'react';
import { useTrackInfoData } from './useTrackInfoData';
import { useTrackInfoLogic } from './useTrackInfoLogic';
import { useDynamicColor } from './useDynamicColor';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { MinimalView } from './MinimalView';
import { SpinningVinylView } from './SpinningVinylView';

export const TrackInfo: React.FC = () => {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const data = useTrackInfoData();
  const logic = useTrackInfoLogic();
  const themeConfig = useComponentTheme('track-info');

  const dynamicColorEnabled =
    !lowRenderMode && themeConfig.dynamicColor?.extractFromCover !== false;
  const dynamicColors = useDynamicColor(data.track?.coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
  });
  const dynamicColorConfig = themeConfig.dynamicColor;

  const VariantComponent = lowRenderMode ? MinimalView : SpinningVinylView;

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
    <VariantComponent
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={dynamicColorConfig}
      variantConfig={themeConfig.variantConfig}
    />
  );
};
