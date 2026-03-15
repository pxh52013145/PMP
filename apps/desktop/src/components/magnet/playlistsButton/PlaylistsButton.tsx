import React from 'react';
import { usePlaylistsData } from './usePlaylistsData';
import { usePlaylistsLogic } from './usePlaylistsLogic';
import { StandardPlaylists } from './StandardPlaylists';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAYLISTS_RENDERERS = {
  default: StandardPlaylists,
};

export const PlaylistsButton: React.FC = () => {
  const data = usePlaylistsData();
  const logic = usePlaylistsLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-playlists', PLAYLISTS_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
