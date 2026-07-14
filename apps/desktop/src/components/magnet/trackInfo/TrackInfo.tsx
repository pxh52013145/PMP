import React from 'react';
import { useTrackInfoData } from './useTrackInfoData';
import { useTrackInfoLogic } from './useTrackInfoLogic';
import { useDynamicColor } from './useDynamicColor';
import { MinimalView } from './MinimalView';
import { SpinningVinylView } from './SpinningVinylView';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import { TRACK_INFO_VARIANT_PRESETS } from './trackInfoSkin';

const TRACK_INFO_RENDERERS = {
  default: SpinningVinylView,
  'spinning-vinyl': SpinningVinylView,
  minimal: MinimalView,
};

const TRACK_INFO_VARIANT_IDS = new Set(TRACK_INFO_VARIANT_PRESETS.map((preset) => preset.id));

if (import.meta.env.DEV) {
  for (const rendererId of Object.keys(TRACK_INFO_RENDERERS)) {
    if (rendererId === 'default') continue;
    if (!TRACK_INFO_VARIANT_IDS.has(rendererId)) {
      throw new Error(`Track Info renderer "${rendererId}" is missing from the variant catalog.`);
    }
  }
}

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
      skinProps={skin.props}
    />
  );
};
