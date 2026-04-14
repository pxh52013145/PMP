import type { Playlist } from '../../../services/audio';
import type {
  NeteaseRecommendedPlaylistItem,
  NeteaseSongItem,
  NeteaseSongPage,
  NeteaseUserPlaylistItem,
} from '../../../modules/music-platform';
import { Disc3 } from 'lucide-react';
import { PmpButton, PmpDrawer } from '../../primitives';
import { PlatformResourceCard } from './PlatformResourceCard';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type NeteaseWorkspaceProps = {
  neteaseAuthorized: boolean;
  collectionDrawerOpen: boolean;
  playlistDrawerOpen: boolean;
  collectionLoading: boolean;
  collectionError: string | null;
  userPlaylists: NeteaseUserPlaylistItem[];
  recommendedPlaylists: NeteaseRecommendedPlaylistItem[];
  selectedUserPlaylistId: string | null;
  selectedUserPlaylist: NeteaseUserPlaylistItem | null;
  searchQuery: string;
  resourceLoading: boolean;
  resourceError: string | null;
  resourceInfo: string | null;
  resourcePage: NeteaseSongPage | null;
  preparingSongId: string | null;
  selectedPlatformPlaylist: Playlist | null;
  selectedPlatformPlaylistId: string | null;
  platformPlaylists: Playlist[];
  newPlatformPlaylistName: string;
  playlistError: string | null;
  t: Translator;
  formatDuration: (seconds: number | undefined) => string;
  onRefreshCollections: () => void;
  onShowRecommended: () => void;
  onSelectUserPlaylist: (playlistId: string) => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onRefreshResources: () => void;
  onLoadMoreResources: () => void;
  onPlaySong: (item: NeteaseSongItem) => void;
  onQueueSong: (item: NeteaseSongItem) => void;
  onAddSongToPlaylist: (item: NeteaseSongItem) => void;
  onOpenSong: (item: NeteaseSongItem) => void;
  onCloseDrawers: () => void;
  onToggleCollectionDrawer: () => void;
  onTogglePlaylistDrawer: () => void;
  onNewPlatformPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  onSelectPlatformPlaylist: (playlistId: string | null) => void;
  onPlaySelectedPlaylist: () => void;
  onDeleteSelectedPlaylist: () => void;
  onRemoveTrackFromSelectedPlaylist: (trackIndex: number) => void;
};

