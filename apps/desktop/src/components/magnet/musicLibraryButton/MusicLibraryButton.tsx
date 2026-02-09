import React from 'react';
import { useMusicLibraryData } from './useMusicLibraryData';
import { useMusicLibraryLogic } from './useMusicLibraryLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardMusicLibrary } from './StandardMusicLibrary';

export const MusicLibraryButton: React.FC = () => {
  const data = useMusicLibraryData();
  const logic = useMusicLibraryLogic();
  const themeConfig = useComponentTheme('btn-music-library');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardMusicLibrary data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
