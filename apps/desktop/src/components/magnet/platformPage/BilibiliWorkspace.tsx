import React from 'react';

import type {
  BilibiliFavoriteFolderItem,
  BilibiliFavoriteResourceItem,
  BilibiliFavoriteResourcePage,
  BilibiliLyricLocatorResolved,
  BilibiliPlaybackCacheSettings,
  BilibiliPlaybackQualityOption,
} from '../../../modules/music-platform';
import type { Playlist } from '../../../services/audio';
import type { ContextMenuItem } from '../ContextMenu';
import { ContextMenu } from '../ContextMenu';
import { BilibiliFoldersDrawer } from './BilibiliFoldersDrawer';
import { BilibiliPlaybackSettingsModal } from './BilibiliPlaybackSettingsModal';
import { BilibiliPlaylistsDrawer } from './BilibiliPlaylistsDrawer';
import { BilibiliResourceGrid } from './BilibiliResourceGrid';
import type { BilibiliQualityBadge } from './useBilibiliResourceEnhancer';

type Translator = (key: string, params?: Record<string, string | number>) => string;

type BilibiliWorkspaceProps = {
  bilibiliAuthorized: boolean;
  folderDrawerOpen: boolean;
  playlistDrawerOpen: boolean;
  folderLoading: boolean;
  folderError: string | null;
  bilibiliFolders: BilibiliFavoriteFolderItem[];
  selectedFolderId: string | null;
  resourceFilterQuery: string;
  resourceLoading: boolean;
  resourceLoadingMore: boolean;
  selectedBilibiliFolder: BilibiliFavoriteFolderItem | null;
  resourcePage: BilibiliFavoriteResourcePage | null;
  resourceInfo: string | null;
  resourceError: string | null;
  bvidSearchError: string | null;
  bvidSearchResult: BilibiliFavoriteResourceItem | null;
  filteredBilibiliResources: BilibiliFavoriteResourceItem[];
  preparingResourceId: string | null;
  normalizedPlaybackQualityHint: string;
  normalizedBilibiliThemePreference: string;
  resourceCoverUrlMap: Record<string, string>;
  resourceQualityTagMap: Record<string, BilibiliQualityBadge[]>;
  resourceGridRef: React.RefObject<HTMLDivElement>;
  resourceLoadMoreSentinelRef: React.RefObject<HTMLDivElement>;
  selectedPlaylist: Playlist | null;
  selectedPlaylistId: string | null;
  playlists: Playlist[];
  newPlaylistName: string;
  playlistError: string | null;
  resolvedLyric: BilibiliLyricLocatorResolved | null;
  lyricError: string | null;
  playbackSettingsOpen: boolean;
  playbackQualityOptions: BilibiliPlaybackQualityOption[];
  playbackQualityLoading: boolean;
  qualityProbeSourceLocator: string | null;
  availablePlaybackQualityLabel: string;
  playbackCacheSettingsLoading: boolean;
  playbackCacheSettingsSaving: boolean;
  playbackCacheSettingsInfo: string | null;
  playbackCacheSettingsError: string | null;
  playbackCacheSettings: BilibiliPlaybackCacheSettings | null;
  playbackCachePathDraft: string;
  resourceContextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  t: Translator;
  formatDuration: (seconds: number | undefined) => string;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
  getKindLabel: (kind: string) => string;
  getQualityBadgeLabel: (badge: BilibiliQualityBadge) => string;
  qualityLabelForKey: (qualityKey: string) => string;
  onRefreshFolders: () => void;
  onCloseFolderDrawer: () => void;
  onShowRecommended: () => void;
  onSelectFolder: (folderId: string) => void;
  onResourceFilterQueryChange: (query: string) => void;
  onResourceSearchSubmit: () => void;
  onRefreshResources: () => void;
  onOpenResourceContextMenu: (item: BilibiliFavoriteResourceItem, event: React.MouseEvent) => void;
  onLoadMoreResources: () => void;
  onClosePlaylistDrawer: () => void;
  onNewPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  onSelectPlaylist: (playlistId: string | null) => void;
  onPlaySelectedPlaylist: () => void;
  onDeleteSelectedPlaylist: () => void;
  onRemoveTrackFromSelectedPlaylist: (trackIndex: number) => void;
  onCloseDrawers: () => void;
  onToggleFolderDrawer: () => void;
  onTogglePlaylistDrawer: () => void;
  onClosePlaybackSettings: () => void;
  onQualityHintChange: (qualityKey: string) => void;
  onBilibiliThemePreferenceChange: (themePreference: string) => void;
  onRefreshQualityOptions: () => void;
  onPlaybackCachePathDraftChange: (path: string) => void;
  onBrowsePlaybackCachePath: () => void;
  onSavePlaybackCachePath: () => void;
  onResetPlaybackCachePath: () => void;
  onCloseResourceContextMenu: () => void;
};

