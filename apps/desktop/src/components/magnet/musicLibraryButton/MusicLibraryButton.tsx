import React from 'react';
import { useMusicLibraryData } from './useMusicLibraryData';
import { useMusicLibraryLogic } from './useMusicLibraryLogic';
import { StandardMusicLibrary } from './StandardMusicLibrary';
import { MUSIC_LIBRARY_VARIANT_PRESETS } from './musicLibrarySkin';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';

const MUSIC_LIBRARY_RENDERERS = {
  ...buildMagnetVariantRenderers(StandardMusicLibrary, MUSIC_LIBRARY_VARIANT_PRESETS),
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
