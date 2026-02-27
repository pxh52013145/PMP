import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useT } from '../../../i18n';
import type { AudioState, Track } from '../../../services/audio';
import {
  listBilibiliPlaybackQualities,
  listPlatformConnectorFacadeItems,
  searchPlatformTracks,
  subscribePlatformConnectorAuthChanged,
  type BilibiliFavoriteResourceItem,
  type BilibiliPreparedPlayback,
  type BilibiliPlaybackQualityOption,
  type PlatformConnectorFacadeItem,
} from '../../../modules/music-platform';
import { usePersistentSetting } from '../../../modules/storage';
import { BilibiliWorkspace } from './BilibiliWorkspace';
import { useBilibiliPlaybackCacheSettings } from './useBilibiliPlaybackCacheSettings';
import { useBilibiliResourceContextMenu } from './useBilibiliResourceContextMenu';
import { useBilibiliResourceBrowser } from './useBilibiliResourceBrowser';
import {
  useBilibiliResourceEnhancer,
  type BilibiliQualityBadge,
} from './useBilibiliResourceEnhancer';
import { useBilibiliResourcePlaybackActions } from './useBilibiliResourcePlaybackActions';
import './PlatformMagnet.css';

const DEFAULT_SEARCH_LIMIT = 30;
const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili' as const;
const BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY =
  'music-platform.bilibili.playback-quality-preference';

type PlatformMode = 'bilibili' | 'generic';
type PlatformTrackSearchItem = Awaited<ReturnType<typeof searchPlatformTracks>>['tracks'][number];
type BilibiliPlaybackQualityKey = 'auto' | '64k' | '132k' | '192k' | 'dolby' | 'hires';

const BILIBILI_QUALITY_OPTION_ORDER: BilibiliPlaybackQualityKey[] = [
  'auto',
  '64k',
  '132k',
  '192k',
  'dolby',
  'hires',
];

const DEFAULT_BILIBILI_QUALITY_OPTIONS: BilibiliPlaybackQualityOption[] =
  BILIBILI_QUALITY_OPTION_ORDER.map((key) => ({
    key,
    label: key,
    available: key === 'auto',
  }));

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || fallback;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || fallback;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

function toBilibiliKindLabelKey(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  switch (normalized) {
    case 'video':
      return 'magnet.platform.bilibili.kind.video';
    case 'audio':
      return 'magnet.platform.bilibili.kind.audio';
    default:
      return 'magnet.platform.bilibili.kind.unknown';
  }
}

function toBilibiliQualityLabelKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  switch (normalized) {
    case 'auto':
      return 'magnet.platform.bilibili.quality.option.auto';
    case '64k':
      return 'magnet.platform.bilibili.quality.option.64k';
    case '132k':
      return 'magnet.platform.bilibili.quality.option.132k';
    case '192k':
      return 'magnet.platform.bilibili.quality.option.192k';
    case 'dolby':
      return 'magnet.platform.bilibili.quality.option.dolby';
    case 'hires':
      return 'magnet.platform.bilibili.quality.option.hires';
    default:
      return 'magnet.platform.bilibili.quality.option.auto';
  }
}

function normalizeBilibiliQualityHint(value: string): BilibiliPlaybackQualityKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === '64k') return '64k';
  if (normalized === '132k') return '132k';
  if (normalized === '192k') return '192k';
  if (normalized === 'dolby') return 'dolby';
  if (normalized === 'hires') return 'hires';
  return 'auto';
}

function toBilibiliQualityBadgeLabelKey(badge: BilibiliQualityBadge): string {
  switch (badge) {
    case 'hires':
      return 'magnet.platform.bilibili.quality.badge.hires';
    default:
      return 'magnet.platform.bilibili.quality.badge.dolby';
  }
}

