import React from 'react';
import { useT } from '../../../i18n';
import { MusicLibraryVariantProps } from './MusicLibraryTypes';
import './StandardMusicLibrary.css';

const LibraryIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="music-library-icon" aria-hidden="true">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
    <path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
    <path d="M9 17v-13h10v13" />
    <path d="M9 8h10" />
  </svg>
);

export const StandardMusicLibrary: React.FC<MusicLibraryVariantProps> = ({ logic }) => {
  const { navigateToMusicLibrary } = logic;
  const t = useT();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigateToMusicLibrary();
  };

  return (
    <button
      className="magnet-control-button music-library-button"
      onClick={handleClick}
      title={t('magnet.renderers.btn-music-library.preview')}
    >
      <LibraryIcon />
    </button>
  );
};
