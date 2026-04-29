import type {
  PlatformWorkspaceCollectionItem as SharedPlatformWorkspaceCollectionItem,
  PlatformWorkspaceCoverAsset,
  PlatformWorkspaceFeatureFlags as SharedPlatformWorkspaceFeatureFlags,
  PlatformWorkspaceLyricLocatorResolved as SharedPlatformWorkspaceLyricLocatorResolved,
  PlatformWorkspacePageItem as SharedPlatformWorkspacePageItem,
  PlatformWorkspacePageListResult as SharedPlatformWorkspacePageListResult,
  PlatformWorkspacePageModel as SharedPlatformWorkspacePageModel,
  PlatformWorkspacePreparedPlayback as SharedPlatformWorkspacePreparedPlayback,
  PlatformWorkspaceQualityOption as SharedPlatformWorkspaceQualityOption,
  PlatformWorkspaceQualityState as SharedPlatformWorkspaceQualityState,
  PlatformWorkspaceResourceItem as SharedPlatformWorkspaceResourceItem,
  PlatformWorkspaceResourcePage as SharedPlatformWorkspaceResourcePage,
} from '@pixel-matrix/plugin-platform-contracts';

import type { PlatformConnectorId } from './connectorAuth';
import { getPlatformConnectorDefinition } from './connectorAuth';
import {
  PLATFORM_LIBRARY_BINDING_ID,
  PLATFORM_PAGES_BINDING_ID,
  PLATFORM_QUALITY_BINDING_ID,
  PLATFORM_RECOMMENDATIONS_BINDING_ID,
  PLATFORM_SEARCH_BINDING_ID,
} from './platformInstanceApiBinding';
import {
  asPlatformFacadeRecord,
  createPlatformConnectorFacadeCaller,
  normalizePlatformFacadeAssetUrl,
  normalizePlatformFacadePositiveInt,
  normalizePlatformFacadeString,
  readPlatformFacadeFiniteNumber,
} from './platformConnectorFacadeCore';

export type PlatformWorkspaceCollectionItem = SharedPlatformWorkspaceCollectionItem;
export type PlatformWorkspaceResourceItem = SharedPlatformWorkspaceResourceItem;
export type PlatformWorkspaceResourcePage = SharedPlatformWorkspaceResourcePage;
export type PlatformWorkspacePreparedPlayback = SharedPlatformWorkspacePreparedPlayback;
export type PlatformWorkspaceQualityOption = SharedPlatformWorkspaceQualityOption;
export type PlatformWorkspaceQualityState = SharedPlatformWorkspaceQualityState;
export type PlatformWorkspaceLyricLocatorResolved = SharedPlatformWorkspaceLyricLocatorResolved;
export type PlatformWorkspaceFeatureFlags = SharedPlatformWorkspaceFeatureFlags;
export type PlatformWorkspacePageItem = SharedPlatformWorkspacePageItem;
export type PlatformWorkspacePageListResult = SharedPlatformWorkspacePageListResult;
export type PlatformWorkspacePageModel = SharedPlatformWorkspacePageModel;

export function clonePlatformWorkspaceCollectionItem(
  item: PlatformWorkspaceCollectionItem
): PlatformWorkspaceCollectionItem {
  return {
    collectionId: item.collectionId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
    updatedAtMs: item.updatedAtMs,
  };
}

export function clonePlatformWorkspaceCollectionItems(
  items: PlatformWorkspaceCollectionItem[]
): PlatformWorkspaceCollectionItem[] {
  return items.map(clonePlatformWorkspaceCollectionItem);
}

export function clonePlatformWorkspaceResourceItem(
  item: PlatformWorkspaceResourceItem
): PlatformWorkspaceResourceItem {
  return {
    resourceId: item.resourceId,
    title: item.title,
    sourceLocator: item.sourceLocator,
    durationSeconds: item.durationSeconds,
    coverUrl: item.coverUrl,
    lyricLocator: item.lyricLocator,
    ownerName: item.ownerName,
    artistNames: item.artistNames,
    albumName: item.albumName,
    webUrl: item.webUrl,
    vipRequired: item.vipRequired,
    vipLabel: item.vipLabel,
    qualityKey: item.qualityKey,
    qualityLabel: item.qualityLabel,
    tagLabels: Array.isArray(item.tagLabels) ? [...item.tagLabels] : undefined,
    bvid: item.bvid,
    cid: item.cid,
    contentKind: item.contentKind,
  };
}

