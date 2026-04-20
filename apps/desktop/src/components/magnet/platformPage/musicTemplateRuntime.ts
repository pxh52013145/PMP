import type {
  PlatformCompatRegistryRecord,
  PlatformConnectorId,
  PlatformWorkspaceFeatureFlags,
  PlatformWorkspacePageModel,
} from '../../../modules/music-platform';
import {
  clonePlatformWorkspaceCollectionItems,
  clonePlatformWorkspacePreparedPlayback,
  clonePlatformWorkspaceQualityState,
  clonePlatformWorkspaceResourcePage,
  createPlatformWorkspacePageModel,
  getPlatformWorkspacePageModel,
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceQualityState,
  listPlatformWorkspaceRecommendedCollections,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  searchPlatformWorkspaceResources,
  setPlatformWorkspaceQualityPreference,
  type PlatformWorkspaceCollectionItem,
  type PlatformWorkspacePreparedPlayback,
  type PlatformWorkspaceQualityState,
  type PlatformWorkspaceResourceItem,
  type PlatformWorkspaceResourcePage,
} from '../../../modules/music-platform';

export type MusicTemplateCollectionItem = PlatformWorkspaceCollectionItem;
export type MusicTemplateResourceItem = PlatformWorkspaceResourceItem;
export type MusicTemplateResourcePage = PlatformWorkspaceResourcePage;
export type MusicTemplatePreparedPlayback = PlatformWorkspacePreparedPlayback;

export interface MusicTemplateRecommendationsResult {
  page: MusicTemplateResourcePage | null;
  collections: MusicTemplateCollectionItem[];
}

export type MusicTemplatePlaybackQualityOption = PlatformWorkspaceQualityState['options'][number];
export type MusicTemplatePlaybackQualityState = PlatformWorkspaceQualityState;
export type MusicTemplatePlaybackQualityKey =
  | 'auto'
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless';

export type MusicTemplateWorkspaceModel = PlatformWorkspacePageModel;

export interface MusicTemplateWorkspaceCapabilities {
  collections: boolean;
  recommendations: boolean;
  search: boolean;
  quality: boolean;
  defaultPageId?: string;
  enabledPageIds: string[];
  enabledPageKinds: string[];
}

export interface MusicTemplateRuntimeTarget {
  connectorId: string;
  displayName: string;
  instanceId: string | null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeConnectorId(value: string): PlatformConnectorId | null {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

const MUSIC_TEMPLATE_COLLECTION_PAGE_KINDS = new Set([
  'library',
  'collection',
  'collections',
  'playlist',
  'playlists',
  'favorites',
  'folder',
  'folders',
]);
const MUSIC_TEMPLATE_RECOMMENDATION_PAGE_KINDS = new Set([
  'recommended',
  'recommendations',
  'daily',
]);
const MUSIC_TEMPLATE_SEARCH_PAGE_KINDS = new Set(['search']);
const MUSIC_TEMPLATE_QUALITY_PAGE_KINDS = new Set(['quality']);

export function normalizeMusicTemplateQualityKey(
  value: string
): MusicTemplatePlaybackQualityKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'standard' || normalized === '128k') return 'standard';
  if (normalized === 'higher' || normalized === '192k') return 'higher';
  if (normalized === 'exhigh' || normalized === '320k') return 'exhigh';
  if (normalized === 'lossless' || normalized === '999k') return 'lossless';
  return 'auto';
}

export function resolveMusicTemplateQualityLabelKey(value: string): string {
  switch (normalizeMusicTemplateQualityKey(value)) {
    case 'standard':
      return 'magnet.platform.music-template.quality.option.standard';
    case 'higher':
      return 'magnet.platform.music-template.quality.option.higher';
    case 'exhigh':
      return 'magnet.platform.music-template.quality.option.exhigh';
    case 'lossless':
      return 'magnet.platform.music-template.quality.option.lossless';
    default:
      return 'magnet.platform.music-template.quality.option.auto';
  }
}