export function NeteaseWorkspace(props: NeteaseWorkspaceProps) {
  const {
    neteaseAuthorized,
    collectionDrawerOpen,
    playlistDrawerOpen,
    collectionLoading,
    collectionError,
    userPlaylists,
    recommendedPlaylists,
    selectedUserPlaylistId,
    selectedUserPlaylist,
    searchQuery,
    resourceLoading,
    resourceError,
    resourceInfo,
    resourcePage,
    preparingSongId,
    selectedPlatformPlaylist,
    selectedPlatformPlaylistId,
    platformPlaylists,
    newPlatformPlaylistName,
    playlistError,
    t,
    formatDuration,
    onRefreshCollections,
    onShowRecommended,
    onSelectUserPlaylist,
    onSearchQueryChange,
    onSearchSubmit,
    onRefreshResources,
    onLoadMoreResources,
    onPlaySong,
    onCloseDrawers,
    onToggleCollectionDrawer,
    onTogglePlaylistDrawer,
    onNewPlatformPlaylistNameChange,
    onCreatePlaylist,
    onSelectPlatformPlaylist,
    onPlaySelectedPlaylist,
    onDeleteSelectedPlaylist,
    onRemoveTrackFromSelectedPlaylist,
  } = props;

  const showRecommendedChips = resourcePage?.sourceKind === 'recommended' && recommendedPlaylists.length > 0;
  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <div className="platform-magnet-bilibili">
      <div className="platform-magnet-bilibili-scroll">
        {!neteaseAuthorized ? (
          <p className="platform-magnet-note">{t('magnet.platform.netease.status.waiting')}</p>
        ) : null}

        <div className="platform-magnet-bilibili-layout platform-magnet-bilibili-layout--drawers">
          <PmpDrawer
            as="section"
            open={collectionDrawerOpen}
            className={`platform-magnet-panel platform-magnet-bilibili-folders ${
              collectionDrawerOpen ? 'platform-magnet-bilibili-drawer-open' : ''
            }`}
            surfaceId="overlay.drawer"
          >
            <div className="platform-magnet-panel-header">
              <h4>{t('magnet.platform.netease.collection.title')}</h4>
              <div className="platform-magnet-bilibili-panel-actions">
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="default"
                  disabled={!neteaseAuthorized || collectionLoading}
                  onClick={onRefreshCollections}
                >
                  {collectionLoading
                    ? t('magnet.platform.netease.collection.actionRefreshing')
                    : t('magnet.platform.netease.collection.actionRefresh')}
                </PmpButton>
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="ghost"
                  onClick={onCloseDrawers}
                >
                  {t('common.action.done')}
                </PmpButton>
              </div>
            </div>

            {collectionError ? <p className="platform-magnet-error">{collectionError}</p> : null}

            {!neteaseAuthorized ? (
              <p className="platform-magnet-panel-empty">
                {t('magnet.platform.netease.collection.waiting')}
              </p>
            ) : (
              <div className="platform-magnet-bilibili-folder-list">
                <PmpButton
                  type="button"
                  className={`platform-magnet-bilibili-folder-item ${
                    selectedUserPlaylistId === null ? 'platform-magnet-bilibili-folder-item--active' : ''
                  }`}
                  variant="ghost"
                  onClick={onShowRecommended}
                >
                  <span className="platform-magnet-bilibili-folder-title">
                    {t('magnet.platform.netease.collection.recommendedEntry')}
                  </span>
                  <span className="platform-magnet-bilibili-folder-count platform-magnet-bilibili-folder-count--placeholder">
                    {t('magnet.platform.netease.collection.recommendedSub')}
                  </span>
                </PmpButton>

                {userPlaylists.length === 0 ? (
                  <p className="platform-magnet-panel-empty">
                    {t('magnet.platform.netease.collection.empty')}
                  </p>
                ) : null}

                {userPlaylists.map((playlist) => (
                  <PmpButton
                    key={playlist.playlistId}
                    type="button"
                    className={`platform-magnet-bilibili-folder-item ${
                      playlist.playlistId === selectedUserPlaylistId
                        ? 'platform-magnet-bilibili-folder-item--active'
                        : ''
                    }`}
                    variant="ghost"
                    onClick={() => onSelectUserPlaylist(playlist.playlistId)}
                  >
                    <span className="platform-magnet-bilibili-folder-title">{playlist.title}</span>
                    <span className="platform-magnet-bilibili-folder-count">
                      {t('magnet.platform.netease.collection.count', {
                        count: playlist.trackCount,
                      })}
                    </span>
                  </PmpButton>
                ))}
              </div>
            )}
          </PmpDrawer>

          <section className="platform-magnet-panel platform-magnet-bilibili-resources platform-magnet-bilibili-resources--main">
            <div className="platform-magnet-bilibili-resource-toolbar">
              <input
                value={searchQuery}
                placeholder={t('magnet.platform.netease.resource.searchPlaceholder')}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  onSearchSubmit();
                }}
              />
              <PmpButton
                type="button"
                className="platform-magnet-mini-btn"
                variant="default"
                disabled={!neteaseAuthorized || resourceLoading}
                onClick={onRefreshResources}
              >
                {resourceLoading
                  ? hasSearchQuery
                    ? t('magnet.platform.netease.resource.actionSearching')
                    : t('magnet.platform.netease.resource.actionRefreshing')
                  : hasSearchQuery
                    ? t('magnet.platform.netease.resource.actionSearch')
                    : t('magnet.platform.netease.resource.actionRefresh')}
              </PmpButton>
            </div>

            <div className="platform-magnet-bilibili-resource-meta-row">
              <p className="platform-magnet-panel-summary">
                {resourcePage?.sourceKind === 'search'
                  ? t('magnet.platform.netease.resource.searchSummary', {
                      keyword: resourcePage.sourceId,
                    })
                  : resourcePage?.sourceKind === 'user-playlist'
                    ? t('magnet.platform.netease.resource.playlistSummary', {
                        playlist:
                          selectedUserPlaylist?.title ||
                          t('magnet.platform.netease.collection.unknownPlaylist'),
                      })
                    : t('magnet.platform.netease.resource.recommendedSummary')}
              </p>
              {resourcePage ? (
                <span className="platform-magnet-panel-tag">
                  {t('magnet.platform.netease.resource.total', { count: resourcePage.total })}
                </span>
              ) : null}
            </div>

            {showRecommendedChips ? (
              <div className="platform-magnet-bilibili-resource-meta-row">
                <p className="platform-magnet-panel-summary">
                  {t('magnet.platform.netease.resource.recommendedPlaylists')}
                </p>
                <span className="platform-magnet-panel-tag">
                  {t('magnet.platform.netease.collection.count', {
                    count: recommendedPlaylists.length,
                  })}
                </span>
              </div>
            ) : null}

            {showRecommendedChips ? (
              <div className="platform-magnet-result-list">
                {recommendedPlaylists.slice(0, 6).map((playlist) => (
                  <div className="platform-magnet-result-item" key={playlist.playlistId}>
                    <p className="platform-magnet-result-main">{playlist.title}</p>
                    <p className="platform-magnet-result-sub">
                      {t('magnet.platform.netease.collection.count', {
                        count: playlist.trackCount,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
            {resourceError ? <p className="platform-magnet-error">{resourceError}</p> : null}

            {resourceLoading ? (
              <p className="platform-magnet-panel-empty">
                {t('magnet.platform.netease.resource.loading')}
              </p>
            ) : !resourcePage || resourcePage.items.length === 0 ? (
              <p className="platform-magnet-panel-empty">
                {t('magnet.platform.netease.resource.empty')}
              </p>
            ) : (
              <div className="platform-magnet-bilibili-resource-grid">
                {resourcePage.items.map((item) => {
                  const preparing = preparingSongId === item.songId;
                  return (
                    <PlatformResourceCard
                      key={item.songId}
                      accentColor="#ff6b87"
                      coverUrl={item.coverUrl}
                      coverAlt={item.title}
                      coverFallbackLabel="N"
                      title={item.title}
                      subtitle={item.artistNames}
                      detail={item.albumName ?? null}
                      durationLabel={formatDuration(item.durationSeconds)}
                      badges={
                        [
                          {
                            id: `${item.songId}:platform`,
                            label: 'Netease',
                            tone: 'default' as const,
                            compact: true,
                            icon: <Disc3 className="h-3.5 w-3.5" />,
                          },
                        ]
                      }
                      preparing={preparing}
                      titleHint={t('magnet.platform.netease.resource.actionPlay')}
                      onClick={() => {
                        if (preparing) return;
                        onPlaySong(item);
                      }}
                    />
                  );
                })}
              </div>
            )}

            {resourcePage?.hasMore ? (
              <div className="platform-magnet-bilibili-resource-load-more-actions">
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="default"
                  disabled={resourceLoading}
                  onClick={onLoadMoreResources}
                >
                  {t('magnet.platform.netease.resource.actionLoadMore')}
                </PmpButton>
              </div>
            ) : null}
          </section>

          <PmpDrawer
            as="section"
            open={playlistDrawerOpen}
            className={`platform-magnet-panel platform-magnet-bilibili-playlists ${
              playlistDrawerOpen ? 'platform-magnet-bilibili-drawer-open' : ''
            }`}
            surfaceId="overlay.drawer"
          >
            <div className="platform-magnet-panel-header">
              <h4>{t('magnet.platform.netease.playlist.title')}</h4>
              <div className="platform-magnet-bilibili-panel-actions">
                <span className="platform-magnet-panel-tag">
                  {t('magnet.platform.netease.playlist.trackCount', {
                    count: selectedPlatformPlaylist?.tracks.length ?? 0,
                  })}
                </span>
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="ghost"
                  onClick={onCloseDrawers}
                >
                  {t('common.action.done')}
                </PmpButton>
              </div>
            </div>

            <div className="platform-magnet-bilibili-playlist-create">
              <input
                value={newPlatformPlaylistName}
                placeholder={t('magnet.platform.netease.playlist.createPlaceholder')}
                onChange={(event) => onNewPlatformPlaylistNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  onCreatePlaylist();
                }}
              />
              <PmpButton
                type="button"
                className="platform-magnet-mini-btn"
                variant="primary"
                onClick={onCreatePlaylist}
              >
                {t('magnet.platform.netease.playlist.createAction')}
              </PmpButton>
            </div>

            <div className="platform-magnet-bilibili-playlist-actions">
              <select
                value={selectedPlatformPlaylistId ?? ''}
                onChange={(event) => onSelectPlatformPlaylist(event.target.value || null)}
              >
                {platformPlaylists.length === 0 ? (
                  <option value="">{t('magnet.platform.netease.playlist.empty')}</option>
                ) : null}
                {platformPlaylists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}
                  </option>
                ))}
              </select>

              <div className="platform-magnet-bilibili-playlist-action-btns">
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="default"
                  disabled={!selectedPlatformPlaylistId}
                  onClick={onPlaySelectedPlaylist}
                >
                  {t('magnet.platform.netease.playlist.playAction')}
                </PmpButton>
                <PmpButton
                  type="button"
                  className="platform-magnet-mini-btn"
                  variant="danger"
                  disabled={!selectedPlatformPlaylistId}
                  onClick={onDeleteSelectedPlaylist}
                >
                  {t('magnet.platform.netease.playlist.deleteAction')}
                </PmpButton>
              </div>
            </div>

            {playlistError ? <p className="platform-magnet-error">{playlistError}</p> : null}

            {!selectedPlatformPlaylist ? (
              <p className="platform-magnet-panel-empty">
                {t('magnet.platform.netease.playlist.selectHint')}
              </p>
            ) : selectedPlatformPlaylist.tracks.length === 0 ? (
              <p className="platform-magnet-panel-empty">
                {t('magnet.platform.netease.playlist.empty')}
              </p>
            ) : (
              <div className="platform-magnet-bilibili-playlist-track-list">
                {selectedPlatformPlaylist.tracks.map((track, trackIndex) => (
                  <div className="platform-magnet-bilibili-playlist-track-item" key={`${track.id}:${trackIndex}`}>
                    <div>
                      <p className="platform-magnet-bilibili-playlist-track-title">{track.title}</p>
                      <p className="platform-magnet-bilibili-playlist-track-meta">
                        {track.artist || t('common.unknown.artist')} | {formatDuration(track.duration)}
                      </p>
                    </div>
                    <PmpButton
                      type="button"
                      className="platform-magnet-mini-btn"
                      variant="ghost"
                      onClick={() => onRemoveTrackFromSelectedPlaylist(trackIndex)}
                    >
                      {t('magnet.platform.netease.playlist.removeTrack')}
                    </PmpButton>
                  </div>
                ))}
              </div>
            )}
          </PmpDrawer>
        </div>

        {(collectionDrawerOpen || playlistDrawerOpen) && (
          <button
            type="button"
            className="platform-magnet-drawer-backdrop"
            aria-label={t('common.action.cancel')}
            onClick={onCloseDrawers}
          />
        )}
      </div>

      <div className="platform-magnet-bilibili-bottom-actions">
        <PmpButton
          type="button"
          className="platform-magnet-mini-btn"
          variant="default"
          disabled={!neteaseAuthorized}
          onClick={onToggleCollectionDrawer}
        >
          {collectionDrawerOpen
            ? t('magnet.platform.netease.collection.close')
            : t('magnet.platform.netease.collection.open')}
        </PmpButton>
        <PmpButton
          type="button"
          className="platform-magnet-mini-btn"
          variant="default"
          disabled={!neteaseAuthorized}
          onClick={onTogglePlaylistDrawer}
        >
          {playlistDrawerOpen
            ? t('magnet.platform.netease.playlist.close')
            : t('magnet.platform.netease.playlist.open')}
        </PmpButton>
      </div>
    </div>
  );
}