export function clonePlatformWorkspaceResourcePage(
  page: PlatformWorkspaceResourcePage | null
): PlatformWorkspaceResourcePage | null {
  if (!page) return null;
  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items.map(clonePlatformWorkspaceResourceItem),
  };
}

export function clonePlatformWorkspacePreparedPlayback(
  prepared: PlatformWorkspacePreparedPlayback | null
): PlatformWorkspacePreparedPlayback | null {
  if (!prepared) return null;
  return {
    sourceLocator: prepared.sourceLocator,
    streamUrl: prepared.streamUrl,
    cachePath: prepared.cachePath,
    mimeType: prepared.mimeType,
    durationSeconds: prepared.durationSeconds,
    resourceId: prepared.resourceId,
    selectedQualityKey: prepared.selectedQualityKey,
    selectedQualityLabel: prepared.selectedQualityLabel,
    contentKind: prepared.contentKind,
  };
}

export function clonePlatformWorkspaceQualityOption(
  item: PlatformWorkspaceQualityOption
): PlatformWorkspaceQualityOption {
  return {
    key: item.key,
    label: item.label,
    available: item.available,
  };
}

export function clonePlatformWorkspaceQualityState(
  state: PlatformWorkspaceQualityState | null
): PlatformWorkspaceQualityState | null {
  if (!state) return null;
  return {
    options: state.options.map(clonePlatformWorkspaceQualityOption),
    currentKey: state.currentKey,
    currentLabel: state.currentLabel,
  };
}

export function clonePlatformWorkspacePageItem(
  item: PlatformWorkspacePageItem
): PlatformWorkspacePageItem {
  return {
    pageId: item.pageId,
    kind: item.kind,
    title: item.title,
    enabled: item.enabled,
    subtitle: item.subtitle,
    badgeLabel: item.badgeLabel,
    iconKey: item.iconKey,
  };
}

export function clonePlatformWorkspacePageModel(
  model: PlatformWorkspacePageModel | null
): PlatformWorkspacePageModel | null {
  if (!model) return null;
  return {
    features: createPlatformWorkspaceFeatureFlags(model.features),
    defaultPageId: model.defaultPageId,
    pages: model.pages.map(clonePlatformWorkspacePageItem),
  };
}

function resolvePlatformWorkspaceDisplayName(connectorId: PlatformConnectorId): string {
  return (
    normalizePlatformFacadeString(getPlatformConnectorDefinition(connectorId)?.displayName) ||
    connectorId.replace(/^connector\.platform\./i, '') ||
    connectorId
  );
}

function createWorkspaceCaller(connectorId: PlatformConnectorId) {
  return createPlatformConnectorFacadeCaller({
    connectorId,
    displayName: resolvePlatformWorkspaceDisplayName(connectorId),
  });
}