export function resolveMusicTemplateWorkspaceCapabilities(
  model: MusicTemplateWorkspaceModel
): MusicTemplateWorkspaceCapabilities {
  const enabledPages = model.pages.filter((page) => page.enabled !== false);
  const enabledPageIds = enabledPages
    .map((page) => normalizeString(page.pageId))
    .filter((pageId, index, pageIds): pageId is string => Boolean(pageId) && pageIds.indexOf(pageId) === index);
  const enabledPageKinds = enabledPages
    .map((page) => normalizeString(page.kind).toLowerCase())
    .filter(
      (pageKind, index, pageKinds): pageKind is string =>
        Boolean(pageKind) && pageKinds.indexOf(pageKind) === index
    );
  const enabledPageKindSet = new Set(enabledPageKinds);

  return {
    collections:
      model.features.collections ||
      [...MUSIC_TEMPLATE_COLLECTION_PAGE_KINDS].some((pageKind) => enabledPageKindSet.has(pageKind)),
    recommendations:
      model.features.recommendations ||
      [...MUSIC_TEMPLATE_RECOMMENDATION_PAGE_KINDS].some((pageKind) =>
        enabledPageKindSet.has(pageKind)
      ),
    search:
      model.features.search ||
      [...MUSIC_TEMPLATE_SEARCH_PAGE_KINDS].some((pageKind) => enabledPageKindSet.has(pageKind)),
    quality:
      model.features.quality ||
      [...MUSIC_TEMPLATE_QUALITY_PAGE_KINDS].some((pageKind) => enabledPageKindSet.has(pageKind)),
    defaultPageId: normalizeString(model.defaultPageId) || undefined,
    enabledPageIds,
    enabledPageKinds,
  };
}

export function resolveMusicTemplateQualityProbeSourceLocator(
  page: MusicTemplateResourcePage | null
): string | null {
  if (!page) return null;
  for (const item of page.items) {
    const sourceLocator = normalizeString(item.sourceLocator);
    if (sourceLocator) return sourceLocator;
  }
  return null;
}

export function mergeMusicTemplateResourcePages(
  previous: MusicTemplateResourcePage | null,
  next: MusicTemplateResourcePage
): MusicTemplateResourcePage {
  if (!previous || previous.sourceKind !== next.sourceKind || previous.sourceId !== next.sourceId) {
    return clonePlatformWorkspaceResourcePage(next) ?? next;
  }

  const seen = new Set(previous.items.map((item) => item.resourceId));
  const items = previous.items.map((item) => ({ ...item }));
  for (const item of next.items) {
    if (seen.has(item.resourceId)) continue;
    seen.add(item.resourceId);
    items.push({ ...item });
  }

  return {
    ...next,
    items,
  };
}

function resolveWorkspaceTarget(
  target: MusicTemplateRuntimeTarget
): { connectorId: PlatformConnectorId; instanceId?: string | null } | null {
  const connectorId = normalizeConnectorId(target.connectorId);
  if (!connectorId) return null;
  const instanceId = normalizeString(target.instanceId);
  return {
    connectorId,
    instanceId: instanceId || undefined,
  };
}

function createMusicTemplateWorkspaceFallbackFeatures(
  contractRecord?: PlatformCompatRegistryRecord | null
): PlatformWorkspaceFeatureFlags {
  return {
    collections: contractRecord?.contract.capabilities.playlists === true,
    recommendations: contractRecord?.contract.capabilities.dailyRecommendations === true,
    search: contractRecord?.contract.capabilities.search === true,
    quality: contractRecord?.contract.capabilities.quality === true,
  };
}

export function createMusicTemplateWorkspaceFallbackModel(
  contractRecord?: PlatformCompatRegistryRecord | null
): MusicTemplateWorkspaceModel {
  return createPlatformWorkspacePageModel({
    features: createMusicTemplateWorkspaceFallbackFeatures(contractRecord),
  });
}

