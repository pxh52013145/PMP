import React from 'react';
import { useMusicLibraryData } from './useMusicLibraryData';
import { useMusicLibraryLogic } from './useMusicLibraryLogic';
import { StandardMusicLibrary } from './StandardMusicLibrary';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const MUSIC_LIBRARY_RENDERERS = {
  default: StandardMusicLibrary,
};

export const MusicLibraryButton: React.FC = () => {
  const data = useMusicLibraryData();
  const logic = useMusicLibraryLogic();
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-music-library', MUSIC_LIBRARY_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer data={data} logic={logic} variantConfig={skin.props} />;
};