function readArraySource(
  value: unknown,
  keys: string[]
): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (typeof record.data !== 'undefined') {
    const nested = readArraySource(record.data, keys);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function readRecordSource(
  value: unknown,
  keys: string[]
): Record<string, unknown> | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const candidate = asPlatformFacadeRecord(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  if (typeof record.data !== 'undefined') {
    const nested = readRecordSource(record.data, keys);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizePlatformFacadeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  const normalized = normalizePlatformFacadeString(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'true' || normalized === 'yes' || normalized === 'enabled' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === 'no' || normalized === 'disabled' || normalized === '0') {
    return false;
  }
  return undefined;
}

function mapUniqueStringArray(values: unknown[]): string[] {
  return values
    .map(mapTagLabel)
    .filter(
      (item, index, array): item is string =>
        Boolean(item) && array.indexOf(item) === index
    );
}

function readDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function mapDurationSeconds(record: Record<string, unknown>): number | undefined {
  const explicitSeconds = readDurationSeconds(
    record.durationSeconds ?? record.durationSec ?? record.lengthSeconds
  );
  if (typeof explicitSeconds === 'number') {
    return explicitSeconds;
  }

  const durationMs = readPlatformFacadeFiniteNumber(
    record.durationMs ?? record.lengthMs ?? record.playTimeMs
  );
  if (typeof durationMs === 'number' && durationMs > 0) {
    return durationMs / 1000;
  }

  return readDurationSeconds(record.duration);
}

function mapUpdatedAtMs(record: Record<string, unknown>): number | undefined {
  return readPlatformFacadeFiniteNumber(
    record.updatedAtMs ??
      record.updatedAt ??
      record.updateTime ??
      record.modifiedAtMs ??
      record.modifyTime ??
      record.mtimeMs
  );
}

function mapCoverUrl(record: Record<string, unknown>): string | undefined {
  return (
    normalizePlatformFacadeString(
      record.coverUrl ??
        record.cover ??
        record.imageUrl ??
        record.image ??
        record.picUrl ??
        record.pic ??
        record.thumbnailUrl ??
        record.thumbUrl
    ) || undefined
  );
}

function mapOwnerName(record: Record<string, unknown>): string | undefined {
  const direct =
    normalizePlatformFacadeString(
      record.ownerName ?? record.uploaderName ?? record.authorName ?? record.artistName
    ) || undefined;
  if (direct) return direct;

  const ownerRecord = readRecordSource(record.owner, ['profile', 'user']);
  return (
    normalizePlatformFacadeString(
      ownerRecord?.name ?? ownerRecord?.title ?? ownerRecord?.nickname ?? ownerRecord?.uname
    ) || undefined
  );
}

function mapArtistNames(record: Record<string, unknown>): string | undefined {
  const direct =
    normalizePlatformFacadeString(record.artistNames ?? record.artistsText ?? record.artistName) ||
    undefined;
  if (direct) return direct;

  const source = readArraySource(record, ['artists', 'artistList', 'authors', 'singers']);
  if (!source) {
    return mapOwnerName(record);
  }

  const names = source
    .map((item) => {
      if (typeof item === 'string') {
        return normalizePlatformFacadeString(item) || null;
      }
      const artistRecord = asPlatformFacadeRecord(item);
      if (!artistRecord) return null;
      return (
        normalizePlatformFacadeString(
          artistRecord.name ??
            artistRecord.title ??
            artistRecord.uname ??
            artistRecord.nickname
        ) || null
      );
    })
    .filter(
      (item, index, array): item is string =>
        Boolean(item) && array.indexOf(item) === index
    );

  return names.length > 0 ? names.join(' / ') : mapOwnerName(record);
}

function mapCollectionArray(value: unknown): PlatformWorkspaceCollectionItem[] | undefined {
  const arrayValue = readArraySource(value, [
    'items',
    'collections',
    'playlists',
    'folders',
    'recommendedCollections',
  ]);
  if (!arrayValue) return undefined;
  return arrayValue
    .map(mapCollectionItem)
    .filter((item): item is PlatformWorkspaceCollectionItem => Boolean(item));
}

function mapCollectionItem(value: unknown): PlatformWorkspaceCollectionItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const collectionId =
    normalizePlatformFacadeString(record.collectionId) ||
    normalizePlatformFacadeString(record.playlistId) ||
    normalizePlatformFacadeString(record.folderId) ||
    normalizePlatformFacadeString(record.id);
  const title = normalizePlatformFacadeString(
    record.title ?? record.name ?? record.label ?? record.playlistTitle
  );
  if (!collectionId || !title) return null;

  return {
    collectionId,
    title,
    trackCount: normalizePlatformFacadePositiveInt(
      record.trackCount ??
        record.mediaCount ??
        record.media_size ??
        record.songCount ??
        record.count ??
        record.total
    ),
    coverUrl: mapCoverUrl(record),
    updatedAtMs: mapUpdatedAtMs(record),
  };
}

function mapTagLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = normalizePlatformFacadeString(value);
    return normalized || null;
  }

  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const label = normalizePlatformFacadeString(
    record.label ?? record.title ?? record.name ?? record.text
  );
  return label || null;
}

