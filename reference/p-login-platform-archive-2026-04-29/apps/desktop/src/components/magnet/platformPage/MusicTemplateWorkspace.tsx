import type { CSSProperties, RefObject } from 'react';
import { Compass, Disc3, ExternalLink, Library, Play, Plus } from 'lucide-react';

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
  platformIconAssetUrl: string | null;
  collectionLoading: boolean;
  collectionError: string | null;
  collectionBrowserSections: MusicTemplateCollectionBrowserSection[];
  selectedCollectionId: string | null;
  selectedCollection: MusicTemplateCollectionItem | null;
  showCollectionBrowser: boolean;
  resourceLoading: boolean;
  resourceLoadingMore: boolean;
  resourceError: string | null;
  resourceInfo: string | null;
  resourcePage: MusicTemplateResourcePage | null;
  resourceViewportRef: RefObject<HTMLDivElement>;
  preparingResourceId: string | null;
  selectedPlatformPlaylistId: string | null;
  selectedPlatformPlaylistTitle: string | null;
  selectedPlatformPlaylistCoverUrl: string | null;
  selectedPlatformPlaylistTrackCount: number | null;
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

type MusicTemplateResourceTagTone = 'default' | 'accent' | 'success' | 'warning';

type MusicTemplateResourceTag = {
  id: string;
  label: string;
  tone: MusicTemplateResourceTagTone;
};

function toResourceTagToneClass(tone: MusicTemplateResourceTagTone): string {
  switch (tone) {
    case 'accent':
      return 'platform-magnet-resource-card__tag--accent';
    case 'success':
      return 'platform-magnet-resource-card__tag--success';
    case 'warning':
      return 'platform-magnet-resource-card__tag--warning';
    default:
      return '';
  }
}

