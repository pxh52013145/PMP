import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';
import { useDynamicColor } from '../shared/useDynamicColor';
import { CyberPlayPause } from './CyberPlayPause';

export const PlayPauseButton: React.FC = () => {
  const data = usePlaybackData();
  const logic = usePlaybackLogic();
  const themeConfig = useComponentTheme('btn-play-pause');

  const dynamicColorEnabled = themeConfig.dynamicColor?.extractFromCover !== false;
  const coverUrl = useCoverUrlForTrack(dynamicColorEnabled ? data.currentTrack : null, {
    coverSizeHint: 'small',
  });
  const dynamicColors = useDynamicColor(coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
    releaseAfterExtract: true,
  });
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
    <CyberPlayPause
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={dynamicColorConfig}
      variantConfig={themeConfig.variantConfig}
    />
  );
};