function mapQualityOption(value: unknown): PlatformWorkspaceQualityOption | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const key = normalizePlatformFacadeString(
    record.key ?? record.qualityKey ?? record.id ?? record.code
  );
  if (!key) return null;

  return {
    key,
    label:
      normalizePlatformFacadeString(record.label ?? record.title ?? record.name ?? key) || key,
    available: normalizePlatformFacadeBoolean(record.available) !== false,
  };
}

function mapResourceItem(value: unknown): PlatformWorkspaceResourceItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;
  const qualityRecord = asPlatformFacadeRecord(record.quality);

  const resourceId =
    normalizePlatformFacadeString(record.resourceId) ||
    normalizePlatformFacadeString(record.songId) ||
    normalizePlatformFacadeString(record.trackId) ||
    normalizePlatformFacadeString(record.videoId) ||
    normalizePlatformFacadeString(record.bvid) ||
    normalizePlatformFacadeString(record.id);
  const title = normalizePlatformFacadeString(record.title ?? record.name);
  const sourceLocator =
    normalizePlatformFacadeString(record.sourceLocator ?? record.locator ?? record.url) ||
    undefined;
  if (!resourceId || !title || !sourceLocator) return null;

  const qualityKey =
    normalizePlatformFacadeString(
      record.qualityKey ??
        record.selectedQualityKey ??
        record.audioQualityKey ??
        record.soundQualityKey ??
        record.rateKey ??
        qualityRecord?.key
    ) || undefined;
  const qualityLabel =
    normalizePlatformFacadeString(
      record.qualityLabel ??
        record.selectedQualityLabel ??
        record.audioQualityLabel ??
        record.soundQualityLabel ??
        record.rateLabel ??
        qualityRecord?.label
    ) || undefined;
  const vipLabel =
    normalizePlatformFacadeString(
      record.vipLabel ??
        record.vipBadge ??
        record.membershipLabel ??
        record.accessLabel ??
        record.badgeLabel
    ) || undefined;
  const tagLabels = mapUniqueStringArray(
    Array.isArray(record.tagLabels)
      ? record.tagLabels
      : Array.isArray(record.tags)
        ? record.tags
        : Array.isArray(record.badges)
          ? record.badges
          : Array.isArray(record.labels)
            ? record.labels
            : []
  );

  return {
    resourceId,
    title,
    sourceLocator,
    durationSeconds: mapDurationSeconds(record),
    coverUrl: mapCoverUrl(record),
    lyricLocator:
      normalizePlatformFacadeString(record.lyricLocator ?? record.lyricUrl ?? record.lyricPath) ||
      undefined,
    ownerName: mapOwnerName(record),
    artistNames: mapArtistNames(record),
    albumName:
      normalizePlatformFacadeString(
        record.albumName ?? record.album ?? record.albumTitle ?? record.collectionTitle
      ) || undefined,
    webUrl:
      normalizePlatformFacadeString(
        record.webUrl ?? record.pageUrl ?? record.jumpUrl ?? record.url
      ) ||
      sourceLocator ||
      undefined,
    vipRequired: normalizePlatformFacadeBoolean(
      record.vipRequired ??
        record.requiresVip ??
        record.needVip ??
        record.vip ??
        record.membersOnly
    ) === true,
    vipLabel,
    qualityKey,
    qualityLabel,
    tagLabels: tagLabels.length > 0 ? tagLabels : undefined,
    bvid: normalizePlatformFacadeString(record.bvid) || undefined,
    cid: normalizePlatformFacadeString(record.cid) || undefined,
    contentKind:
      normalizePlatformFacadeString(record.contentKind ?? record.kind ?? record.mediaType) ||
      undefined,
  };
}

