import type { Playlist } from '../../../services/audio';

type Translator = (key: string, params?: Record<string, string | number>) => string;

type BilibiliPlaylistsDrawerProps = {
  open: boolean;
  selectedPlaylist: Playlist | null;
  selectedPlaylistId: string | null;
  playlists: Playlist[];
  newPlaylistName: string;
  playlistError: string | null;
  t: Translator;
  formatDuration: (seconds: number | undefined) => string;
  onClose: () => void;
  onNewPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  onSelectPlaylist: (playlistId: string | null) => void;
  onPlaySelected: () => void;
  onDeleteSelected: () => void;
  onRemoveTrack: (trackIndex: number) => void;
};

export function BilibiliPlaylistsDrawer(props: BilibiliPlaylistsDrawerProps) {
  const {
    open,
    selectedPlaylist,
    selectedPlaylistId,
    playlists,
    newPlaylistName,
    playlistError,
    t,
    formatDuration,
    onClose,
    onNewPlaylistNameChange,
    onCreatePlaylist,
    onSelectPlaylist,
    onPlaySelected,
    onDeleteSelected,
    onRemoveTrack,
  } = props;

  return (
    <section
      className={`platform-magnet-panel platform-magnet-bilibili-playlists ${
        open ? 'platform-magnet-bilibili-drawer-open' : ''
      }`}
    >
      <div className="platform-magnet-panel-header">
        <h4>{t('magnet.platform.bilibili.playlist.title')}</h4>
        <div className="platform-magnet-bilibili-panel-actions">
          <span className="platform-magnet-panel-tag">
            {t('magnet.platform.bilibili.playlist.trackCount', {
              count: selectedPlaylist?.tracks.length ?? 0,
            })}
          </span>
          <button type="button" className="platform-magnet-mini-btn" onClick={onClose}>
            {t('common.action.done')}
          </button>
        </div>
      </div>

      <div className="platform-magnet-bilibili-playlist-create">
        <input
          value={newPlaylistName}
          placeholder={t('magnet.platform.bilibili.playlist.createPlaceholder')}
          onChange={(event) => onNewPlaylistNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            onCreatePlaylist();
          }}
        />
        <button type="button" className="platform-magnet-mini-btn" onClick={onCreatePlaylist}>
          {t('magnet.platform.bilibili.playlist.createAction')}
        </button>
      </div>

      <div className="platform-magnet-bilibili-playlist-actions">
        <select
          value={selectedPlaylistId ?? ''}
          onChange={(event) => onSelectPlaylist(event.target.value || null)}
        >
          {playlists.length === 0 ? (
            <option value="">{t('magnet.platform.bilibili.playlist.empty')}</option>
          ) : null}
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
            </option>
          ))}
        </select>

        <div className="platform-magnet-bilibili-playlist-action-btns">
          <button
            type="button"
            className="platform-magnet-mini-btn"
            disabled={!selectedPlaylistId}
            onClick={onPlaySelected}
          >
            {t('magnet.platform.bilibili.playlist.playAction')}
          </button>
          <button
            type="button"
            className="platform-magnet-mini-btn"
            disabled={!selectedPlaylistId}
            onClick={onDeleteSelected}
          >
            {t('magnet.platform.bilibili.playlist.deleteAction')}
          </button>
        </div>
      </div>

      {playlistError ? <p className="platform-magnet-error">{playlistError}</p> : null}

      {!selectedPlaylist ? (
        <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.playlist.selectHint')}</p>
      ) : selectedPlaylist.tracks.length === 0 ? (
        <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.playlist.empty')}</p>
      ) : (
        <div className="platform-magnet-bilibili-playlist-track-list">
          {selectedPlaylist.tracks.map((track, trackIndex) => (
            <div className="platform-magnet-bilibili-playlist-track-item" key={`${track.id}:${trackIndex}`}>
              <div>
                <p className="platform-magnet-bilibili-playlist-track-title">{track.title}</p>
                <p className="platform-magnet-bilibili-playlist-track-meta">
                  {track.artist || t('common.unknown.artist')} | {formatDuration(track.duration)}
                </p>
              </div>
              <button
                type="button"
                className="platform-magnet-mini-btn"
                onClick={() => onRemoveTrack(trackIndex)}
              >
                {t('magnet.platform.bilibili.playlist.removeTrack')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

