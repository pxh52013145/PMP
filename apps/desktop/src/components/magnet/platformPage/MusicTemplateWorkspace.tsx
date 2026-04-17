import type { CSSProperties, RefObject } from 'react';
import { Compass, Disc3, Library } from 'lucide-react';

import { PlatformResourceCard } from './PlatformResourceCard';
import type {
  MusicTemplateCollectionItem,
  MusicTemplateResourceItem,
  MusicTemplateResourcePage,
} from './musicTemplateRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface MusicTemplateCollectionBrowserItem {
  id: string;
  kind: 'daily' | 'recommended-playlist' | 'user-playlist';
  collectionId: string | null;
  title: string;
  subtitle: string;
  countLabel?: string | null;
  coverUrl?: string;
}

export interface MusicTemplateCollectionBrowserSection {
  id: string;
  title: string;
  items: MusicTemplateCollectionBrowserItem[];
}

export type MusicTemplateWorkspaceProps = {
  authorized: boolean;
  platformLabel: string;
  platformAccentColor: string;
  platformFallbackLabel: string;
  collectionLoading: boolean;
  collectionError: string | null;
  collectionBrowserSections: MusicTemplateCollectionBrowserSection[];
  selectedCollectionId: string | null;
  selectedCollection: MusicTemplateCollectionItem | null;
  showCollectionBrowser: boolean;
  resourceLoading: boolean;
  resourceError: string | null;
  resourceInfo: string | null;
  resourcePage: MusicTemplateResourcePage | null;
  resourceViewportRef: RefObject<HTMLDivElement>;
  preparingResourceId: string | null;
  selectedPlatformPlaylistId: string | null;
  playlistError: string | null;
  t: Translator;
  formatDuration: (seconds: number | undefined) => string;
  onSelectCollection: (item: MusicTemplateCollectionBrowserItem) => void;
  onLoadMoreResources: () => void;
  onPlaySong: (item: MusicTemplateResourceItem) => void;
  onQueueSong: (item: MusicTemplateResourceItem) => void;
  onAddSongToPlaylist: (item: MusicTemplateResourceItem) => void;
  onOpenSong: (item: MusicTemplateResourceItem) => void;
};

function resolveCollectionIcon(kind: MusicTemplateCollectionBrowserItem['kind']) {
  switch (kind) {
    case 'daily':
      return Compass;
    case 'recommended-playlist':
      return Disc3;
    default:
      return Library;
  }
}