function mergePlaybackQualityOptions(
  options: BilibiliPlaybackQualityOption[]
): BilibiliPlaybackQualityOption[] {
  const lookup = new Map(
    options
      .map((item) => ({ ...item, key: item.key.trim().toLowerCase() }))
      .filter((item) => item.key.length > 0)
      .map((item) => [item.key, item] as const)
  );

  return BILIBILI_QUALITY_OPTION_ORDER.map((key) => {
    const matched = lookup.get(key);
    return {
      key,
      label: matched?.label ?? key,
      available: matched?.available ?? (key === 'auto'),
    };
  });
}

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const rest = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function toResourceCacheKey(item: BilibiliFavoriteResourceItem): string {
  return item.resourceId || item.sourceLocator;
}

function isBilibiliVideoSourceLocator(sourceLocator: string): boolean {
  const normalized = sourceLocator.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('bilibili://video/') ||
    normalized.includes('bilibili.com/video/') ||
    normalized.includes('bvid=')
  );
}

function buildTrackFromPreparedPlayback(
  item: BilibiliFavoriteResourceItem,
  prepared: BilibiliPreparedPlayback,
  coverUrl?: string
): Track {
  return {
    id: `bilibili:${item.resourceId}`,
    title: item.title,
    artist: item.ownerName ?? 'Bilibili',
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: prepared.cachePath,
    path: prepared.cachePath,
    originalPath: item.sourceLocator,
    coverUrl: coverUrl ?? item.coverUrl,
    genre: 'Bilibili',
    comment: item.sourceLocator,
  };
}

