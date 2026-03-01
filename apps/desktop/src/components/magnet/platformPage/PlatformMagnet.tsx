import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useT } from '../../../i18n';
import type { AudioState } from '../../../services/audio';
import {
  listPlatformConnectorDefinitions,
  listPlatformConnectorFacadeItems,
  searchPlatformTracks,
  subscribePlatformConnectorAuthChanged,
  type PlatformConnectorDefinition,
  type PlatformConnectorFacadeItem,
} from '../../../modules/music-platform';
import {
  buildPlatformWorkspaceDescriptors,
  GENERIC_PLATFORM_WORKSPACE_MODE,
  getWorkspaceConnectorId,
  normalizeWorkspaceMode,
  toConnectorWorkspaceMode,
  type PlatformWorkspaceMode,
} from './platformWorkspaceModes';
import { resolvePlatformWorkspaceAdapter } from './platformWorkspaceAdapterRegistry';
import { useBilibiliWorkspaceAdapterController } from './useBilibiliWorkspaceAdapterController';
import './PlatformMagnet.css';

const DEFAULT_SEARCH_LIMIT = 30;
const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili' as const;

type PlatformTrackSearchItem = Awaited<ReturnType<typeof searchPlatformTracks>>['tracks'][number];

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

function isPlatformPlaylist(
  playlist: AudioState['playlists'][number],
  connectorId?: string
): boolean {
  if (playlist.kind !== 'platform') return false;
  if (!connectorId) return true;
  return playlist.sourceConnectorId === connectorId;
}

