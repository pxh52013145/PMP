import type { PlatformApiResult } from '@pixel-matrix/plugin-platform-contracts';

import type { PlatformCompatRegistryRecord } from '../../../modules/music-platform';

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
  contractRecord: PlatformCompatRegistryRecord | null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function shouldUseRuntime(target: MusicTemplateRuntimeTarget): boolean {
  return Boolean(target.instanceId && target.contractRecord?.runtime);
}

function readRuntimeBucketMethod<T extends (...args: unknown[]) => Promise<PlatformApiResult<unknown>>>(
  target: MusicTemplateRuntimeTarget,
  bucket: keyof NonNullable<PlatformCompatRegistryRecord['runtime']>,
  method: string
): T | null {
  const runtime = target.contractRecord?.runtime;
  const runtimeBucket = runtime?.[bucket];
  const bucketRecord = asRecord(runtimeBucket);
  const fn = bucketRecord?.[method];
  return typeof fn === 'function' ? (fn as T) : null;
}

function mapRuntimeCollectionItem(value: unknown): MusicTemplateCollectionItem | null {
  const record = asRecord(value);
  if (!record) return null;

  const collectionId = normalizeString(record.collectionId ?? record.playlistId ?? record.id);
  const title = normalizeString(record.title ?? record.name ?? record.label);
  if (!collectionId || !title) return null;

  return {
    collectionId,
    title,
    trackCount: normalizePositiveInt(record.trackCount ?? record.count ?? record.total),
    coverUrl: normalizeString(record.coverUrl ?? record.imageUrl ?? record.cover) || undefined,
    updatedAtMs:
      typeof record.updatedAtMs === 'number' && Number.isFinite(record.updatedAtMs)
        ? record.updatedAtMs
        : undefined,
  };
}

function mapRuntimeResourceItem(value: unknown): MusicTemplateResourceItem | null {
  const record = asRecord(value);
  if (!record) return null;

  const resourceId = normalizeString(record.resourceId ?? record.songId ?? record.id);
  const title = normalizeString(record.title ?? record.name);
  const sourceLocator = normalizeString(record.sourceLocator ?? record.locator ?? record.source);
  if (!resourceId || !title || !sourceLocator) return null;

  return {
    resourceId,
    title,
    artistNames: normalizeString(record.artistNames ?? record.artist ?? record.ownerName),
    albumName: normalizeString(record.albumName ?? record.album) || undefined,
    durationSeconds:
      typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
        ? record.durationSeconds
        : undefined,
    coverUrl: normalizeString(record.coverUrl ?? record.imageUrl ?? record.cover) || undefined,
    sourceLocator,
    webUrl: normalizeString(record.webUrl ?? record.url),
  };
}

function mapRuntimePage(
  data: unknown,
  fallback: Partial<Omit<MusicTemplateResourcePage, 'items'>> = {}
): MusicTemplateResourcePage | null {
  const record = asRecord(data);
  if (!record) return null;

  const itemsSource = record.items ?? record.resources ?? record.tracks;
  const items = asArray(itemsSource)
    .map(mapRuntimeResourceItem)
    .filter((item): item is MusicTemplateResourceItem => Boolean(item));

  if (items.length === 0 && !Array.isArray(itemsSource)) {
    return null;
  }

  return {
    sourceKind: normalizeString(record.sourceKind ?? fallback.sourceKind) || 'runtime',
    sourceId: normalizeString(record.sourceId ?? fallback.sourceId) || 'runtime',
    pageNum: normalizePositiveInt(record.pageNum ?? fallback.pageNum) || 1,
    pageSize: normalizePositiveInt(record.pageSize ?? fallback.pageSize) || items.length || 1,
    total: normalizePositiveInt(record.total ?? fallback.total) || items.length,
    hasMore:
      typeof record.hasMore === 'boolean'
        ? record.hasMore
        : typeof fallback.hasMore === 'boolean'
          ? fallback.hasMore
          : false,
    items,
  };
}

function mapRuntimeCollectionList(data: unknown): MusicTemplateCollectionItem[] {
  const record = asRecord(data);
  const source = record?.items ?? record?.collections;
  return asArray(source)
    .map(mapRuntimeCollectionItem)
    .filter((item): item is MusicTemplateCollectionItem => Boolean(item));
}

