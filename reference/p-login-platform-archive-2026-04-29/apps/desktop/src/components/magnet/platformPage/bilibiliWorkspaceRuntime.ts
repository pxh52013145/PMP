import type { PlatformConnectorId } from '../../../modules/music-platform';
import {
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceQualityOptions,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  resolvePlatformWorkspaceCoverAssetUrl,
  resolvePlatformWorkspaceLyricLocator,
  resolvePlatformWorkspaceResource,
  searchPlatformWorkspaceResources,
} from '../../../modules/music-platform';
import {
  buildBilibiliSearchSourceId,
  mapPlatformWorkspaceCollectionToBilibili,
  mapPlatformWorkspaceLyricToBilibili,
  mapPlatformWorkspacePreparedPlaybackToBilibili,
  mapPlatformWorkspaceQualityOptionsToBilibili,
  mapPlatformWorkspaceResourcePageToBilibili,
  mapPlatformWorkspaceResourceToBilibili,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliFavoriteResourcePage,
  type BilibiliLyricLocatorResolved,
  type BilibiliPlaybackQualityOption,
  type BilibiliPreparedPlayback,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';

export interface BilibiliWorkspaceRuntimeTarget {
  connectorId: string;
  displayName: string;
  instanceId: string | null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConnectorId(value: string): PlatformConnectorId | null {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

function resolveWorkspaceTarget(
  target: BilibiliWorkspaceRuntimeTarget | null
): { connectorId: PlatformConnectorId; instanceId?: string } | null {
  const connectorId = normalizeConnectorId(target?.connectorId ?? '');
  if (!connectorId) return null;
  const instanceId = normalizeString(target?.instanceId);
  return {
    connectorId,
    instanceId: instanceId || undefined,
  };
}

export async function listBilibiliWorkspaceFolders(
  target: BilibiliWorkspaceRuntimeTarget | null,
  options?: { forceRefresh?: boolean }
): Promise<BilibiliFavoriteFolderItem[]> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return [];

  const items = await listPlatformWorkspaceCollections({
    connectorId: workspaceTarget.connectorId,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  return items.map(mapPlatformWorkspaceCollectionToBilibili);
}

export async function listBilibiliWorkspaceFolderResources(
  target: BilibiliWorkspaceRuntimeTarget | null,
  options: {
    folderId: string;
    pageNum?: number;
    pageSize?: number;
    forceRefresh?: boolean;
  }
): Promise<BilibiliFavoriteResourcePage | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const folderId = normalizeString(options.folderId);
  if (!workspaceTarget || !folderId) return null;

  const page = await listPlatformWorkspaceCollectionResources({
    connectorId: workspaceTarget.connectorId,
    collectionId: folderId,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options.forceRefresh === true,
  });
  return mapPlatformWorkspaceResourcePageToBilibili(page, folderId);
}

export async function listBilibiliWorkspaceRecommendedResources(
  target: BilibiliWorkspaceRuntimeTarget | null,
  options?: { forceRefresh?: boolean }
): Promise<BilibiliFavoriteResourcePage | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return null;

  const page = await listPlatformWorkspaceRecommendedResources({
    connectorId: workspaceTarget.connectorId,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  return mapPlatformWorkspaceResourcePageToBilibili(page, 'recommended');
}

export async function searchBilibiliWorkspaceResources(
  target: BilibiliWorkspaceRuntimeTarget | null,
  options: {
    keyword: string;
    pageNum?: number;
    pageSize?: number;
    forceRefresh?: boolean;
  }
): Promise<BilibiliFavoriteResourcePage | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const keyword = normalizeString(options.keyword);
  if (!workspaceTarget || !keyword) return null;

  const page = await searchPlatformWorkspaceResources({
    connectorId: workspaceTarget.connectorId,
    keyword,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
    instanceId: workspaceTarget.instanceId,
    forceRefresh: options.forceRefresh === true,
  });
  return mapPlatformWorkspaceResourcePageToBilibili(page, buildBilibiliSearchSourceId(keyword));
}

export async function searchBilibiliWorkspaceResourceByBvid(
  target: BilibiliWorkspaceRuntimeTarget | null,
  bvid: string
): Promise<BilibiliFavoriteResourceItem | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedBvid = normalizeString(bvid);
  if (!workspaceTarget || !normalizedBvid) return null;

  const item = await resolvePlatformWorkspaceResource({
    connectorId: workspaceTarget.connectorId,
    query: normalizedBvid,
    instanceId: workspaceTarget.instanceId,
  });
  return item ? mapPlatformWorkspaceResourceToBilibili(item) : null;
}

export async function prepareBilibiliWorkspacePlayback(
  target: BilibiliWorkspaceRuntimeTarget | null,
  item: Pick<BilibiliFavoriteResourceItem, 'sourceLocator' | 'resourceId' | 'webUrl'>,
  options?: { qualityHint?: string | null }
): Promise<BilibiliPreparedPlayback | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  if (!workspaceTarget) return null;

  const prepared = await preparePlatformWorkspacePlayback({
    connectorId: workspaceTarget.connectorId,
    sourceLocator: item.sourceLocator,
    qualityHint: normalizeString(options?.qualityHint) || undefined,
    resourceId: normalizeString(item.resourceId) || undefined,
    webUrl: normalizeString(item.webUrl) || undefined,
    instanceId: workspaceTarget.instanceId,
  });
  return mapPlatformWorkspacePreparedPlaybackToBilibili(prepared);
}

export async function listBilibiliWorkspacePlaybackQualities(
  target: BilibiliWorkspaceRuntimeTarget | null,
  sourceLocator: string
): Promise<BilibiliPlaybackQualityOption[]> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedSourceLocator = normalizeString(sourceLocator);
  if (!workspaceTarget || !normalizedSourceLocator) return [];

  const options = await listPlatformWorkspaceQualityOptions({
    connectorId: workspaceTarget.connectorId,
    sourceLocator: normalizedSourceLocator,
    instanceId: workspaceTarget.instanceId,
  });
  return mapPlatformWorkspaceQualityOptionsToBilibili(options);
}

export async function resolveBilibiliWorkspaceLyricLocator(
  target: BilibiliWorkspaceRuntimeTarget | null,
  lyricLocator: string
): Promise<BilibiliLyricLocatorResolved | null> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedLocator = normalizeString(lyricLocator);
  if (!workspaceTarget || !normalizedLocator) return null;

  const resolved = await resolvePlatformWorkspaceLyricLocator({
    connectorId: workspaceTarget.connectorId,
    lyricLocator: normalizedLocator,
    instanceId: workspaceTarget.instanceId,
  });
  return mapPlatformWorkspaceLyricToBilibili(resolved);
}

export async function resolveBilibiliWorkspaceCoverAssetUrl(
  target: BilibiliWorkspaceRuntimeTarget | null,
  coverUrl: string | undefined
): Promise<string | undefined> {
  const workspaceTarget = resolveWorkspaceTarget(target);
  const normalizedCoverUrl = normalizeString(coverUrl);
  if (!workspaceTarget || !normalizedCoverUrl) return undefined;

  return resolvePlatformWorkspaceCoverAssetUrl({
    connectorId: workspaceTarget.connectorId,
    coverUrl: normalizedCoverUrl,
    instanceId: workspaceTarget.instanceId,
  });
}