export const PlatformMagnet: React.FC = () => {
  const t = useT();
  const audioService = useAudioService();

  const [prefersDarkMode, setPrefersDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [mode, setMode] = useState<PlatformWorkspaceMode>(
    toConnectorWorkspaceMode(BILIBILI_CONNECTOR_ID)
  );
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PlatformConnectorFacadeItem[]>([]);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchScopeConnectorId, setSearchScopeConnectorId] = useState('all');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<PlatformTrackSearchItem[]>([]);

  const [audioState, setAudioState] = useState<AudioState>(() => audioService.getState());
  const [selectedPlaylistIdByScope, setSelectedPlaylistIdByScope] = useState<Record<string, string | null>>({});
  const [newPlaylistNameByScope, setNewPlaylistNameByScope] = useState<Record<string, string>>({});
  const [playlistErrorByScope, setPlaylistErrorByScope] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDarkMode(event.matches);
    };

    setPrefersDarkMode(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

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

  const connectorDefinitions = useMemo<PlatformConnectorDefinition[]>(
    () => listPlatformConnectorDefinitions(),
    []
  );

  const workspaceDescriptors = useMemo(
    () => buildPlatformWorkspaceDescriptors(connectorDefinitions),
    [connectorDefinitions]
  );

  const activeMode = useMemo(
    () => normalizeWorkspaceMode(mode, workspaceDescriptors),
    [mode, workspaceDescriptors]
  );

  const activeWorkspaceConnectorId = useMemo(
    () => getWorkspaceConnectorId(activeMode),
    [activeMode]
  );

  const activeWorkspaceDescriptor = useMemo(
    () => workspaceDescriptors.find((descriptor) => descriptor.mode === activeMode) ?? null,
    [activeMode, workspaceDescriptors]
  );

  const activePlaylistScopeKey = activeWorkspaceConnectorId ?? GENERIC_PLATFORM_WORKSPACE_MODE;

  const selectedPlaylistId = selectedPlaylistIdByScope[activePlaylistScopeKey] ?? null;
  const newPlaylistName = newPlaylistNameByScope[activePlaylistScopeKey] ?? '';
  const playlistError = playlistErrorByScope[activePlaylistScopeKey] ?? null;

  const setActiveScopeSelectedPlaylistId = useCallback(
    (nextPlaylistId: string | null) => {
      setSelectedPlaylistIdByScope((prev) => ({
        ...prev,
        [activePlaylistScopeKey]: nextPlaylistId,
      }));
    },
    [activePlaylistScopeKey]
  );

  const setActiveScopeNewPlaylistName = useCallback(
    (nextName: string) => {
      setNewPlaylistNameByScope((prev) => ({
        ...prev,
        [activePlaylistScopeKey]: nextName,
      }));
    },
    [activePlaylistScopeKey]
  );

  const setActiveScopePlaylistError = useCallback(
    (nextError: string | null) => {
      setPlaylistErrorByScope((prev) => ({
        ...prev,
        [activePlaylistScopeKey]: nextError,
      }));
    },
    [activePlaylistScopeKey]
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

  const platformPlaylists = useMemo(() => {
    if (activeWorkspaceConnectorId) {
      return audioState.playlists.filter((item) =>
        isPlatformPlaylist(item, activeWorkspaceConnectorId)
      );
    }
    return audioState.playlists.filter((item) => isPlatformPlaylist(item));
  }, [activeWorkspaceConnectorId, audioState.playlists]);

  const selectedPlaylist = useMemo(
    () => platformPlaylists.find((item) => item.id === selectedPlaylistId) ?? null,
    [platformPlaylists, selectedPlaylistId]
  );

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
    setAudioState(audioService.getState());
    const unsubscribe = audioService.onStateChange((nextState) => {
      setAudioState(nextState);
    });
    return unsubscribe;
  }, [audioService]);

  useEffect(() => {
    const playlists = platformPlaylists;
    setSelectedPlaylistIdByScope((prev) => {
      const currentSelectedPlaylistId = prev[activePlaylistScopeKey] ?? null;

      if (playlists.length === 0) {
        if (currentSelectedPlaylistId === null) return prev;
        return {
          ...prev,
          [activePlaylistScopeKey]: null,
        };
      }

      if (
        currentSelectedPlaylistId &&
        playlists.some((playlist) => playlist.id === currentSelectedPlaylistId)
      ) {
        return prev;
      }

      const nextSelectedPlaylistId = playlists[0]?.id ?? null;
      if (nextSelectedPlaylistId === currentSelectedPlaylistId) {
        return prev;
      }

      return {
        ...prev,
        [activePlaylistScopeKey]: nextSelectedPlaylistId,
      };
    });
  }, [activePlaylistScopeKey, platformPlaylists]);

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
    if (!normalizedName || !activeWorkspaceConnectorId) return;
    const playlist = audioService.createPlaylist(normalizedName, undefined, {
      kind: 'platform',
      sourceConnectorId: activeWorkspaceConnectorId,
    });
    setActiveScopeSelectedPlaylistId(playlist.id);
    setActiveScopeNewPlaylistName('');
    setActiveScopePlaylistError(null);
  }, [
    activeWorkspaceConnectorId,
    audioService,
    newPlaylistName,
    setActiveScopeNewPlaylistName,
    setActiveScopePlaylistError,
    setActiveScopeSelectedPlaylistId,
  ]);

  const {
    bilibiliUseDarkMode,
    bilibiliToolbarProps,
    bilibiliWorkspaceProps,
  } = useBilibiliWorkspaceAdapterController({
    activeWorkspaceConnectorId,
    prefersDarkMode,
    items,
    audioService,
    t,
    platformPlaylists,
    selectedPlaylist,
    selectedPlaylistId,
    newPlaylistName,
    playlistError,
    onCreatePlaylist: handleCreatePlaylist,
    setSelectedPlaylistId: setActiveScopeSelectedPlaylistId,
    setNewPlaylistName: setActiveScopeNewPlaylistName,
    setPlaylistError: setActiveScopePlaylistError,
  });

  const authorizedCount = useMemo(
    () => items.filter((item) => item.authState === 'authorized').length,
    [items]
  );

  const rootClassName = bilibiliUseDarkMode
    ? 'platform-magnet-root platform-magnet-root--dark'
    : 'platform-magnet-root';

  const getWorkspaceModeLabel = useCallback(
    (workspaceDescriptor: {
      mode: PlatformWorkspaceMode;
      connectorId?: string;
      displayName: string;
      labelKey?: string;
    }): string => {
      if (workspaceDescriptor.mode === GENERIC_PLATFORM_WORKSPACE_MODE) {
        return t('magnet.platform.mode.generic');
      }

      if (workspaceDescriptor.labelKey) {
        return t(workspaceDescriptor.labelKey);
      }

      return workspaceDescriptor.displayName;
    },
    [t]
  );

  const activeWorkspaceAdapter =
    activeWorkspaceDescriptor && activeWorkspaceDescriptor.workspaceKind !== 'generic'
      ? resolvePlatformWorkspaceAdapter({
          connectorId: activeWorkspaceDescriptor.connectorId,
          workspaceKind: activeWorkspaceDescriptor.workspaceKind,
        })
      : null;

  return (
    <div className={rootClassName}>
      <div className="platform-magnet-header">
        <div className="platform-magnet-header-main">
          <div className="platform-magnet-mode-row">
            <div className="platform-magnet-mode-switcher" role="tablist">
              {workspaceDescriptors.map((workspaceDescriptor) => {
                const active = activeMode === workspaceDescriptor.mode;
                return (
                  <button
                    key={workspaceDescriptor.mode}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={active ? 'platform-magnet-mode-btn active' : 'platform-magnet-mode-btn'}
                    onClick={() => setMode(workspaceDescriptor.mode)}
                  >
                    {getWorkspaceModeLabel(workspaceDescriptor)}
                  </button>
                );
              })}
            </div>

            {activeWorkspaceAdapter && activeWorkspaceDescriptor?.workspaceKind === 'bilibili'
              ? activeWorkspaceAdapter.renderToolbar(bilibiliToolbarProps)
              : null}
          </div>
        </div>
      </div>

      {activeMode === GENERIC_PLATFORM_WORKSPACE_MODE && (
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
        {activeWorkspaceAdapter && activeWorkspaceDescriptor?.workspaceKind === 'bilibili' ? (
          activeWorkspaceAdapter.renderWorkspace(bilibiliWorkspaceProps)
        ) : activeMode !== GENERIC_PLATFORM_WORKSPACE_MODE ? (
          <div className="platform-magnet-generic">
            <section className="platform-magnet-panel">
              <div className="platform-magnet-panel-header">
                <h4>{activeWorkspaceDescriptor?.displayName ?? t('magnet.platform.mode.generic')}</h4>
                <span className="platform-magnet-panel-tag">{t('magnet.platform-login.status.comingSoon')}</span>
              </div>
              <p className="platform-magnet-panel-desc">{t('magnet.platform.panel.search.desc')}</p>
            </section>
          </div>
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