function mapRuntimeRecommendations(data: unknown): MusicTemplateRecommendationsResult {
  const record = asRecord(data);
  const collectionsSource = record?.collections ?? record?.recommendedCollections;

  return {
    page:
      mapRuntimePage(data, {
        sourceKind: 'recommended',
        sourceId: 'recommended',
      }) ??
      (Array.isArray(record?.items)
        ? {
            sourceKind: 'recommended',
            sourceId: 'recommended',
            pageNum: 1,
            pageSize: asArray(record?.items).length || 1,
            total: asArray(record?.items).length,
            hasMore: false,
            items: asArray(record?.items)
              .map(mapRuntimeResourceItem)
              .filter((item): item is MusicTemplateResourceItem => Boolean(item)),
          }
        : null),
    collections: asArray(collectionsSource)
      .map(mapRuntimeCollectionItem)
      .filter((item): item is MusicTemplateCollectionItem => Boolean(item)),
  };
}

function mapRuntimePlaybackQualityOption(value: unknown): MusicTemplatePlaybackQualityOption | null {
  const record = asRecord(value);
  if (!record) return null;

  const key = normalizeString(record.key ?? record.qualityKey ?? record.id);
  if (!key) return null;

  return {
    key,
    label: normalizeString(record.label ?? record.title ?? key) || undefined,
    available: record.available !== false,
  };
}

function mapRuntimePlaybackQualityState(data: unknown): MusicTemplatePlaybackQualityState | null {
  const record = asRecord(data);
  if (!record) return null;

  const options = asArray(record.options)
    .map(mapRuntimePlaybackQualityOption)
    .filter((item): item is MusicTemplatePlaybackQualityOption => Boolean(item));
  const current = mapRuntimePlaybackQualityOption(record.current);
  const currentKey = normalizeString(
    current?.key ?? record.currentKey ?? record.key ?? record.preferredKey
  );

  if (!currentKey && options.length === 0) return null;

  return {
    options,
    currentKey: currentKey || options[0]?.key || 'auto',
    currentLabel:
      normalizeString(current?.label ?? record.currentLabel ?? record.label) || undefined,
  };
}