export function MusicTemplateWorkspace(props: MusicTemplateWorkspaceProps) {
  const {
    authorized,
    platformLabel,
    platformAccentColor,
    platformFallbackLabel,
    collectionLoading,
    collectionError,
    collectionBrowserSections,
    selectedCollectionId,
    selectedCollection,
    showCollectionBrowser,
    resourceLoading,
    resourceError,
    resourceInfo,
    resourcePage,
    resourceViewportRef,
    preparingResourceId,
    selectedPlatformPlaylistId,
    playlistError,
    t,
    formatDuration,
    onSelectCollection,
    onLoadMoreResources,
    onPlaySong,
    onQueueSong,
    onAddSongToPlaylist,
    onOpenSong,
  } = props;

  const resourceSummary =
    resourcePage?.sourceKind === 'search'
      ? t('magnet.platform.music-template.resource.searchSummary', {
          keyword: resourcePage.sourceId,
        })
      : resourcePage?.sourceKind === 'user-playlist'
        ? t('magnet.platform.music-template.resource.playlistSummary', {
            playlist:
              selectedCollection?.title || t('magnet.platform.music-template.collection.unknownPlaylist'),
          })
        : t('magnet.platform.music-template.resource.recommendedSummary');

  return (
    <div className="platform-magnet-template">
      <div className="platform-magnet-template-scroll">
        {!authorized ? (
          <p className="platform-magnet-note">{t('magnet.platform.music-template.status.waiting')}</p>
        ) : null}

        <div className="platform-magnet-template-layout platform-magnet-template-layout--drawers platform-workspace-stage">
          <section className="platform-magnet-resource-viewport">
            {showCollectionBrowser ? (
              <>
                <div className="platform-magnet-template-resource-meta-row">
                  <div className="min-w-0">
                    <p className="platform-magnet-panel-summary">
                      {t('magnet.platform.music-template.collection-browser.subtitle')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="platform-magnet-panel-tag">{platformLabel}</span>
                  </div>
                </div>

                {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
                {collectionError ? <p className="platform-magnet-error">{collectionError}</p> : null}

                <div className="platform-magnet-template-channel-browser">
                  {collectionBrowserSections.map((section) =>
                    section.items.length > 0 ? (
                      <section
                        key={section.id}
                        className="platform-magnet-template-channel-section"
                      >
                        <div className="platform-magnet-template-channel-section-header">
                          <h3 className="platform-magnet-template-channel-section-title">
                            {section.title}
                          </h3>
                          <span className="platform-magnet-panel-tag">
                            {t('magnet.platform.music-template.collection-browser.sectionCount', {
                              count: section.items.length,
                            })}
                          </span>
                        </div>

                        <div className="platform-magnet-template-channel-grid">
                          {section.items.map((item) => {
                            const Icon = resolveCollectionIcon(item.kind);
                            const selected = selectedCollectionId === item.collectionId;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={`platform-magnet-template-channel-card${
                                  selected ? ' platform-magnet-template-channel-card--active' : ''
                                }`}
                                style={
                                  {
                                    '--platform-resource-accent': platformAccentColor,
                                  } as CSSProperties
                                }
                                onClick={() => {
                                  onSelectCollection(item);
                                }}
                              >
                                {item.coverUrl ? (
                                  <span className="platform-magnet-template-channel-card__cover">
                                    <img
                                      src={item.coverUrl}
                                      alt=""
                                      aria-hidden
                                      className="platform-magnet-template-channel-card__cover-image"
                                    />
                                  </span>
                                ) : (
                                  <span className="platform-magnet-template-channel-card__icon">
                                    <Icon className="h-5 w-5" />
                                  </span>
                                )}
                                <span className="platform-magnet-template-channel-card__text">
                                  <span className="platform-magnet-template-channel-card__title">
                                    {item.title}
                                  </span>
                                  <span className="platform-magnet-template-channel-card__subtitle">
                                    {item.subtitle}
                                  </span>
                                </span>
                                {item.countLabel ? (
                                  <span className="platform-magnet-template-channel-card__count">
                                    {item.countLabel}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ) : null
                  )}

                  {!collectionLoading &&
                  !collectionError &&
                  collectionBrowserSections.every((section) => section.items.length === 0) ? (
                    <p className="platform-magnet-panel-empty">
                      {t('magnet.platform.music-template.collection-browser.empty')}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                {authorized ? (
                  <div className="platform-magnet-template-resource-meta-row">
                    <div className="min-w-0">
                      <div className="platform-magnet-template-resource-heading">
                        <p className="platform-magnet-panel-summary">{resourceSummary}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="platform-magnet-panel-tag">{platformLabel}</span>
                      {resourcePage ? (
                        <span className="platform-magnet-panel-tag">
                          {t('magnet.platform.music-template.resource.total', {
                            count: resourcePage.total,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
                {collectionError ? <p className="platform-magnet-error">{collectionError}</p> : null}
                {resourceError ? <p className="platform-magnet-error">{resourceError}</p> : null}
                {playlistError ? <p className="platform-magnet-error">{playlistError}</p> : null}
                {!selectedPlatformPlaylistId && authorized ? (
                  <p className="platform-magnet-note">
                    {t('magnet.platform.music-template.playlist.selectHint')}
                  </p>
                ) : null}

                <div className="platform-magnet-resource-scroll-shell" ref={resourceViewportRef}>
                  {resourceLoading ? (
                    <p className="platform-magnet-panel-empty">
                      {t('magnet.platform.music-template.resource.loading')}
                    </p>
                  ) : !resourcePage || resourcePage.items.length === 0 ? (
                    <p className="platform-magnet-panel-empty">
                      {t('magnet.platform.music-template.resource.empty')}
                    </p>
                  ) : (
                    <div className="platform-magnet-template-resource-grid">
                      {resourcePage.items.map((item) => {
                        const preparing = preparingResourceId === item.resourceId;
                        return (
                          <PlatformResourceCard
                            key={item.resourceId}
                            accentColor={platformAccentColor}
                            coverUrl={item.coverUrl}
                            coverAlt={item.title}
                            coverFallbackLabel={platformFallbackLabel}
                            title={item.title}
                            subtitle={item.artistNames}
                            detail={item.albumName ?? null}
                            durationLabel={formatDuration(item.durationSeconds)}
                            badges={[
                              {
                                id: `${item.resourceId}:platform`,
                                label: platformLabel,
                                tone: 'accent' as const,
                                compact: true,
                                icon: <Disc3 className="h-3.5 w-3.5" />,
                              },
                            ]}
                            actions={[
                              {
                                id: `${item.resourceId}:queue`,
                                label: t('magnet.platform.music-template.resource.actionQueue'),
                                onClick: () => onQueueSong(item),
                              },
                              {
                                id: `${item.resourceId}:playlist`,
                                label: t(
                                  'magnet.platform.music-template.resource.actionAddToPlaylist'
                                ),
                                onClick: () => onAddSongToPlaylist(item),
                              },
                              {
                                id: `${item.resourceId}:open`,
                                label: t('magnet.platform.music-template.resource.actionOpen'),
                                variant: 'ghost',
                                onClick: () => onOpenSong(item),
                              },
                            ]}
                            preparing={preparing}
                            titleHint={t('magnet.platform.music-template.resource.actionPlay')}
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
                    <div className="platform-magnet-template-resource-load-more-actions">
                      <button
                        type="button"
                        className="platform-magnet-mini-btn"
                        disabled={resourceLoading}
                        onClick={onLoadMoreResources}
                      >
                        {t('magnet.platform.music-template.resource.actionLoadMore')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