function withMusicTemplateResourcePageFallback(
  page: PlatformWorkspaceResourcePage | null,
  fallback: Partial<Omit<MusicTemplateResourcePage, 'items'>> = {}
): MusicTemplateResourcePage | null {
  const cloned = clonePlatformWorkspaceResourcePage(page);
  if (!cloned) return null;

  const sourceKind = normalizeString(cloned.sourceKind);
  const sourceId = normalizeString(cloned.sourceId);
  return {
    ...cloned,
    sourceKind:
      (sourceKind && sourceKind !== 'unknown'
        ? sourceKind
        : normalizeString(fallback.sourceKind)) || 'runtime',
    sourceId:
      (sourceId && sourceId !== 'unknown'
        ? sourceId
        : normalizeString(fallback.sourceId)) || 'runtime',
    pageNum:
      normalizePositiveInt(cloned.pageNum) || normalizePositiveInt(fallback.pageNum) || 1,
    pageSize:
      normalizePositiveInt(cloned.pageSize) ||
      normalizePositiveInt(fallback.pageSize) ||
      Math.max(1, cloned.items.length),
    total:
      normalizePositiveInt(cloned.total) ||
      normalizePositiveInt(fallback.total) ||
      cloned.items.length,
    hasMore: cloned.hasMore === true || fallback.hasMore === true,
  };
}

function withMusicTemplatePreparedPlaybackFallback(
  prepared: PlatformWorkspacePreparedPlayback | null,
  item: MusicTemplateResourceItem
): MusicTemplatePreparedPlayback | null {
  const cloned = clonePlatformWorkspacePreparedPlayback(prepared);
  if (!cloned) return null;

  const streamUrl = normalizeString(cloned.streamUrl);
  const cachePath = normalizeString(cloned.cachePath);
  if (!streamUrl || !cachePath) {
    return null;
  }

  return {
    sourceLocator: normalizeString(cloned.sourceLocator) || item.sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizeString(cloned.mimeType) || undefined,
    durationSeconds:
      typeof cloned.durationSeconds === 'number' && Number.isFinite(cloned.durationSeconds)
        ? cloned.durationSeconds
        : undefined,
    resourceId: normalizeString(cloned.resourceId) || item.resourceId,
    selectedQualityKey: normalizeString(cloned.selectedQualityKey) || undefined,
    selectedQualityLabel: normalizeString(cloned.selectedQualityLabel) || undefined,
  };
}

function withMusicTemplateQualityStateFallback(
  state: PlatformWorkspaceQualityState | null
): MusicTemplatePlaybackQualityState | null {
  const cloned = clonePlatformWorkspaceQualityState(state);
  if (!cloned) return null;

  const currentKey = normalizeString(cloned.currentKey);
  return {
    ...cloned,
    currentKey: currentKey || cloned.options[0]?.key || 'auto',
    currentLabel: normalizeString(cloned.currentLabel) || undefined,
  };
}