export function MusicTemplateWorkspace(props: MusicTemplateWorkspaceProps) {
  const {
    authorized,
    platformLabel,
    platformAccentColor,
    platformFallbackLabel,
    platformIconAssetUrl,
    collectionLoading,
    collectionError,
    collectionBrowserSections,
    selectedCollectionId,
    selectedCollection,
    showCollectionBrowser,
    resourceLoading,
    resourceLoadingMore,
    resourceError,
    resourceInfo,
    resourcePage,
    resourceViewportRef,
    preparingResourceId,
    selectedPlatformPlaylistTitle,
    selectedPlatformPlaylistTrackCount,
    playlistError,
    t,
    formatDuration,
    onSelectCollection,
    onLoadMoreResources,
    onPlaySong,
    onAddSongToPlaylist,
    onOpenSong,
  } = props;

  const resourceTableStyle = {
    '--platform-resource-accent': platformAccentColor,
    '--platform-local-accent': platformAccentColor,
    '--platform-local-outline': `color-mix(in srgb, ${platformAccentColor} 34%, rgba(255, 255, 255, 0.14))`,
    '--platform-local-outline-strong': `color-mix(in srgb, ${platformAccentColor} 58%, rgba(255, 255, 255, 0.22))`,
    '--platform-local-soft-bg': `color-mix(in srgb, ${platformAccentColor} 12%, rgba(255, 255, 255, 0.03))`,
    '--platform-local-soft-bg-hover': `color-mix(in srgb, ${platformAccentColor} 18%, rgba(255, 255, 255, 0.05))`,
    '--platform-local-cover-bg': `color-mix(in srgb, ${platformAccentColor} 12%, rgba(15, 21, 31, 0.94))`,
    '--platform-local-table-bg':
      'linear-gradient(180deg, rgba(16, 22, 34, 0.96), rgba(8, 12, 20, 0.94))',
    '--platform-local-hero-bg':
      'linear-gradient(180deg, rgba(10, 15, 24, 0.98), rgba(7, 11, 18, 1))',
    '--platform-local-hero-inner-line': `color-mix(in srgb, ${platformAccentColor} 26%, rgba(255, 255, 255, 0.06))`,
    '--platform-local-hero-overlay': `radial-gradient(circle at top left, color-mix(in srgb, ${platformAccentColor} 18%, transparent) 0%, transparent 34%), linear-gradient(180deg, color-mix(in srgb, ${platformAccentColor} 14%, rgba(9, 13, 22, 0.96)) 0%, rgba(8, 11, 18, 0.98) 62%, rgba(6, 9, 15, 1) 100%)`,
    '--platform-resource-card-tag-bg': 'rgba(8, 12, 18, 0.74)',
    '--platform-resource-card-tag-border': 'rgba(255, 255, 255, 0.1)',
    '--platform-resource-card-tag-color': 'rgba(224, 232, 245, 0.78)',
    '--platform-resource-card-tag-accent-bg': `color-mix(in srgb, ${platformAccentColor} 18%, rgba(8, 12, 18, 0.92))`,
    '--platform-resource-card-tag-accent-border': `color-mix(in srgb, ${platformAccentColor} 44%, rgba(255, 255, 255, 0.14))`,
    '--platform-resource-card-tag-accent-color': `color-mix(in srgb, ${platformAccentColor} 70%, #f3f7ff 30%)`,
  } as CSSProperties;

  const coverFallbackLabel = platformFallbackLabel.trim().slice(0, 2) || 'PL';
  const isSearchResourceView = resourcePage?.sourceKind === 'search';
  const resolvedSelectedCollectionTitle = selectedCollection?.title?.trim() || '';
  const resolvedResourceSourceId = resourcePage?.sourceId?.trim() || '';
  const resolvedHeroTitle =
    resourcePage?.sourceKind === 'search'
      ? resolvedResourceSourceId || t('magnet.platform.music-template.resource.actionSearch')
      : resolvedSelectedCollectionTitle ||
        (resourcePage?.sourceKind === 'recommended'
          ? t('magnet.platform.music-template.collection.recommendedEntry')
          : resolvedResourceSourceId || t('magnet.platform.music-template.resource.recommendedSummary'));
  const resolvedHeroSummary =
    resourcePage?.sourceKind === 'search'
      ? t('magnet.platform.music-template.resource.searchSummary', {
          keyword: resolvedResourceSourceId || t('magnet.platform.music-template.resource.actionSearch'),
        })
      : resolvedSelectedCollectionTitle
        ? t('magnet.platform.music-template.resource.playlistSummary', {
            playlist: resolvedSelectedCollectionTitle,
          })
        : t('magnet.platform.music-template.resource.recommendedSummary');
  const resolvedHeroCoverUrl =
    selectedCollection?.coverUrl?.trim() ||
    resourcePage?.items.find(
      (item) => typeof item.coverUrl === 'string' && item.coverUrl.trim().length > 0
    )?.coverUrl?.trim() ||
    null;
  const resolvedHeroTrackCount =
    resourcePage?.total ??
    (typeof selectedCollection?.trackCount === 'number' && Number.isFinite(selectedCollection.trackCount)
      ? selectedCollection.trackCount
      : null);
  const resolvedTargetPlaylistSummary = selectedPlatformPlaylistTitle?.trim()
    ? `${t('magnet.platform.music-template.playlist.title')}: ${selectedPlatformPlaylistTitle.trim()}${
        selectedPlatformPlaylistTrackCount != null
          ? ` | ${t('magnet.platform.music-template.playlist.trackCount', {
              count: selectedPlatformPlaylistTrackCount,
            })}`
          : ''
      }`
    : t('magnet.platform.music-template.playlist.selectHint');

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
                  isSearchResourceView ? (
                    <div className="platform-magnet-template-resource-meta-row">
                      <div className="min-w-0">
                        <p className="platform-magnet-panel-summary">{resolvedHeroSummary}</p>
                      </div>
                    </div>
                  ) : (
                    <section
                      className="platform-preview-local-hero relative overflow-hidden rounded-[30px]"
                      style={resourceTableStyle}
                    >
                      <div className="platform-preview-local-hero-overlay pointer-events-none absolute inset-0" />
                      <div className="relative z-[1] px-5 py-5 sm:px-6 sm:py-6">
                        <div className="grid gap-5 md:grid-cols-[120px,minmax(0,1fr)] md:items-center lg:grid-cols-[132px,minmax(0,1fr)]">
                          <div className="platform-preview-local-cover relative h-[112px] w-[112px] overflow-hidden rounded-[24px] shadow-[0_22px_52px_rgba(0,0,0,0.34)] md:h-[120px] md:w-[120px] lg:h-[132px] lg:w-[132px]">
                            {resolvedHeroCoverUrl ? (
                              <img
                                src={resolvedHeroCoverUrl}
                                alt=""
                                aria-hidden
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="platform-preview-local-cover-fallback flex h-full w-full items-center justify-center">
                                <Library className="h-10 w-10" />
                              </div>
                            )}
                            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_36%,rgba(0,0,0,0.28)_100%)]" />
                          </div>

                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.28em] text-white/52">
                              {resolvedHeroSummary}
                            </div>
                            <h2 className="mt-3 break-words text-3xl font-semibold leading-tight text-white sm:text-[2.15rem]">
                              {resolvedHeroTitle}
                            </h2>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <span className="platform-magnet-panel-tag">{platformLabel}</span>
                              {resolvedHeroTrackCount != null ? (
                                <span className="platform-magnet-panel-tag">
                                  {t('magnet.platform.music-template.resource.total', {
                                    count: resolvedHeroTrackCount,
                                  })}
                                </span>
                              ) : null}
                            </div>

                            <p className="mt-4 text-sm text-white/58">
                              {resolvedTargetPlaylistSummary}
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>
                  )
                ) : null}

                {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
                {collectionError ? <p className="platform-magnet-error">{collectionError}</p> : null}
                {resourceError ? <p className="platform-magnet-error">{resourceError}</p> : null}
                {playlistError ? <p className="platform-magnet-error">{playlistError}</p> : null}

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
                    <section
                      className="platform-preview-local-table overflow-hidden rounded-[26px] shadow-[0_18px_48px_rgba(0,0,0,0.18)]"
                      style={resourceTableStyle}
                    >
                      <div className="platform-preview-local-table-head grid grid-cols-[44px,minmax(0,1fr),68px,104px] items-center gap-3 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-white/30 md:grid-cols-[52px,minmax(0,1.45fr),minmax(0,0.9fr),76px,120px] md:px-6">
                        <span>{t('magnet.platform.detail.column.index')}</span>
                        <span>{t('magnet.platform.detail.column.title')}</span>
                        <span className="hidden md:block">{t('magnet.platform.detail.column.album')}</span>
                        <span className="text-right">{t('magnet.platform.detail.column.duration')}</span>
                        <span />
                      </div>

                      <div className="platform-preview-local-table-body">
                        {resourcePage.items.map((item, itemIndex) => {
                          const preparing = preparingResourceId === item.resourceId;
                          const coverUrl =
                            typeof item.coverUrl === 'string' && item.coverUrl.trim().length > 0
                              ? item.coverUrl.trim()
                              : null;
                          const itemAlbum = item.albumName?.trim() || '-';
                          const itemMeta = item.artistNames?.trim() || item.albumName?.trim() || '-';
                          const qualityLabel =
                            item.qualityLabel?.trim() || item.qualityKey?.trim() || null;
                          const vipLabel =
                            item.vipLabel?.trim() ||
                            (item.vipRequired ? t('magnet.platform.music-template.resource.tag.vip') : '');
                          const platformTagIcon = platformIconAssetUrl ? (
                            <img
                              src={platformIconAssetUrl}
                              alt=""
                              aria-hidden
                              className="h-3.5 w-3.5 shrink-0 object-contain"
                            />
                          ) : (
                            <Disc3
                              aria-hidden
                              className="h-3.5 w-3.5 shrink-0"
                              style={{ color: platformAccentColor }}
                            />
                          );
                          const resourceTags: MusicTemplateResourceTag[] = [];

                          if (qualityLabel) {
                            resourceTags.push({
                              id: `${item.resourceId}:quality`,
                              label: qualityLabel,
                              tone: 'success',
                            });
                          }

                          if (vipLabel) {
                            resourceTags.push({
                              id: `${item.resourceId}:vip`,
                              label: vipLabel,
                              tone: 'warning',
                            });
                          }

                          for (const tagLabel of item.tagLabels ?? []) {
                            const normalizedTagLabel = tagLabel.trim();
                            if (!normalizedTagLabel) continue;
                            if (resourceTags.some((tag) => tag.label === normalizedTagLabel)) continue;
                            resourceTags.push({
                              id: `${item.resourceId}:tag:${normalizedTagLabel}`,
                              label: normalizedTagLabel,
                              tone: 'default',
                            });
                          }

                          return (
                            <div
                              key={item.resourceId}
                              className="platform-preview-local-row group grid grid-cols-[44px,minmax(0,1fr),68px,104px] items-center gap-3 px-4 py-3 transition-colors md:grid-cols-[52px,minmax(0,1.45fr),minmax(0,0.9fr),76px,120px] md:px-6"
                            >
                              <span className="text-xs text-white/36">{itemIndex + 1}</span>

                              <div className="flex min-w-0 items-center gap-3 text-left">
                                <div className="platform-preview-local-track-cover relative h-12 w-12 shrink-0 overflow-hidden rounded-[14px]">
                                  {coverUrl ? (
                                    <img
                                      src={coverUrl}
                                      alt=""
                                      aria-hidden
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="platform-preview-local-cover-fallback flex h-full w-full items-center justify-center text-[11px] font-semibold tracking-[0.12em]">
                                      {coverFallbackLabel}
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-white transition-colors group-hover:text-white/96">
                                    {item.title}
                                  </div>
                                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-white/42">
                                    {platformTagIcon}
                                    {resourceTags.length > 0 ? (
                                      <div className="platform-magnet-template-resource-inline-tags">
                                        {resourceTags.map((tag) => (
                                          <span
                                            key={tag.id}
                                            className={`platform-magnet-resource-card__tag platform-magnet-resource-card__tag--inline ${toResourceTagToneClass(tag.tone)}`}
                                            title={tag.label}
                                          >
                                            <span>{tag.label}</span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    <div className="min-w-0 flex-1 truncate">{itemMeta}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="hidden truncate text-sm text-white/46 md:block">
                                {itemAlbum}
                              </div>
                              <div className="text-right text-xs text-white/38">
                                {formatDuration(item.durationSeconds)}
                              </div>

                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={preparing}
                                  onClick={() => onPlaySong(item)}
                                  className={`platform-preview-local-row-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                                    preparing ? 'cursor-not-allowed opacity-40' : 'hover:text-white'
                                  }`}
                                  title={t('magnet.platform.music-template.resource.actionPlay')}
                                  aria-label={t('magnet.platform.music-template.resource.actionPlay')}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </button>

                                <button
                                  type="button"
                                  disabled={preparing}
                                  onClick={() => onAddSongToPlaylist(item)}
                                  className={`platform-preview-local-row-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                                    preparing ? 'cursor-not-allowed opacity-40' : 'hover:text-white'
                                  }`}
                                  title={t('magnet.platform.music-template.resource.actionAddToPlaylist')}
                                  aria-label={t(
                                    'magnet.platform.music-template.resource.actionAddToPlaylist'
                                  )}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => onOpenSong(item)}
                                  className="platform-preview-local-row-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:text-white"
                                  title={t('magnet.platform.music-template.resource.actionOpen')}
                                  aria-label={t('magnet.platform.music-template.resource.actionOpen')}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {resourcePage?.hasMore ? (
                    <div className="platform-magnet-template-resource-load-more-actions">
                      <button
                        type="button"
                        className="platform-magnet-mini-btn"
                        disabled={resourceLoading || resourceLoadingMore}
                        onClick={onLoadMoreResources}
                      >
                        {resourceLoadingMore
                          ? t('magnet.platform.music-template.resource.actionRefreshing')
                          : t('magnet.platform.music-template.resource.actionLoadMore')}
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