function mapResourcePage(value: unknown): PlatformWorkspaceResourcePage | null | undefined {
  if (value === null) return null;

  if (Array.isArray(value)) {
    const items = value
      .map(mapResourceItem)
      .filter((item): item is PlatformWorkspaceResourceItem => Boolean(item));
    return {
      sourceKind: 'unknown',
      sourceId: 'unknown',
      pageNum: 1,
      pageSize: Math.max(1, items.length),
      total: items.length,
      hasMore: false,
      items,
    };
  }

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  if (typeof record.page !== 'undefined') {
    const nested = mapResourcePage(record.page);
    if (typeof nested !== 'undefined') {
      return nested;
    }
  }
  if (typeof record.data !== 'undefined') {
    const nested = mapResourcePage(record.data);
    if (typeof nested !== 'undefined') {
      return nested;
    }
  }

  const sourceItems = readArraySource(record, [
    'items',
    'resources',
    'tracks',
    'songs',
    'list',
    'medias',
    'archives',
  ]);
  if (!sourceItems) return undefined;

  const items = sourceItems
    .map(mapResourceItem)
    .filter((item): item is PlatformWorkspaceResourceItem => Boolean(item));

  return {
    sourceKind:
      normalizePlatformFacadeString(record.sourceKind ?? record.kind ?? record.pageKind) ||
      'unknown',
    sourceId:
      normalizePlatformFacadeString(record.sourceId) ||
      normalizePlatformFacadeString(record.folderId) ||
      normalizePlatformFacadeString(record.collectionId) ||
      normalizePlatformFacadeString(record.playlistId) ||
      normalizePlatformFacadeString(record.keyword) ||
      'unknown',
    pageNum: normalizePlatformFacadePositiveInt(record.pageNum) || 1,
    pageSize:
      normalizePlatformFacadePositiveInt(record.pageSize) ||
      Math.max(1, items.length || normalizePlatformFacadePositiveInt(record.total)),
    total:
      normalizePlatformFacadePositiveInt(
        record.total ?? record.totalCount ?? record.itemCount ?? record.count
      ),
    hasMore:
      normalizePlatformFacadeBoolean(record.hasMore ?? record.more ?? record.hasNext) === true,
    items,
  };
}

function mapPreparedPlayback(
  value: unknown
): PlatformWorkspacePreparedPlayback | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;
  if (typeof record.data !== 'undefined') {
    const nested = mapPreparedPlayback(record.data);
    if (typeof nested !== 'undefined') {
      return nested;
    }
  }

  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  const streamUrl = normalizePlatformFacadeString(record.streamUrl);
  const cachePath = normalizePlatformFacadeString(record.cachePath);
  if (!sourceLocator || (!streamUrl && !cachePath)) return undefined;

  return {
    sourceLocator,
    streamUrl: streamUrl || undefined,
    cachePath: cachePath || undefined,
    mimeType: normalizePlatformFacadeString(record.mimeType) || undefined,
    durationSeconds: mapDurationSeconds(record),
    resourceId:
      normalizePlatformFacadeString(record.resourceId) ||
      normalizePlatformFacadeString(record.songId) ||
      normalizePlatformFacadeString(record.trackId) ||
      undefined,
    selectedQualityKey:
      normalizePlatformFacadeString(
        record.selectedQualityKey ?? record.qualityKey
      ) || undefined,
    selectedQualityLabel:
      normalizePlatformFacadeString(
        record.selectedQualityLabel ?? record.qualityLabel
      ) || undefined,
    contentKind: normalizePlatformFacadeString(record.contentKind) || undefined,
  };
}

function mapQualityOptions(value: unknown): PlatformWorkspaceQualityOption[] | undefined {
  const source = readArraySource(value, ['options', 'items', 'qualities']);
  if (!source) return undefined;

  return source
    .map(mapQualityOption)
    .filter((item): item is PlatformWorkspaceQualityOption => Boolean(item));
}

function mapQualityState(
  value: unknown
): PlatformWorkspaceQualityState | null | undefined {
  if (value === null) return null;

  if (Array.isArray(value)) {
    const options = value
      .map(mapQualityOption)
      .filter((item): item is PlatformWorkspaceQualityOption => Boolean(item));
    if (options.length < 1) return null;
    return {
      options,
      currentKey: options[0]?.key || 'auto',
      currentLabel: options[0]?.label || undefined,
    };
  }

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;
  if (typeof record.data !== 'undefined') {
    const nested = mapQualityState(record.data);
    if (typeof nested !== 'undefined') {
      return nested;
    }
  }

  const options = (
    Array.isArray(record.options)
      ? record.options
      : Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.qualities)
          ? record.qualities
        : []
  )
    .map(mapQualityOption)
    .filter((item): item is PlatformWorkspaceQualityOption => Boolean(item));
  const current = mapQualityOption(record.current);
  const currentKey = normalizePlatformFacadeString(
    current?.key ??
      record.currentKey ??
      record.key ??
      record.preferredKey ??
      record.selectedQualityKey
  );

  if (!currentKey && options.length < 1) {
    return null;
  }

  return {
    options,
    currentKey: currentKey || options[0]?.key || 'auto',
    currentLabel:
      normalizePlatformFacadeString(
        current?.label ?? record.currentLabel ?? record.label ?? record.selectedQualityLabel
      ) || undefined,
  };
}

