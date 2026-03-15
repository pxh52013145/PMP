import React from 'react';
import { useTrackInfoData } from './useTrackInfoData';
import { useTrackInfoLogic } from './useTrackInfoLogic';
import { useDynamicColor } from './useDynamicColor';
import { MinimalView } from './MinimalView';
import { SpinningVinylView } from './SpinningVinylView';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const TRACK_INFO_RENDERERS = {
  default: SpinningVinylView,
  'spinning-vinyl': SpinningVinylView,
  minimal: MinimalView,
};

export const TrackInfo: React.FC = () => {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const data = useTrackInfoData();
  const logic = useTrackInfoLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('track-info', TRACK_INFO_RENDERERS, {
    defaultRendererId: lowRenderMode ? 'minimal' : 'default',
    defaultVariant: lowRenderMode ? 'minimal' : 'spinning-vinyl',
  });

  const dynamicColorEnabled =
    !lowRenderMode && skin.dynamicColor?.extractFromCover !== false;
  const dynamicColors = useDynamicColor(data.track?.coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
  });
  const EffectiveRenderer = lowRenderMode ? MinimalView : Renderer;

  return (
    <EffectiveRenderer
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={skin.dynamicColor}
      variantConfig={skin.props}
    />
  );
};
