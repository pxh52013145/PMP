import type { PlatformConnectorId } from '../../../modules/music-platform';
import {
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

export interface MusicTemplateCollectionItem {
  collectionId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface MusicTemplateResourceItem {
  resourceId: string;
  title: string;
  artistNames: string;
  albumName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  vipRequired?: boolean;
  vipLabel?: string;
  qualityKey?: string;
  qualityLabel?: string;
  tagLabels?: string[];
  sourceLocator: string;
  webUrl: string;
}

export interface MusicTemplateResourcePage {
  sourceKind: string;
  sourceId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: MusicTemplateResourceItem[];
}

export interface MusicTemplatePreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  resourceId?: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
}

export interface MusicTemplateRecommendationsResult {
  page: MusicTemplateResourcePage | null;
  collections: MusicTemplateCollectionItem[];
}

export interface MusicTemplatePlaybackQualityOption {
  key: string;
  label?: string;
  available: boolean;
}

export interface MusicTemplatePlaybackQualityState {
  options: MusicTemplatePlaybackQualityOption[];
  currentKey: string;
  currentLabel?: string;
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

function mapTagLabels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped = value
    .map((item) => normalizeString(item))
    .filter(
      (item, index, array): item is string =>
        Boolean(item) && array.indexOf(item) === index
    );
  return mapped.length > 0 ? mapped : undefined;
}

function mapWorkspaceCollectionItem(
  value: PlatformWorkspaceCollectionItem
): MusicTemplateCollectionItem {
  return {
    collectionId: value.collectionId,
    title: value.title,
    trackCount: value.trackCount,
    coverUrl: value.coverUrl,
    updatedAtMs: value.updatedAtMs,
  };
}

function mapWorkspaceResourceItem(
  value: PlatformWorkspaceResourceItem
): MusicTemplateResourceItem | null {
  const resourceId = normalizeString(value.resourceId);
  const title = normalizeString(value.title);
  const sourceLocator = normalizeString(value.sourceLocator);
  if (!resourceId || !title || !sourceLocator) {
    return null;
  }

  return {
    resourceId,
    title,
    artistNames:
      normalizeString(value.artistNames) ||
      normalizeString(value.ownerName) ||
      '',
    albumName: normalizeString(value.albumName) || undefined,
    durationSeconds:
      typeof value.durationSeconds === 'number' &&
      Number.isFinite(value.durationSeconds)
        ? value.durationSeconds
        : undefined,
    coverUrl: normalizeString(value.coverUrl) || undefined,
    vipRequired: value.vipRequired === true,
    vipLabel: normalizeString(value.vipLabel) || undefined,
    qualityKey: normalizeString(value.qualityKey) || undefined,
    qualityLabel: normalizeString(value.qualityLabel) || undefined,
    tagLabels: mapTagLabels(value.tagLabels),
    sourceLocator,
    webUrl: normalizeString(value.webUrl),
  };
}

function mapWorkspaceResourcePage(
  page: PlatformWorkspaceResourcePage | null,
  fallback: Partial<Omit<MusicTemplateResourcePage, 'items'>> = {}
): MusicTemplateResourcePage | null {
  if (!page) return null;

  const items = page.items
    .map(mapWorkspaceResourceItem)
    .filter((item): item is MusicTemplateResourceItem => Boolean(item));

  return {
    sourceKind: normalizeString(page.sourceKind || fallback.sourceKind) || 'runtime',
    sourceId: normalizeString(page.sourceId || fallback.sourceId) || 'runtime',
    pageNum:
      normalizePositiveInt(page.pageNum) ||
      normalizePositiveInt(fallback.pageNum) ||
      1,
    pageSize:
      normalizePositiveInt(page.pageSize) ||
      normalizePositiveInt(fallback.pageSize) ||
      Math.max(1, items.length),
    total:
      normalizePositiveInt(page.total) ||
      normalizePositiveInt(fallback.total) ||
      items.length,
    hasMore:
      typeof page.hasMore === 'boolean'
        ? page.hasMore
        : fallback.hasMore === true,
    items,
  };
}

function mapWorkspacePreparedPlayback(
  prepared: PlatformWorkspacePreparedPlayback | null,
  item: MusicTemplateResourceItem
): MusicTemplatePreparedPlayback | null {
  if (!prepared) return null;

  const streamUrl = normalizeString(prepared.streamUrl);
  const cachePath = normalizeString(prepared.cachePath);
  if (!streamUrl || !cachePath) {
    return null;
  }

  return {
    sourceLocator:
      normalizeString(prepared.sourceLocator) || item.sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizeString(prepared.mimeType) || undefined,
    durationSeconds:
      typeof prepared.durationSeconds === 'number' &&
      Number.isFinite(prepared.durationSeconds)
        ? prepared.durationSeconds
        : undefined,
    resourceId: normalizeString(prepared.resourceId) || item.resourceId,
    selectedQualityKey:
      normalizeString(prepared.selectedQualityKey) || undefined,
    selectedQualityLabel:
      normalizeString(prepared.selectedQualityLabel) || undefined,
  };
}

function mapWorkspacePlaybackQualityState(
  state: PlatformWorkspaceQualityState | null
): MusicTemplatePlaybackQualityState | null {
  if (!state) return null;

  const options: MusicTemplatePlaybackQualityOption[] = [];
  for (const item of state.options) {
    const key = normalizeString(item.key);
    if (!key) continue;
    options.push({
      key,
      label: normalizeString(item.label) || undefined,
      available: item.available !== false,
    });
  }
  const currentKey = normalizeString(state.currentKey);

  if (!currentKey && options.length < 1) {
    return null;
  }

  return {
    options,
    currentKey: currentKey || options[0]?.key || 'auto',
    currentLabel: normalizeString(state.currentLabel) || undefined,
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
  return collections.map(mapWorkspaceCollectionItem);
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
    page: mapWorkspaceResourcePage(resourcePage, {
      sourceKind: 'recommended',
      sourceId: 'recommended',
    }),
    collections: collections.map(mapWorkspaceCollectionItem),
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

  return mapWorkspaceResourcePage(resourcePage, {
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

  return mapWorkspaceResourcePage(resourcePage, {
    sourceKind: 'search',
    sourceId: keyword,
    pageNum,
    pageSize,
  });
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

  return mapWorkspacePlaybackQualityState(qualityState);
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

  return mapWorkspacePlaybackQualityState(qualityState);
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

  return mapWorkspacePreparedPlayback(prepared, item);
}