function mapResolvedLyric(
  value: unknown
): PlatformWorkspaceLyricLocatorResolved | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  const locator = normalizePlatformFacadeString(record.locator);
  const format = normalizePlatformFacadeString(record.format);
  const sourceKind = normalizePlatformFacadeString(record.sourceKind);
  if (!locator || !format || !sourceKind) return undefined;

  return {
    locator,
    format,
    lang: normalizePlatformFacadeString(record.lang) || undefined,
    sourceKind,
  };
}

function mapCoverAssetUrl(value: unknown): string | undefined {
  const direct = normalizePlatformFacadeString(value);
  if (direct) return direct;

  const record = asPlatformFacadeRecord(value) as PlatformWorkspaceCoverAsset | null;
  if (!record) return undefined;

  return (
    normalizePlatformFacadeString(record.assetUrl) ||
    normalizePlatformFacadeString(record.cachePath) ||
    normalizePlatformFacadeString(record.path) ||
    normalizePlatformFacadeString(record.url) ||
    undefined
  );
}

export function createPlatformWorkspaceFeatureFlags(
  value?: Partial<PlatformWorkspaceFeatureFlags> | null
): PlatformWorkspaceFeatureFlags {
  return {
    collections: value?.collections === true,
    recommendations: value?.recommendations === true,
    search: value?.search === true,
    quality: value?.quality === true,
  };
}

export function createPlatformWorkspacePageModel(options?: {
  features?: Partial<PlatformWorkspaceFeatureFlags> | null;
  defaultPageId?: string | null;
  pages?: PlatformWorkspacePageItem[] | null;
}): PlatformWorkspacePageModel {
  return {
    features: createPlatformWorkspaceFeatureFlags(options?.features),
    defaultPageId: normalizePlatformFacadeString(options?.defaultPageId) || undefined,
    pages: Array.isArray(options?.pages) ? options.pages : [],
  };
}

function mapWorkspaceFeatureFlags(value: unknown): PlatformWorkspaceFeatureFlags | undefined {
  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  return createPlatformWorkspaceFeatureFlags({
    collections:
      normalizePlatformFacadeBoolean(record.collections ?? record.playlists ?? record.library) ===
      true,
    recommendations:
      normalizePlatformFacadeBoolean(
        record.recommendations ?? record.dailyRecommendations ?? record.daily
      ) === true,
    search: normalizePlatformFacadeBoolean(record.search) === true,
    quality: normalizePlatformFacadeBoolean(record.quality) === true,
  });
}

function mapPageItem(value: unknown): PlatformWorkspacePageItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const pageId =
    normalizePlatformFacadeString(record.pageId ?? record.id ?? record.key ?? record.pageKey) ||
    undefined;
  const kind =
    normalizePlatformFacadeString(record.kind ?? record.type ?? record.pageType) || undefined;
  const title =
    normalizePlatformFacadeString(record.title ?? record.label ?? record.name) || undefined;
  if (!pageId || !kind || !title) {
    return null;
  }

  return {
    pageId,
    kind,
    title,
    enabled: normalizePlatformFacadeBoolean(record.enabled ?? record.visible) !== false,
    subtitle:
      normalizePlatformFacadeString(record.subtitle ?? record.description) || undefined,
    badgeLabel:
      normalizePlatformFacadeString(record.badgeLabel ?? record.badge ?? record.tag) || undefined,
    iconKey: normalizePlatformFacadeString(record.iconKey ?? record.icon) || undefined,
  };
}

function mapPageList(value: unknown): PlatformWorkspacePageListResult | undefined {
  const source = readArraySource(value, ['pages', 'items']);
  if (!source) return undefined;

  return {
    items: source
      .map(mapPageItem)
      .filter((item): item is PlatformWorkspacePageItem => Boolean(item)),
  };
}

