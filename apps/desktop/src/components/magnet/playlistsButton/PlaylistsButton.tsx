import React from 'react';
import { usePlaylistsData } from './usePlaylistsData';
import { usePlaylistsLogic } from './usePlaylistsLogic';
import { StandardPlaylists } from './StandardPlaylists';
import { PLAYLISTS_VARIANT_PRESETS } from './playlistsSkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const PLAYLISTS_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardPlaylists, PLAYLISTS_VARIANT_PRESETS),
};

export const PlaylistsButton: React.FC = () => {
  const data = usePlaylistsData();
  const logic = usePlaylistsLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-playlists', PLAYLISTS_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} skinProps={skin.props} />;
};


