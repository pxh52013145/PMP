import type { PlatformConnectorId } from './connectorAuth';
import { getPlatformConnectorDefinition } from './connectorAuth';
import {
  PLATFORM_LIBRARY_BINDING_ID,
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

export interface PlatformWorkspaceCollectionItem {
  collectionId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface PlatformWorkspaceResourceItem {
  resourceId: string;
  title: string;
  sourceLocator: string;
  durationSeconds?: number;
  coverUrl?: string;
  lyricLocator?: string;
  ownerName?: string;
  artistNames?: string;
  albumName?: string;
  webUrl?: string;
  vipRequired?: boolean;
  vipLabel?: string;
  qualityKey?: string;
  qualityLabel?: string;
  tagLabels?: string[];
  bvid?: string;
  cid?: string;
  contentKind?: string;
}

export interface PlatformWorkspaceResourcePage {
  sourceKind: string;
  sourceId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: PlatformWorkspaceResourceItem[];
}

export interface PlatformWorkspacePreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  resourceId?: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
  contentKind?: string;
}

export interface PlatformWorkspaceQualityOption {
  key: string;
  label: string;
  available: boolean;
}

export interface PlatformWorkspaceQualityState {
  options: PlatformWorkspaceQualityOption[];
  currentKey: string;
  currentLabel?: string;
}

export interface PlatformWorkspaceLyricLocatorResolved {
  locator: string;
  format: string;
  lang?: string;
  sourceKind: string;
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

function mapCollectionItem(value: unknown): PlatformWorkspaceCollectionItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const collectionId =
    normalizePlatformFacadeString(record.collectionId) ||
    normalizePlatformFacadeString(record.playlistId) ||
    normalizePlatformFacadeString(record.folderId);
  const title = normalizePlatformFacadeString(
    record.title ?? record.name ?? record.label
  );
  if (!collectionId || !title) return null;

  return {
    collectionId,
    title,
    trackCount: normalizePlatformFacadePositiveInt(
      record.trackCount ?? record.mediaCount ?? record.count ?? record.total
    ),
    coverUrl:
      normalizePlatformFacadeString(
        record.coverUrl ?? record.imageUrl ?? record.cover
      ) || undefined,
    updatedAtMs: readPlatformFacadeFiniteNumber(record.updatedAtMs),
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
    record.key ?? record.qualityKey ?? record.id
  );
  if (!key) return null;

  return {
    key,
    label:
      normalizePlatformFacadeString(record.label ?? record.title ?? key) || key,
    available: record.available !== false,
  };
}

function mapResourceItem(value: unknown): PlatformWorkspaceResourceItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const resourceId =
    normalizePlatformFacadeString(record.resourceId) ||
    normalizePlatformFacadeString(record.songId);
  const title = normalizePlatformFacadeString(record.title);
  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  if (!resourceId || !title || !sourceLocator) return null;

  const qualityKey =
    normalizePlatformFacadeString(
      record.qualityKey ??
        record.selectedQualityKey ??
        record.audioQualityKey ??
        record.soundQualityKey
    ) || undefined;
  const qualityLabel =
    normalizePlatformFacadeString(
      record.qualityLabel ??
        record.selectedQualityLabel ??
        record.audioQualityLabel ??
        record.soundQualityLabel
    ) || undefined;
  const vipLabel =
    normalizePlatformFacadeString(
      record.vipLabel ??
        record.vipBadge ??
        record.membershipLabel ??
        record.accessLabel
    ) || undefined;
  const tagLabels = (
    Array.isArray(record.tagLabels)
      ? record.tagLabels
      : Array.isArray(record.tags)
        ? record.tags
        : Array.isArray(record.badges)
          ? record.badges
          : Array.isArray(record.labels)
            ? record.labels
            : []
  )
    .map(mapTagLabel)
    .filter(
      (item, index, array): item is string =>
        Boolean(item) && array.indexOf(item) === index
    );

  return {
    resourceId,
    title,
    sourceLocator,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    coverUrl: normalizePlatformFacadeString(record.coverUrl) || undefined,
    lyricLocator: normalizePlatformFacadeString(record.lyricLocator) || undefined,
    ownerName: normalizePlatformFacadeString(record.ownerName) || undefined,
    artistNames:
      normalizePlatformFacadeString(record.artistNames ?? record.ownerName) || undefined,
    albumName: normalizePlatformFacadeString(record.albumName) || undefined,
    webUrl:
      normalizePlatformFacadeString(record.webUrl) ||
      normalizePlatformFacadeString(record.sourceLocator) ||
      undefined,
    vipRequired:
      record.vipRequired === true ||
      record.requiresVip === true ||
      record.needVip === true ||
      record.vip === true ||
      record.membersOnly === true,
    vipLabel,
    qualityKey,
    qualityLabel,
    tagLabels: tagLabels.length > 0 ? tagLabels : undefined,
    bvid: normalizePlatformFacadeString(record.bvid) || undefined,
    cid: normalizePlatformFacadeString(record.cid) || undefined,
    contentKind: normalizePlatformFacadeString(record.contentKind) || undefined,
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

  const sourceItems = readArraySource(record, ['items', 'resources', 'tracks']);
  if (!sourceItems) return undefined;

  const items = sourceItems
    .map(mapResourceItem)
    .filter((item): item is PlatformWorkspaceResourceItem => Boolean(item));

  return {
    sourceKind: normalizePlatformFacadeString(record.sourceKind) || 'unknown',
    sourceId:
      normalizePlatformFacadeString(record.sourceId) ||
      normalizePlatformFacadeString(record.folderId) ||
      normalizePlatformFacadeString(record.collectionId) ||
      'unknown',
    pageNum: normalizePlatformFacadePositiveInt(record.pageNum) || 1,
    pageSize:
      normalizePlatformFacadePositiveInt(record.pageSize) ||
      Math.max(1, items.length || normalizePlatformFacadePositiveInt(record.total)),
    total: normalizePlatformFacadePositiveInt(record.total),
    hasMore: record.hasMore === true,
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
  if (!sourceLocator || !streamUrl || !cachePath) return undefined;

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizePlatformFacadeString(record.mimeType) || undefined,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    resourceId:
      normalizePlatformFacadeString(record.resourceId) ||
      normalizePlatformFacadeString(record.songId) ||
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
  const source = readArraySource(value, ['options', 'items']);
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
        : []
  )
    .map(mapQualityOption)
    .filter((item): item is PlatformWorkspaceQualityOption => Boolean(item));
  const current = mapQualityOption(record.current);
  const currentKey = normalizePlatformFacadeString(
    current?.key ?? record.currentKey ?? record.key ?? record.preferredKey
  );

  if (!currentKey && options.length < 1) {
    return null;
  }

  return {
    options,
    currentKey: currentKey || options[0]?.key || 'auto',
    currentLabel:
      normalizePlatformFacadeString(
        current?.label ?? record.currentLabel ?? record.label
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

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  return (
    normalizePlatformFacadeString(record.assetUrl) ||
    normalizePlatformFacadeString(record.cachePath) ||
    normalizePlatformFacadeString(record.path) ||
    normalizePlatformFacadeString(record.url) ||
    undefined
  );
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
    map: (value) => {
      const arrayValue = readArraySource(value, [
        'items',
        'collections',
        'playlists',
        'folders',
      ]);
      if (!arrayValue) return undefined;
      return arrayValue
        .map(mapCollectionItem)
        .filter((item): item is PlatformWorkspaceCollectionItem => Boolean(item));
    },
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
    map: (value) => {
      const arrayValue = readArraySource(value, [
        'collections',
        'recommendedCollections',
        'items',
      ]);
      if (!arrayValue) return undefined;
      return arrayValue
        .map(mapCollectionItem)
        .filter((item): item is PlatformWorkspaceCollectionItem => Boolean(item));
    },
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