function mapPageModel(value: unknown): PlatformWorkspacePageModel | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;
  if (typeof record.data !== 'undefined') {
    const nested = mapPageModel(record.data);
    if (typeof nested !== 'undefined') {
      return nested;
    }
  }

  const features =
    mapWorkspaceFeatureFlags(record.features) ??
    mapWorkspaceFeatureFlags(record.capabilities) ??
    mapWorkspaceFeatureFlags(record);
  const pages = mapPageList(record)?.items ?? [];
  const defaultPageId =
    normalizePlatformFacadeString(record.defaultPageId ?? record.initialPageId) || undefined;

  if (!features && pages.length < 1 && !defaultPageId) {
    return undefined;
  }

  return createPlatformWorkspacePageModel({
    features,
    defaultPageId,
    pages,
  });
}

export async function listPlatformWorkspaceCollections(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceCollectionItem[]> {
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceCollectionItem[]>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listCollections',
    payload: {
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'library',
    map: mapCollectionArray,
  });
}

export async function listPlatformWorkspaceCollectionResources(options: {
  connectorId: PlatformConnectorId;
  collectionId: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceResourcePage | null> {
  const collectionId = normalizePlatformFacadeString(options.collectionId);
  if (!collectionId) return null;

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceResourcePage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listPlaylistTracks',
    payload: {
      collectionId,
      playlistId: collectionId,
      folderId: collectionId,
      pageNum: options.pageNum,
      pageSize: options.pageSize,
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['listPlaylistTracks', 'listResources'],
    map: mapResourcePage,
  });
}

export async function listPlatformWorkspaceRecommendedCollections(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceCollectionItem[]> {
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceCollectionItem[]>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    method: 'listRecommendedPlaylists',
    payload: {
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'recommendations',
    map: mapCollectionArray,
  });
}

export async function listPlatformWorkspaceRecommendedResources(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceResourcePage | null> {
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceResourcePage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    method: 'listDaily',
    payload: {
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'recommendations',
    map: mapResourcePage,
  });
}

export async function searchPlatformWorkspaceResources(options: {
  connectorId: PlatformConnectorId;
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceResourcePage | null> {
  const keyword = normalizePlatformFacadeString(options.keyword);
  if (!keyword) return null;

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceResourcePage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_SEARCH_BINDING_ID,
    method: 'query',
    payload: {
      keyword,
      query: keyword,
      pageNum: options.pageNum,
      pageSize: options.pageSize,
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'search',
    map: mapResourcePage,
  });
}

export async function resolvePlatformWorkspaceResource(options: {
  connectorId: PlatformConnectorId;
  query: string;
  instanceId?: string | null;
}): Promise<PlatformWorkspaceResourceItem | null> {
  const query = normalizePlatformFacadeString(options.query);
  if (!query) return null;

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceResourceItem | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_SEARCH_BINDING_ID,
    method: 'resolveLocator',
    payload: {
      query,
      keyword: query,
      resourceId: query,
      songId: query,
      bvid: query,
    },
    runtimeBucket: 'search',
    map: (value) => {
      if (value === null) return null;
      const record = asPlatformFacadeRecord(value);
      if (!record) return undefined;
      if (record.item === null) return null;
      return mapResourceItem(record.item ?? value) ?? undefined;
    },
  });
}

export async function preparePlatformWorkspacePlayback(options: {
  connectorId: PlatformConnectorId;
  sourceLocator: string;
  qualityHint?: string;
  resourceId?: string;
  webUrl?: string;
  instanceId?: string | null;
}): Promise<PlatformWorkspacePreparedPlayback | null> {
  const sourceLocator = normalizePlatformFacadeString(options.sourceLocator);
  if (!sourceLocator) return null;

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspacePreparedPlayback | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'preparePlayback',
    payload: {
      sourceLocator,
      qualityHint: normalizePlatformFacadeString(options.qualityHint) || undefined,
      resourceId: normalizePlatformFacadeString(options.resourceId) || undefined,
      webUrl: normalizePlatformFacadeString(options.webUrl) || undefined,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['preparePlayback'],
    map: mapPreparedPlayback,
  });
}

