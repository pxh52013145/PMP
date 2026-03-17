import React, { useMemo } from 'react';
import { useT } from '../../../i18n';
import { PlaylistsVariantProps } from './PlaylistsTypes';
import { Playlists } from '../Playlists';
import { parsePlaylistsSkinProps } from './playlistsSkin';
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

export const StandardPlaylists: React.FC<PlaylistsVariantProps> = ({ data, logic, variantConfig }) => {
  const { isOpen, openPlaylists, closePlaylists } = logic;
  const t = useT();
  const skinProps = useMemo(() => parsePlaylistsSkinProps(variantConfig), [variantConfig]);

  return (
    <>
      <button
        className={`magnet-control-button playlists-button ${skinProps.showLabel ? 'playlists-button-labeled' : ''} ${
          isOpen && skinProps.showActiveIndicator ? 'playlists-button-active' : ''
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openPlaylists();
        }}
        title={t('magnet.renderers.btn-playlists.preview')}
      >
        <PlaylistsIcon />
        {skinProps.showLabel ? <span className="playlists-button-label">{t('magnet.renderers.btn-playlists.preview')}</span> : null}
        {skinProps.showCountBadge && data.playlistCount > 0 ? (
          <span className="playlists-button-count" aria-hidden="true">
            {data.playlistCount}
          </span>
        ) : null}
        {isOpen && skinProps.showActiveIndicator ? <span className="playlists-button-indicator" aria-hidden="true" /> : null}
      </button>
      {isOpen ? <Playlists isOpen={isOpen} onClose={closePlaylists} /> : null}
    </>
  );
};