async function callRuntime<T>(
  target: MusicTemplateRuntimeTarget,
  bucket: keyof NonNullable<PlatformCompatRegistryRecord['runtime']>,
  method: string,
  payload: Record<string, unknown>,
  mapOk: (data: unknown) => T
): Promise<T | null> {
  if (!shouldUseRuntime(target)) return null;

  const fn = readRuntimeBucketMethod(target, bucket, method);
  if (!fn || !target.instanceId) return null;

  const result = await fn({
    instanceId: target.instanceId,
    ...payload,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return mapOk(result.data);
}

export async function listMusicTemplateCollections(
  target: MusicTemplateRuntimeTarget,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateCollectionItem[]> {
  return (
    (await callRuntime(
    target,
    'library',
    'listCollections',
    {
      scope: 'user',
      collectionScope: 'user',
      forceRefresh: options?.forceRefresh === true,
    },
    mapRuntimeCollectionList
    )) ?? []
  );
}

export async function listMusicTemplateRecommendations(
  target: MusicTemplateRuntimeTarget,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateRecommendationsResult> {
  return (
    (await callRuntime(
    target,
    'recommendations',
    'listDaily',
    {
      forceRefresh: options?.forceRefresh === true,
    },
    mapRuntimeRecommendations
    )) ?? {
      page: null,
      collections: [],
    }
  );
}

export async function listMusicTemplateCollectionResources(
  target: MusicTemplateRuntimeTarget,
  collectionId: string,
  options?: { forceRefresh?: boolean }
): Promise<MusicTemplateResourcePage | null> {
  const normalizedCollectionId = normalizeString(collectionId);
  if (!normalizedCollectionId) return null;

  const runtimePage =
    (await callRuntime(
      target,
      'library',
      'listPlaylistTracks',
      {
        collectionId: normalizedCollectionId,
        playlistId: normalizedCollectionId,
        forceRefresh: options?.forceRefresh === true,
      },
      (data) =>
        mapRuntimePage(data, {
          sourceKind: 'user-playlist',
          sourceId: normalizedCollectionId,
        })
    )) ??
    (await callRuntime(
      target,
      'library',
      'listResources',
      {
        collectionId: normalizedCollectionId,
        playlistId: normalizedCollectionId,
        forceRefresh: options?.forceRefresh === true,
      },
      (data) =>
        mapRuntimePage(data, {
          sourceKind: 'user-playlist',
          sourceId: normalizedCollectionId,
        })
    ));
  return runtimePage;
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
  const keyword = normalizeString(options.keyword);
  if (!keyword) return null;

  const pageNum = normalizePositiveInt(options.pageNum) || 1;
  const pageSize = normalizePositiveInt(options.pageSize) || 40;

  const runtimePage = await callRuntime(
    target,
    'search',
    'query',
    {
      keyword,
      query: keyword,
      pageNum,
      pageSize,
      forceRefresh: options.forceRefresh === true,
    },
    (data) =>
      mapRuntimePage(data, {
        sourceKind: 'search',
        sourceId: keyword,
        pageNum,
        pageSize,
      })
  );
  return runtimePage;
}

export async function getMusicTemplatePlaybackQualityState(
  target: MusicTemplateRuntimeTarget,
  options?: {
    sourceLocator?: string | null;
    forceRefresh?: boolean;
  }
): Promise<MusicTemplatePlaybackQualityState | null> {
  const sourceLocator = normalizeString(options?.sourceLocator);

  const qualityState =
    (await callRuntime(
      target,
      'quality',
      'listOptions',
      {
        sourceLocator: sourceLocator || undefined,
        forceRefresh: options?.forceRefresh === true,
      },
      mapRuntimePlaybackQualityState
    )) ??
    (await callRuntime(
      target,
      'quality',
      'getCurrent',
      {
        sourceLocator: sourceLocator || undefined,
        forceRefresh: options?.forceRefresh === true,
      },
      mapRuntimePlaybackQualityState
    ));

  return qualityState;
}

export async function setMusicTemplatePlaybackQualityPreference(
  target: MusicTemplateRuntimeTarget,
  qualityKey: string,
  options?: {
    sourceLocator?: string | null;
  }
): Promise<MusicTemplatePlaybackQualityState | null> {
  const normalizedQualityKey = normalizeString(qualityKey);
  if (!normalizedQualityKey) return null;

  return callRuntime(
    target,
    'quality',
    'setPreferred',
    {
      qualityKey: normalizedQualityKey,
      key: normalizedQualityKey,
      qualityHint: normalizedQualityKey,
      sourceLocator: normalizeString(options?.sourceLocator) || undefined,
    },
    mapRuntimePlaybackQualityState
  );
}

export async function prepareMusicTemplatePlayback(
  target: MusicTemplateRuntimeTarget,
  item: MusicTemplateResourceItem,
  options?: {
    qualityHint?: string | null;
  }
): Promise<MusicTemplatePreparedPlayback | null> {
  const qualityHint = normalizeString(options?.qualityHint);
  const runtimePlayback =
    (await callRuntime(
      target,
      'library',
      'preparePlayback',
      {
        sourceLocator: item.sourceLocator,
        resourceId: item.resourceId,
        webUrl: item.webUrl,
        qualityHint: qualityHint || undefined,
      },
      (data) => {
        const record = asRecord(data);
        if (!record) return null;
        return {
          sourceLocator:
            normalizeString(record.sourceLocator ?? item.sourceLocator) || item.sourceLocator,
          streamUrl: normalizeString(record.streamUrl),
          cachePath: normalizeString(record.cachePath),
          mimeType: normalizeString(record.mimeType) || undefined,
          durationSeconds:
            typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
              ? record.durationSeconds
              : undefined,
          resourceId:
            normalizeString(record.resourceId ?? record.songId ?? item.resourceId) ||
            item.resourceId,
          selectedQualityKey: normalizeString(record.selectedQualityKey ?? record.qualityKey) || undefined,
          selectedQualityLabel:
            normalizeString(record.selectedQualityLabel ?? record.qualityLabel) || undefined,
        } satisfies MusicTemplatePreparedPlayback | null;
      }
    )) ??
    (await callRuntime(
      target,
      'search',
      'preparePlayback',
      {
        sourceLocator: item.sourceLocator,
        resourceId: item.resourceId,
        webUrl: item.webUrl,
        qualityHint: qualityHint || undefined,
      },
      (data) => {
        const record = asRecord(data);
        if (!record) return null;
        return {
          sourceLocator:
            normalizeString(record.sourceLocator ?? item.sourceLocator) || item.sourceLocator,
          streamUrl: normalizeString(record.streamUrl),
          cachePath: normalizeString(record.cachePath),
          mimeType: normalizeString(record.mimeType) || undefined,
          durationSeconds:
            typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
              ? record.durationSeconds
              : undefined,
          resourceId:
            normalizeString(record.resourceId ?? record.songId ?? item.resourceId) ||
            item.resourceId,
          selectedQualityKey: normalizeString(record.selectedQualityKey ?? record.qualityKey) || undefined,
          selectedQualityLabel:
            normalizeString(record.selectedQualityLabel ?? record.qualityLabel) || undefined,
        } satisfies MusicTemplatePreparedPlayback | null;
      }
    ));

  if (!runtimePlayback?.cachePath || !runtimePlayback.streamUrl) {
    return null;
  }

  return runtimePlayback;
}