export async function listPlatformWorkspaceQualityState(options: {
  connectorId: PlatformConnectorId;
  sourceLocator?: string | null;
  instanceId?: string | null;
  forceRefresh?: boolean;
}): Promise<PlatformWorkspaceQualityState | null> {
  const sourceLocator = normalizePlatformFacadeString(options.sourceLocator);
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceQualityState | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_QUALITY_BINDING_ID,
    method: 'listOptions',
    payload: {
      sourceLocator: sourceLocator || undefined,
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'quality',
    runtimeMethods: ['listOptions', 'getCurrent'],
    map: mapQualityState,
  });
}

export async function listPlatformWorkspaceQualityOptions(options: {
  connectorId: PlatformConnectorId;
  sourceLocator: string;
  instanceId?: string | null;
}): Promise<PlatformWorkspaceQualityOption[]> {
  const sourceLocator = normalizePlatformFacadeString(options.sourceLocator);
  if (!sourceLocator) return [];

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceQualityOption[]>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_QUALITY_BINDING_ID,
    method: 'listOptions',
    payload: {
      sourceLocator,
    },
    runtimeBucket: 'quality',
    map: mapQualityOptions,
  });
}

export async function setPlatformWorkspaceQualityPreference(options: {
  connectorId: PlatformConnectorId;
  qualityKey: string;
  sourceLocator?: string | null;
  instanceId?: string | null;
}): Promise<PlatformWorkspaceQualityState | null> {
  const qualityKey = normalizePlatformFacadeString(options.qualityKey);
  if (!qualityKey) return null;

  const sourceLocator = normalizePlatformFacadeString(options.sourceLocator);
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceQualityState | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_QUALITY_BINDING_ID,
    method: 'setPreferred',
    payload: {
      qualityKey,
      key: qualityKey,
      qualityHint: qualityKey,
      sourceLocator: sourceLocator || undefined,
    },
    runtimeBucket: 'quality',
    runtimeMethods: ['setPreferred'],
    map: mapQualityState,
  });
}

export async function listPlatformWorkspacePages(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
}): Promise<PlatformWorkspacePageItem[]> {
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspacePageItem[]>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_PAGES_BINDING_ID,
    method: 'listPages',
    payload: {},
    runtimeBucket: 'pages',
    runtimeMethods: ['listPages'],
    map: (value) => mapPageList(value)?.items,
  });
}

export async function getPlatformWorkspacePageModel(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
}): Promise<PlatformWorkspacePageModel | null> {
  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspacePageModel | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_PAGES_BINDING_ID,
    method: 'getWorkspaceModel',
    payload: {},
    runtimeBucket: 'pages',
    runtimeMethods: ['getWorkspaceModel'],
    map: mapPageModel,
  });
}

export async function resolvePlatformWorkspaceLyricLocator(options: {
  connectorId: PlatformConnectorId;
  lyricLocator: string;
  instanceId?: string | null;
}): Promise<PlatformWorkspaceLyricLocatorResolved | null> {
  const lyricLocator = normalizePlatformFacadeString(options.lyricLocator);
  if (!lyricLocator) return null;

  const call = createWorkspaceCaller(options.connectorId);
  return call<PlatformWorkspaceLyricLocatorResolved | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'resolveLyricLocator',
    payload: {
      lyricLocator,
    },
    runtimeBucket: 'library',
    map: mapResolvedLyric,
  });
}

export async function resolvePlatformWorkspaceCoverAssetUrl(options: {
  connectorId: PlatformConnectorId;
  coverUrl?: string | null;
  instanceId?: string | null;
}): Promise<string | undefined> {
  const coverUrl = normalizePlatformFacadeString(options.coverUrl);
  if (!coverUrl) return undefined;

  const call = createWorkspaceCaller(options.connectorId);
  const resolved = await call<string>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'resolveCoverAssetUrl',
    payload: {
      coverUrl,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['resolveCoverAssetUrl', 'prepareCoverCache'],
    map: (value) => mapCoverAssetUrl(value) ?? coverUrl,
  });

  return (await normalizePlatformFacadeAssetUrl(resolved)) ?? coverUrl;
}
