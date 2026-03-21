import React from 'react';
import { useProgressBarLogic } from './useProgressBarLogic';
import { useProgressBarData } from './useProgressBarData';
import { useDynamicColor } from '../shared/useDynamicColor';
import { StandardProgressBar } from './StandardProgressBar';
import { PROGRESS_BAR_VARIANT_PRESETS } from './progressBarSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PROGRESS_BAR_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardProgressBar, PROGRESS_BAR_VARIANT_PRESETS),
};

export const ProgressBar: React.FC = () => {
  const logic = useProgressBarLogic();
  const data = useProgressBarData(logic.isSeeking);
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('progress-bar', PROGRESS_BAR_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  const dynamicColorEnabled = skin.dynamicColor?.extractFromCover !== false;
  const dynamicColors = useDynamicColor(data.coverUrl, dynamicColorEnabled, {
    sampleSize: 'small',
    releaseAfterExtract: true,
  });

  return (
    <Renderer
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={skin.dynamicColor}
      skinProps={skin.props}
    />
  );
};