export const PlatformMagnet: React.FC = () => {
  const t = useT();
  const audioService = useAudioService();

  const [mode, setMode] = useState<PlatformMode>('bilibili');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PlatformConnectorFacadeItem[]>([]);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchScopeConnectorId, setSearchScopeConnectorId] = useState('all');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<PlatformTrackSearchItem[]>([]);

  const [playbackQualityHint, setPlaybackQualityHint] = usePersistentSetting<string>(
    BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY,
    'auto',
    { format: 'string' }
  );
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualityProbeLocator, setPlaybackQualityProbeLocator] = useState<string | null>(null);
  const [playbackQualityOptions, setPlaybackQualityOptions] = useState<BilibiliPlaybackQualityOption[]>(
    DEFAULT_BILIBILI_QUALITY_OPTIONS
  );
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);

  const {
    playbackCacheSettingsLoading,
    playbackCacheSettingsSaving,
    playbackCacheSettingsError,
    playbackCacheSettingsInfo,
    playbackCacheSettings,
    playbackCachePathDraft,
    setPlaybackCachePathDraft,
    refreshPlaybackCacheSettings,
    handleBrowsePlaybackCachePath,
    handleSavePlaybackCachePath,
    handleResetPlaybackCachePath,
  } = useBilibiliPlaybackCacheSettings(t);

  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [playlistDrawerOpen, setPlaylistDrawerOpen] = useState(false);

  const resourceGridRef = useRef<HTMLDivElement>(null);
  const resourceLoadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const [audioState, setAudioState] = useState<AudioState>(() => audioService.getState());
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const refreshConnectors = useCallback(async () => {
    try {
      const snapshots = await listPlatformConnectorFacadeItems();
      setItems(snapshots);
      setLastUpdatedAtMs(Date.now());
      setError(null);
    } catch (err) {
      setError(toErrorMessage(err, t('magnet.platform.error.refreshFailed')));
    }
  }, [t]);

  const bilibiliConnector = useMemo(
    () => items.find((item) => item.connectorId === BILIBILI_CONNECTOR_ID) ?? null,
    [items]
  );

  const bilibiliAuthorized = bilibiliConnector?.authState === 'authorized';

  const {
    folderLoading,
    folderError,
    bilibiliFolders,
    selectedFolderId,
    setSelectedFolderId,
    resourceLoading,
    resourceLoadingMore,
    resourceError,
    setResourceError,
    resourcePage,
    resourceFilterQuery,
    setResourceFilterQuery,
    bvidQuery,
    setBvidQuery,
    bvidSearching,
    bvidSearchError,
    bvidSearchResult,
    bilibiliResources,
    filteredBilibiliResources,
    refreshBilibiliFolders,
    refreshBilibiliRecommendedResources,
    searchBilibiliHomepageResources,
    refreshBilibiliResources,
    loadMoreBilibiliResources,
    handleBvSearch,
  } = useBilibiliResourceBrowser({
    bilibiliAuthorized,
    t,
  });

  const selectedBilibiliFolder = useMemo(
    () => bilibiliFolders.find((item) => item.folderId === selectedFolderId) ?? null,
    [bilibiliFolders, selectedFolderId]
  );

  const searchableConnectors = useMemo(
    () =>
      items.filter(
        (item) => item.authState === 'authorized' && item.capabilities.canSearchTracks && item.sourceIds.length > 0
      ),
    [items]
  );

  const connectorDisplayNameMap = useMemo(
    () => new Map(items.map((item) => [item.connectorId, item.displayName])),
    [items]
  );

  const normalizedPlaybackQualityHint = useMemo(
    () => normalizeBilibiliQualityHint(playbackQualityHint),
    [playbackQualityHint]
  );

  const qualityProbeSourceLocator = useMemo(() => {
    if (!bilibiliAuthorized) return null;
    const bvidLocator = bvidSearchResult?.sourceLocator?.trim();
    if (bvidLocator && isBilibiliVideoSourceLocator(bvidLocator)) {
      return bvidLocator;
    }

    const candidate = filteredBilibiliResources.find((item) =>
      isBilibiliVideoSourceLocator(item.sourceLocator)
    );
    return candidate?.sourceLocator?.trim() || null;
  }, [bilibiliAuthorized, bvidSearchResult?.sourceLocator, filteredBilibiliResources]);

  const availablePlaybackQualityLabel = useMemo(() => {
    const availableKeys = playbackQualityOptions.filter((item) => item.available).map((item) => item.key);
    if (availableKeys.length === 0) return t('magnet.platform.bilibili.quality.none');
    return availableKeys.map((key) => t(toBilibiliQualityLabelKey(key))).join(' / ');
  }, [playbackQualityOptions, t]);

  const preferredPlaybackQualityLabel = useMemo(
    () => t(toBilibiliQualityLabelKey(normalizedPlaybackQualityHint)),
    [normalizedPlaybackQualityHint, t]
  );

  const selectedPlaylist = useMemo(
    () => audioState.playlists.find((item) => item.id === selectedPlaylistId) ?? null,
    [audioState.playlists, selectedPlaylistId]
  );

  const { resourceCoverUrlMap, resourceQualityTagMap } = useBilibiliResourceEnhancer({
    bilibiliAuthorized,
    selectedFolderId,
    bilibiliResources,
    filteredBilibiliResources,
    isVideoSourceLocator: isBilibiliVideoSourceLocator,
    getResourceCacheKey: toResourceCacheKey,
  });

  const {
    resourceInfo,
    preparingResourceId,
    lyricResolvingId,
    resolvedLyric,
    lyricError,
    handleResolveLyric,
    handlePlayResource,
    handleQueueResource,
    handleAddToPlaylist,
    handleOpenBilibiliResource,
  } = useBilibiliResourcePlaybackActions({
    audioService,
    normalizedPlaybackQualityHint,
    preferredQualityLabel: preferredPlaybackQualityLabel,
    selectedPlaylistId,
    t,
    setResourceError,
    setPlaylistError,
    buildTrackFromPreparedPlayback,
  });

  const refreshPlaybackQualityOptions = useCallback(async (sourceLocator: string) => {
    const normalizedSourceLocator = sourceLocator.trim();
    if (!normalizedSourceLocator) return;

    setPlaybackQualityLoading(true);
    try {
      const options = await listBilibiliPlaybackQualities(normalizedSourceLocator);
      setPlaybackQualityOptions(mergePlaybackQualityOptions(options));
      setPlaybackQualityProbeLocator(normalizedSourceLocator);
    } catch {
      setPlaybackQualityOptions(DEFAULT_BILIBILI_QUALITY_OPTIONS);
    } finally {
      setPlaybackQualityLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConnectors();
    const unsubscribe = subscribePlatformConnectorAuthChanged(() => {
      void refreshConnectors();
    });
    return () => unsubscribe();
  }, [refreshConnectors]);

  useEffect(() => {
    if (searchScopeConnectorId === 'all') return;
    if (items.some((item) => item.connectorId === searchScopeConnectorId)) return;
    setSearchScopeConnectorId('all');
  }, [items, searchScopeConnectorId]);

  useEffect(() => {
    if (!playbackSettingsOpen || mode !== 'bilibili') return;
    void refreshPlaybackCacheSettings();
  }, [mode, playbackSettingsOpen, refreshPlaybackCacheSettings]);

  useEffect(() => {
    if (!selectedFolderId || !resourcePage?.hasMore) return;
    const rootElement = resourceGridRef.current;
    const sentinelElement = resourceLoadMoreSentinelRef.current;
    if (!rootElement || !sentinelElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        void loadMoreBilibiliResources(selectedFolderId);
      },
      {
        root: rootElement,
        rootMargin: '220px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(sentinelElement);
    return () => observer.disconnect();
  }, [
    filteredBilibiliResources.length,
    loadMoreBilibiliResources,
    resourceLoadingMore,
    resourcePage?.hasMore,
    selectedFolderId,
  ]);

  useEffect(() => {
    if (!qualityProbeSourceLocator) {
      setPlaybackQualityProbeLocator(null);
      setPlaybackQualityOptions(DEFAULT_BILIBILI_QUALITY_OPTIONS);
      return;
    }
    if (playbackQualityProbeLocator === qualityProbeSourceLocator) return;
    void refreshPlaybackQualityOptions(qualityProbeSourceLocator);
  }, [
    playbackQualityProbeLocator,
    qualityProbeSourceLocator,
    refreshPlaybackQualityOptions,
  ]);

  useEffect(() => {
    setAudioState(audioService.getState());
    const unsubscribe = audioService.onStateChange((nextState) => {
      setAudioState(nextState);
    });
    return unsubscribe;
  }, [audioService]);

  useEffect(() => {
    const playlists = audioState.playlists;
    if (playlists.length === 0) {
      setSelectedPlaylistId(null);
      return;
    }
    if (selectedPlaylistId && playlists.some((item) => item.id === selectedPlaylistId)) {
      return;
    }
    setSelectedPlaylistId(playlists[0]?.id ?? null);
  }, [audioState.playlists, selectedPlaylistId]);

  const handleSearch = useCallback(async () => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    const connectorIds = searchScopeConnectorId === 'all' ? undefined : [searchScopeConnectorId];
    setSearching(true);
    setSearchError(null);

    try {
      const result = await searchPlatformTracks({
        query: normalizedQuery,
        limit: DEFAULT_SEARCH_LIMIT,
        connectorIds,
      });

      if (!result.connectorViews.some((item) => item.authState === 'authorized')) {
        setSearchError(t('magnet.platform.panel.search.error.noAuthorizedConnector'));
        setSearchResults([]);
        return;
      }

      setSearchResults(result.tracks);
    } catch (err) {
      setSearchError(toErrorMessage(err, t('magnet.platform.panel.search.error.default')));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchScopeConnectorId, t]);

  const handleCreatePlaylist = useCallback(() => {
    const normalizedName = newPlaylistName.trim();
    if (!normalizedName) return;
    const playlist = audioService.createPlaylist(normalizedName);
    setSelectedPlaylistId(playlist.id);
    setNewPlaylistName('');
    setPlaylistError(null);
  }, [audioService, newPlaylistName]);

  const {
    resourceContextMenu,
    setResourceContextMenu,
    openResourceContextMenu,
  } = useBilibiliResourceContextMenu({
    t,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    lyricResolvingId,
    onPlay: (item) => {
      void handlePlayResource(item);
    },
    onQueue: (item) => {
      void handleQueueResource(item);
    },
    onAddToPlaylist: (item) => {
      void handleAddToPlaylist(item);
    },
    onOpen: (item) => {
      handleOpenBilibiliResource(item);
    },
    onResolveLyric: (item) => {
      void handleResolveLyric(item);
    },
  });

  useEffect(() => {
    if (mode !== 'bilibili' || !bilibiliAuthorized) {
      setFolderDrawerOpen(false);
      setPlaylistDrawerOpen(false);
      setPlaybackSettingsOpen(false);
      setResourceContextMenu(null);
    }
  }, [bilibiliAuthorized, mode, setResourceContextMenu]);

  const authorizedCount = useMemo(
    () => items.filter((item) => item.authState === 'authorized').length,
    [items]
  );

  return (
    <div className="platform-magnet-root">
      <div className="platform-magnet-header">
        <div className="platform-magnet-header-main">
          <div className="platform-magnet-mode-row">
            <div className="platform-magnet-mode-switcher" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'bilibili'}
                className={mode === 'bilibili' ? 'platform-magnet-mode-btn active' : 'platform-magnet-mode-btn'}
                onClick={() => setMode('bilibili')}
              >
                Bilibili
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'generic'}
                className={mode === 'generic' ? 'platform-magnet-mode-btn active' : 'platform-magnet-mode-btn'}
                onClick={() => setMode('generic')}
              >
                Generic
              </button>
            </div>

            {mode === 'bilibili' ? (
              <div className="platform-magnet-bv-top-search">
                <input
                  value={bvidQuery}
                  placeholder={t('magnet.platform.bilibili.resource.bvSearchPlaceholder')}
                  onChange={(event) => setBvidQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    void handleBvSearch();
                  }}
                />
                <button type="button" className="platform-magnet-mini-btn" onClick={() => void handleBvSearch()}>
                  {bvidSearching
                    ? t('magnet.platform.bilibili.resource.bvSearchSearching')
                    : t('magnet.platform.bilibili.resource.bvSearchAction')}
                </button>
                <button
                  type="button"
                  className="platform-magnet-mini-btn"
                  disabled={!bilibiliAuthorized}
                  onClick={() => setPlaybackSettingsOpen(true)}
                >
                  {t('magnet.platform.bilibili.settings.open')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mode === 'generic' && (
        <div className="platform-magnet-summary-row">
          <p>
            {t('magnet.platform.summary.connectors', {
              total: items.length,
              authorized: authorizedCount,
            })}
          </p>
          {lastUpdatedAtMs ? (
            <p>{t('magnet.platform.summary.updatedAt', { at: new Date(lastUpdatedAtMs).toLocaleString() })}</p>
          ) : null}
        </div>
      )}

      <div className="platform-magnet-content">
        {mode === 'bilibili' ? (
          <BilibiliWorkspace
            bilibiliAuthorized={bilibiliAuthorized}
            folderDrawerOpen={folderDrawerOpen}
            playlistDrawerOpen={playlistDrawerOpen}
            folderLoading={folderLoading}
            folderError={folderError}
            bilibiliFolders={bilibiliFolders}
            selectedFolderId={selectedFolderId}
            resourceFilterQuery={resourceFilterQuery}
            resourceLoading={resourceLoading}
            resourceLoadingMore={resourceLoadingMore}
            selectedBilibiliFolder={selectedBilibiliFolder}
            resourcePage={resourcePage}
            resourceInfo={resourceInfo}
            resourceError={resourceError}
            bvidSearchError={bvidSearchError}
            bvidSearchResult={bvidSearchResult}
            filteredBilibiliResources={filteredBilibiliResources}
            preparingResourceId={preparingResourceId}
            normalizedPlaybackQualityHint={normalizedPlaybackQualityHint}
            resourceCoverUrlMap={resourceCoverUrlMap}
            resourceQualityTagMap={resourceQualityTagMap}
            resourceGridRef={resourceGridRef}
            resourceLoadMoreSentinelRef={resourceLoadMoreSentinelRef}
            selectedPlaylist={selectedPlaylist}
            selectedPlaylistId={selectedPlaylistId}
            playlists={audioState.playlists}
            newPlaylistName={newPlaylistName}
            playlistError={playlistError}
            resolvedLyric={resolvedLyric}
            lyricError={lyricError}
            playbackSettingsOpen={playbackSettingsOpen}
            playbackQualityOptions={playbackQualityOptions}
            playbackQualityLoading={playbackQualityLoading}
            qualityProbeSourceLocator={qualityProbeSourceLocator}
            availablePlaybackQualityLabel={availablePlaybackQualityLabel}
            playbackCacheSettingsLoading={playbackCacheSettingsLoading}
            playbackCacheSettingsSaving={playbackCacheSettingsSaving}
            playbackCacheSettingsInfo={playbackCacheSettingsInfo}
            playbackCacheSettingsError={playbackCacheSettingsError}
            playbackCacheSettings={playbackCacheSettings}
            playbackCachePathDraft={playbackCachePathDraft}
            resourceContextMenu={resourceContextMenu}
            t={t}
            formatDuration={formatDuration}
            getResourceCacheKey={toResourceCacheKey}
            getKindLabel={(kind) => t(toBilibiliKindLabelKey(kind))}
            getQualityBadgeLabel={(badge) => t(toBilibiliQualityBadgeLabelKey(badge))}
            qualityLabelForKey={(qualityKey) =>
              t(toBilibiliQualityLabelKey(normalizeBilibiliQualityHint(qualityKey)))
            }
            onRefreshFolders={() => {
              void refreshBilibiliFolders();
            }}
            onCloseFolderDrawer={() => {
              setFolderDrawerOpen(false);
            }}
            onShowRecommended={() => {
              setSelectedFolderId(null);
              setFolderDrawerOpen(false);
            }}
            onSelectFolder={(folderId) => {
              setSelectedFolderId(folderId);
              setFolderDrawerOpen(false);
            }}
            onResourceFilterQueryChange={setResourceFilterQuery}
            onResourceSearchSubmit={() => {
              if (!selectedFolderId) {
                void searchBilibiliHomepageResources(resourceFilterQuery);
                return;
              }
              void refreshBilibiliResources(selectedFolderId);
            }}
            onRefreshResources={() => {
              if (!selectedFolderId) {
                const keyword = resourceFilterQuery.trim();
                if (keyword) {
                  void searchBilibiliHomepageResources(keyword);
                  return;
                }
                void refreshBilibiliRecommendedResources();
                return;
              }
              void refreshBilibiliResources(selectedFolderId);
            }}
            onOpenResourceContextMenu={openResourceContextMenu}
            onLoadMoreResources={() => {
              if (!selectedFolderId) return;
              void loadMoreBilibiliResources(selectedFolderId);
            }}
            onClosePlaylistDrawer={() => {
              setPlaylistDrawerOpen(false);
            }}
            onNewPlaylistNameChange={setNewPlaylistName}
            onCreatePlaylist={handleCreatePlaylist}
            onSelectPlaylist={setSelectedPlaylistId}
            onPlaySelectedPlaylist={() => {
              if (!selectedPlaylistId) return;
              void audioService.playPlaylist(selectedPlaylistId);
            }}
            onDeleteSelectedPlaylist={() => {
              if (!selectedPlaylistId) return;
              audioService.deletePlaylist(selectedPlaylistId);
            }}
            onRemoveTrackFromSelectedPlaylist={(trackIndex) => {
              if (!selectedPlaylistId) return;
              audioService.removeTrackFromPlaylist(selectedPlaylistId, trackIndex);
            }}
            onCloseDrawers={() => {
              setFolderDrawerOpen(false);
              setPlaylistDrawerOpen(false);
            }}
            onToggleFolderDrawer={() => {
              setFolderDrawerOpen((prev) => {
                const next = !prev;
                if (next) setPlaylistDrawerOpen(false);
                return next;
              });
            }}
            onTogglePlaylistDrawer={() => {
              setPlaylistDrawerOpen((prev) => {
                const next = !prev;
                if (next) setFolderDrawerOpen(false);
                return next;
              });
            }}
            onClosePlaybackSettings={() => {
              setPlaybackSettingsOpen(false);
            }}
            onQualityHintChange={(qualityKey) => {
              setPlaybackQualityHint(normalizeBilibiliQualityHint(qualityKey));
            }}
            onRefreshQualityOptions={() => {
              if (!qualityProbeSourceLocator) return;
              void refreshPlaybackQualityOptions(qualityProbeSourceLocator);
            }}
            onPlaybackCachePathDraftChange={setPlaybackCachePathDraft}
            onBrowsePlaybackCachePath={() => {
              void handleBrowsePlaybackCachePath();
            }}
            onSavePlaybackCachePath={() => {
              void handleSavePlaybackCachePath();
            }}
            onResetPlaybackCachePath={() => {
              void handleResetPlaybackCachePath();
            }}
            onCloseResourceContextMenu={() => {
              setResourceContextMenu(null);
            }}
          />
        ) : (
          <div className="platform-magnet-generic">
            <section className="platform-magnet-panel">
              <div className="platform-magnet-panel-header">
                <h4>{t('magnet.platform.panel.search.title')}</h4>
                <span className="platform-magnet-panel-tag">
                  {t('magnet.platform.panel.search.hint.ready', { count: searchableConnectors.length })}
                </span>
              </div>
              <p className="platform-magnet-panel-desc">{t('magnet.platform.panel.search.desc')}</p>

              <div className="platform-magnet-search-row">
                <select
                  value={searchScopeConnectorId}
                  onChange={(event) => setSearchScopeConnectorId(event.target.value)}
                >
                  <option value="all">{t('magnet.platform.panel.search.scope.all')}</option>
                  {searchableConnectors.map((item) => (
                    <option key={item.connectorId} value={item.connectorId}>
                      {item.displayName}
                    </option>
                  ))}
                </select>

                <input
                  value={searchQuery}
                  placeholder={t('magnet.platform.panel.search.inputPlaceholder')}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    void handleSearch();
                  }}
                />

                <button type="button" onClick={() => void handleSearch()} disabled={searching}>
                  {searching
                    ? t('magnet.platform.panel.search.action.searching')
                    : t('magnet.platform.panel.search.action.search')}
                </button>
              </div>

              {searchError ? <p className="platform-magnet-error">{searchError}</p> : null}

              {searchResults.length === 0 ? (
                <p className="platform-magnet-panel-empty">
                  {searchQuery.trim().length > 0
                    ? t('magnet.platform.panel.search.empty')
                    : t('magnet.platform.panel.search.emptyIdle')}
                </p>
              ) : (
                <>
                  <p className="platform-magnet-panel-summary">
                    {t('magnet.platform.panel.search.resultCount', { count: searchResults.length })}
                  </p>
                  <div className="platform-magnet-result-list">
                    {searchResults.map((track) => {
                      const title = track.title?.trim() || t('common.unknown.audioFile');
                      const artist = track.artist?.trim() || t('common.unknown.artist');
                      const connectorName = connectorDisplayNameMap.get(track.connectorId) ?? track.connectorId;
                      return (
                        <div className="platform-magnet-result-item" key={`${track.connectorId}:${track.trackId}`}>
                          <p className="platform-magnet-result-main">
                            {t('magnet.platform.panel.search.resultItem', { title, artist })}
                          </p>
                          <p className="platform-magnet-result-sub">
                            {t('magnet.platform.panel.search.resultItemSub', {
                              connector: connectorName,
                              availability: t(
                                track.availability === 'missing'
                                  ? 'magnet.platform.trackAvailability.missing'
                                  : track.availability === 'remote-only'
                                    ? 'magnet.platform.trackAvailability.remoteOnly'
                                    : 'magnet.platform.trackAvailability.available'
                              ),
                            })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {error ? <p className="platform-magnet-error">{error}</p> : null}
    </div>
  );
};
