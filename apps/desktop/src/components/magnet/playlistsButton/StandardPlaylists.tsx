import React from 'react';
import { useT } from '../../../i18n';
import { PlaylistsVariantProps } from './PlaylistsTypes';
import { Playlists } from '../Playlists';
import './StandardPlaylists.css';

const PlaylistsIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="playlists-icon" aria-hidden="true">
    <path d="M8 4.5h8a2 2 0 0 1 2 2V19l-5-2.8L8 19V6.5a2 2 0 0 1 2-2Z" />
    <path d="M10 4.5v11.2" />
    <path d="M13.7 8.4v4" />
    <path d="M16.2 7.8v3.4" />
    <path d="M13.7 8.9l2.5-.6" />
    <path d="M13.7 12.4a1.5 1.5 0 1 1-1-.25" />
    <path d="M16.2 11.2a1.5 1.5 0 1 1-1-.25" />
  </svg>
);

export const StandardPlaylists: React.FC<PlaylistsVariantProps> = ({ logic }) => {
  const { isOpen, openPlaylists, closePlaylists } = logic;
  const t = useT();

  return (
    <>
      <button
        className="magnet-control-button playlists-button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openPlaylists();
        }}
        title={t('magnet.renderers.btn-playlists.preview')}
      >
        <PlaylistsIcon />
      </button>
      <Playlists isOpen={isOpen} onClose={closePlaylists} />
    </>
  );
};