export async function listMusicTemplateCollections(
  target: MusicTemplateRuntimeTarget,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateCollectionItem[]> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return [];

  const collections = await listPlatformWorkspaceCollections({
    connectorId: workspaceTarget.connectorId,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  return clonePlatformWorkspaceCollectionItems(collections);
}

export async function listMusicTemplateRecommendations(
  target: MusicTemplateRuntimeTarget,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateRecommendationsResult> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) {
    return {
      page: null,
      collections: [],
    };
  }

  const [resourcePage, collections] = await Promise.all([
    listPlatformWorkspaceRecommendedResources({
      connectorId: workspaceTarget.connectorId,
      instanceId: workspaceTarget.instanceId,
      forceRefresh: options?.forceRefresh === true,
    }),
    listPlatformWorkspaceRecommendedCollections({
      connectorId: workspaceTarget.connectorId,
      instanceId: workspaceTarget.instanceId,
      forceRefresh: options?.forceRefresh === true,
    }),
  ]);

  return {
    page: withMusicTemplateResourcePageFallback(resourcePage, {
      sourceKind: 'recommended',
      sourceId: 'recommended',
    }),
    collections: clonePlatformWorkspaceCollectionItems(collections),
  };
}

export async function listMusicTemplateCollectionResources(
  target: MusicTemplateRuntimeTarget,
  collectionId: string,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateResourcePage | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedCollectionId = normalizeString(collectionId);
  if (!workspaceTarget || !normalizedCollectionId) return null;

  const resourcePage = await listPlatformWorkspaceCollectionResources({
    connectorId: workspaceTarget.connectorId,
    collectionId: normalizedCollectionId,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });

  return withMusicTemplateResourcePageFallback(resourcePage, {
    sourceKind: 'user-playlist',
    sourceId: normalizedCollectionId,
  });
}

export async function searchMusicTemplateResources(
  target: MusicTemplateRuntimeTarget,
  options: {
    keyword: string;
    pageNum?: number;
    pageSize?: number;
    forceRefresh?: boolean;
  }
): Promise<MusicTemplateResourcePage | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const keyword = normalizeString(options.keyword);
  if (!workspaceTarget || !keyword) return null;

  const pageNum = normalizePositiveInt(options.pageNum) || 1;
  const pageSize = normalizePositiveInt(options.pageSize) || 40;

  const resourcePage = await searchPlatformWorkspaceResources({
    connectorId: workspaceTarget.connectorId,
    keyword,
    pageNum,
    pageSize,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options.forceRefresh === true,
  });

  return withMusicTemplateResourcePageFallback(resourcePage, {
    sourceKind: 'search',
    sourceId: keyword,
    pageNum,
    pageSize,
  });
}

export async function getMusicTemplateWorkspaceModel(
  target: MusicTemplateRuntimeTarget,
  options?: {
    contractRecord?: PlatformCompatRegistryRecord | null;
  }
): Promise<MusicTemplateWorkspaceModel> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const fallbackModel = createMusicTemplateWorkspaceFallbackModel(options?.contractRecord);
  if (!workspaceTarget) {
    return fallbackModel;
  }

  try {
    const pageModel = await getPlatformWorkspacePageModel({
      connectorId: workspaceTarget.connectorId,
      instanceId: workspaceTarget.instanceId,
    });
    return pageModel ?? fallbackModel;
  } catch {
    return fallbackModel;
  }
}

export async function getMusicTemplatePlaybackQualityState(
  target: MusicTemplateRuntimeTarget,
  options?: {
    sourceLocator?: string | null;
    forceRefresh?: boolean;
  }
): Promise<MusicTemplatePlaybackQualityState | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return null;

  const qualityState = await listPlatformWorkspaceQualityState({
    connectorId: workspaceTarget.connectorId,
    sourceLocator: normalizeString(options?.sourceLocator) || undefined,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });

  return withMusicTemplateQualityStateFallback(qualityState);
}

export async function setMusicTemplatePlaybackQualityPreference(
  target: MusicTemplateRuntimeTarget,
  qualityKey: string,
  options?: {
    sourceLocator?: string | null;
  }
): Promise<MusicTemplatePlaybackQualityState | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedQualityKey = normalizeString(qualityKey);
  if (!workspaceTarget || !normalizedQualityKey) return null;

  const qualityState = await setPlatformWorkspaceQualityPreference({
    connectorId: workspaceTarget.connectorId,
    qualityKey: normalizedQualityKey,
    sourceLocator: normalizeString(options?.sourceLocator) || undefined,
    instanceId: workspaceTarget.instanceId,
  });

  return withMusicTemplateQualityStateFallback(qualityState);
}

export async function prepareMusicTemplatePlayback(
  target: MusicTemplateRuntimeTarget,
  item: MusicTemplateResourceItem,
  options?: {
    qualityHint?: string | null;
  }
): Promise<MusicTemplatePreparedPlayback | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return null;

  const prepared = await preparePlatformWorkspacePlayback({
    connectorId: workspaceTarget.connectorId,
    sourceLocator: item.sourceLocator,
    qualityHint: normalizeString(options?.qualityHint) || undefined,
    resourceId: item.resourceId,
    webUrl: item.webUrl,
    instanceId: workspaceTarget.instanceId,
  });

  return withMusicTemplatePreparedPlaybackFallback(prepared, item);
}
