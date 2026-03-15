import React from 'react';
import { usePlayQueueData } from './usePlayQueueData';
import { usePlayQueueLogic } from './usePlayQueueLogic';
import { StandardPlayQueue } from './StandardPlayQueue';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAY_QUEUE_RENDERERS = {
  default: StandardPlayQueue,
};

export const PlayQueueButton: React.FC = () => {
  const data = usePlayQueueData();
  const logic = usePlayQueueLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-play-queue', PLAY_QUEUE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
