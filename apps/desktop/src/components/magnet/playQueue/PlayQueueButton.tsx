import React from 'react';
import { usePlayQueueData } from './usePlayQueueData';
import { usePlayQueueLogic } from './usePlayQueueLogic';
import { StandardPlayQueue } from './StandardPlayQueue';
import { PLAY_QUEUE_VARIANT_PRESETS } from './playQueueSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAY_QUEUE_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardPlayQueue, PLAY_QUEUE_VARIANT_PRESETS),
};

export const PlayQueueButton: React.FC = () => {
  const data = usePlayQueueData();
  const logic = usePlayQueueLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-play-queue', PLAY_QUEUE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};

