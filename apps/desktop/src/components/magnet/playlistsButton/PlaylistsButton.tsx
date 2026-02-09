import React from 'react';
import { usePlaylistsData } from './usePlaylistsData';
import { usePlaylistsLogic } from './usePlaylistsLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardPlaylists } from './StandardPlaylists';

export const PlaylistsButton: React.FC = () => {
  const data = usePlaylistsData();
  const logic = usePlaylistsLogic();
  const themeConfig = useComponentTheme('btn-playlists');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardPlaylists data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