export function BilibiliWorkspace(props: BilibiliWorkspaceProps) {
  const {
    bilibiliAuthorized,
    folderDrawerOpen,
    playlistDrawerOpen,
    folderLoading,
    folderError,
    bilibiliFolders,
    selectedFolderId,
    resourceFilterQuery,
    resourceLoading,
    resourceLoadingMore,
    selectedBilibiliFolder,
    resourcePage,
    resourceInfo,
    resourceError,
    bvidSearchError,
    bvidSearchResult,
    filteredBilibiliResources,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    normalizedBilibiliThemePreference,
    resourceCoverUrlMap,
    resourceQualityTagMap,
    resourceGridRef,
    resourceLoadMoreSentinelRef,
    selectedPlaylist,
    selectedPlaylistId,
    playlists,
    newPlaylistName,
    playlistError,
    resolvedLyric,
    lyricError,
    playbackSettingsOpen,
    playbackQualityOptions,
    playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel,
    playbackCacheSettingsLoading,
    playbackCacheSettingsSaving,
    playbackCacheSettingsInfo,
    playbackCacheSettingsError,
    playbackCacheSettings,
    playbackCachePathDraft,
    resourceContextMenu,
    t,
    formatDuration,
    getResourceCacheKey,
    getKindLabel,
    getQualityBadgeLabel,
    qualityLabelForKey,
    onRefreshFolders,
    onCloseFolderDrawer,
    onShowRecommended,
    onSelectFolder,
    onResourceFilterQueryChange,
    onResourceSearchSubmit,
    onRefreshResources,
    onOpenResourceContextMenu,
    onLoadMoreResources,
    onClosePlaylistDrawer,
    onNewPlaylistNameChange,
    onCreatePlaylist,
    onSelectPlaylist,
    onPlaySelectedPlaylist,
    onDeleteSelectedPlaylist,
    onRemoveTrackFromSelectedPlaylist,
    onCloseDrawers,
    onToggleFolderDrawer,
    onTogglePlaylistDrawer,
    onClosePlaybackSettings,
    onQualityHintChange,
    onBilibiliThemePreferenceChange,
    onRefreshQualityOptions,
    onPlaybackCachePathDraftChange,
    onBrowsePlaybackCachePath,
    onSavePlaybackCachePath,
    onResetPlaybackCachePath,
    onCloseResourceContextMenu,
  } = props;

  return (
    <div className="platform-magnet-bilibili">
      <div className="platform-magnet-bilibili-scroll">
        {!bilibiliAuthorized ? (
          <p className="platform-magnet-note">{t('magnet.platform.bilibili.status.waiting')}</p>
        ) : null}

        <div className="platform-magnet-bilibili-layout platform-magnet-bilibili-layout--drawers">
          <BilibiliFoldersDrawer
            open={folderDrawerOpen}
            bilibiliAuthorized={bilibiliAuthorized}
            folderLoading={folderLoading}
            folderError={folderError}
            folders={bilibiliFolders}
            selectedFolderId={selectedFolderId}
            onRefresh={onRefreshFolders}
            onClose={onCloseFolderDrawer}
            onShowRecommended={onShowRecommended}
            onSelectFolder={onSelectFolder}
            t={t}
          />

          <section className="platform-magnet-panel platform-magnet-bilibili-resources platform-magnet-bilibili-resources--main">
            <div className="platform-magnet-bilibili-resource-toolbar">
              <input
                value={resourceFilterQuery}
                placeholder={
                  selectedFolderId
                    ? t('magnet.platform.bilibili.resource.searchPlaceholder')
                    : t('magnet.platform.bilibili.resource.searchPlaceholderHomepage')
                }
                onChange={(event) => onResourceFilterQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  onResourceSearchSubmit();
                }}
              />
              <button
                type="button"
                className="platform-magnet-mini-btn"
                disabled={!bilibiliAuthorized || resourceLoading || resourceLoadingMore}
                onClick={onRefreshResources}
              >
                {resourceLoading
                  ? t('magnet.platform.bilibili.resource.actionRefreshing')
                  : t('magnet.platform.bilibili.resource.actionRefresh')}
              </button>
            </div>

            {selectedBilibiliFolder || resourcePage ? (
              <div className="platform-magnet-bilibili-resource-meta-row">
                {selectedBilibiliFolder ? (
                  <p className="platform-magnet-panel-summary">
                    {t('magnet.platform.bilibili.drawer.currentFolderName', {
                      folder: selectedBilibiliFolder.title,
                    })}
                  </p>
                ) : resourcePage ? (
                  <p className="platform-magnet-panel-summary">
                    {t('magnet.platform.bilibili.resource.recommended')}
                  </p>
                ) : (
                  <span />
                )}

                {resourcePage ? (
                  <span className="platform-magnet-panel-tag">
                    {t('magnet.platform.bilibili.resource.total', { count: resourcePage.total })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
            {resourceError ? <p className="platform-magnet-error">{resourceError}</p> : null}
            {bvidSearchError ? <p className="platform-magnet-error">{bvidSearchError}</p> : null}

            {resourceLoading ? (
              <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.resource.loading')}</p>
            ) : filteredBilibiliResources.length === 0 ? (
              <p className="platform-magnet-panel-empty">
                {resourceFilterQuery.trim().length > 0
                  ? t('magnet.platform.bilibili.resource.emptyFiltered')
                  : selectedFolderId
                    ? t('magnet.platform.bilibili.resource.empty')
                    : t('magnet.platform.bilibili.resource.recommendedEmpty')}
              </p>
            ) : (
              <BilibiliResourceGrid
                items={filteredBilibiliResources}
                resourcePageHasMore={Boolean(resourcePage?.hasMore)}
                resourcePageAvailable={Boolean(resourcePage)}
                resourceLoadingMore={resourceLoadingMore}
                preparingResourceId={preparingResourceId}
                normalizedPlaybackQualityHint={normalizedPlaybackQualityHint}
                resourceCoverUrlMap={resourceCoverUrlMap}
                resourceQualityTagMap={resourceQualityTagMap}
                bvidSearchResultResourceId={bvidSearchResult?.resourceId ?? null}
                resourceGridRef={resourceGridRef}
                resourceLoadMoreSentinelRef={resourceLoadMoreSentinelRef}
                t={t}
                getResourceCacheKey={getResourceCacheKey}
                getKindLabel={getKindLabel}
                getQualityBadgeLabel={getQualityBadgeLabel}
                formatDuration={formatDuration}
                onContextMenu={onOpenResourceContextMenu}
              />
            )}

            {resourcePage?.hasMore && !resourceLoading ? (
              <div className="platform-magnet-bilibili-resource-load-more-actions">
                <button
                  type="button"
                  className="platform-magnet-mini-btn"
                  disabled={resourceLoadingMore || !selectedFolderId}
                  onClick={onLoadMoreResources}
                >
                  {resourceLoadingMore
                    ? t('magnet.platform.bilibili.resource.actionLoadingMore')
                    : t('magnet.platform.bilibili.resource.actionLoadMore')}
                </button>
              </div>
            ) : null}

            {resolvedLyric ? (
              <div className="platform-magnet-bilibili-lyric-card">
                <p>
                  {t('magnet.platform.bilibili.lyric.resolved', {
                    format: resolvedLyric.format,
                    source: resolvedLyric.sourceKind,
                  })}
                </p>
                <p className="platform-magnet-bilibili-lyric-locator">{resolvedLyric.locator}</p>
              </div>
            ) : null}

            {lyricError ? <p className="platform-magnet-error">{lyricError}</p> : null}
          </section>

          <BilibiliPlaylistsDrawer
            open={playlistDrawerOpen}
            selectedPlaylist={selectedPlaylist}
            selectedPlaylistId={selectedPlaylistId}
            playlists={playlists}
            newPlaylistName={newPlaylistName}
            playlistError={playlistError}
            t={t}
            formatDuration={formatDuration}
            onClose={onClosePlaylistDrawer}
            onNewPlaylistNameChange={onNewPlaylistNameChange}
            onCreatePlaylist={onCreatePlaylist}
            onSelectPlaylist={onSelectPlaylist}
            onPlaySelected={onPlaySelectedPlaylist}
            onDeleteSelected={onDeleteSelectedPlaylist}
            onRemoveTrack={onRemoveTrackFromSelectedPlaylist}
          />
        </div>

        {(folderDrawerOpen || playlistDrawerOpen) && (
          <button
            type="button"
            className="platform-magnet-drawer-backdrop"
            aria-label={t('common.action.cancel')}
            onClick={onCloseDrawers}
          />
        )}
      </div>

      <div className="platform-magnet-bilibili-bottom-actions">
        <button
          type="button"
          className="platform-magnet-mini-btn"
          disabled={!bilibiliAuthorized}
          onClick={onToggleFolderDrawer}
        >
          {folderDrawerOpen
            ? t('magnet.platform.bilibili.drawer.folders.close')
            : t('magnet.platform.bilibili.drawer.folders.open')}
        </button>
        <button
          type="button"
          className="platform-magnet-mini-btn"
          disabled={!bilibiliAuthorized}
          onClick={onTogglePlaylistDrawer}
        >
          {playlistDrawerOpen
            ? t('magnet.platform.bilibili.drawer.playlists.close')
            : t('magnet.platform.bilibili.drawer.playlists.open')}
        </button>
      </div>

      <BilibiliPlaybackSettingsModal
        open={playbackSettingsOpen}
        t={t}
        bilibiliAuthorized={bilibiliAuthorized}
        normalizedPlaybackQualityHint={normalizedPlaybackQualityHint}
        normalizedBilibiliThemePreference={normalizedBilibiliThemePreference}
        playbackQualityOptions={playbackQualityOptions}
        playbackQualityLoading={playbackQualityLoading}
        qualityProbeSourceLocator={qualityProbeSourceLocator}
        availablePlaybackQualityLabel={availablePlaybackQualityLabel}
        qualityLabelForKey={qualityLabelForKey}
        onClose={onClosePlaybackSettings}
        onQualityHintChange={onQualityHintChange}
        onBilibiliThemePreferenceChange={onBilibiliThemePreferenceChange}
        onRefreshQualityOptions={onRefreshQualityOptions}
        playbackCacheSettingsLoading={playbackCacheSettingsLoading}
        playbackCacheSettingsSaving={playbackCacheSettingsSaving}
        playbackCacheSettingsInfo={playbackCacheSettingsInfo}
        playbackCacheSettingsError={playbackCacheSettingsError}
        playbackCacheSettings={playbackCacheSettings}
        playbackCachePathDraft={playbackCachePathDraft}
        onPlaybackCachePathDraftChange={onPlaybackCachePathDraftChange}
        onBrowsePlaybackCachePath={onBrowsePlaybackCachePath}
        onSavePlaybackCachePath={onSavePlaybackCachePath}
        onResetPlaybackCachePath={onResetPlaybackCachePath}
      />

      {resourceContextMenu ? (
        <ContextMenu
          x={resourceContextMenu.x}
          y={resourceContextMenu.y}
          items={resourceContextMenu.items}
          onClose={onCloseResourceContextMenu}
        />
      ) : null}
    </div>
  );
}

