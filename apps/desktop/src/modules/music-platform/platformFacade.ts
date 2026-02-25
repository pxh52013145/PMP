import {
  listMusicSourceFacadeItems,
  searchMusicSourceTracks,
  type MusicSourceCapabilityFlags,
  type MusicSourceFacadeItem,
  type MusicSourceTrackCandidate,
} from '../../services/audio/musicSourceFacade';
import {
  listPlatformConnectorAuthSnapshots,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorAuthState,
} from './connectorAuth';

export interface PlatformConnectorFacadeItem {
  connectorId: string;
  displayName: string;
  authState: PlatformConnectorAuthState;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: 'available' | 'degraded' | 'unavailable';
  availabilityMessage?: string;
  sourceIds: string[];
  sources: MusicSourceFacadeItem[];
  capabilities: MusicSourceCapabilityFlags;
}

export interface PlatformTrackSearchOptions {
  query: string;
  limit?: number;
  connectorIds?: string[];
}

export interface PlatformTrackSearchResult {
  connectorViews: PlatformConnectorFacadeItem[];
  tracks: MusicSourceTrackCandidate[];
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeCapabilities(items: MusicSourceFacadeItem[]): MusicSourceCapabilityFlags {
  const defaults: MusicSourceCapabilityFlags = {
    canSearchTracks: false,
    canSearchAlbums: false,
    canListPlaylists: false,
    canEditPlaylists: false,
    canFetchLyrics: false,
    canFetchCovers: false,
    canResolveStream: false,
    canRunIncrementalSync: false,
  };

  for (const item of items) {
    defaults.canSearchTracks ||= item.capabilities.canSearchTracks;
    defaults.canSearchAlbums ||= item.capabilities.canSearchAlbums;
    defaults.canListPlaylists ||= item.capabilities.canListPlaylists;
    defaults.canEditPlaylists ||= item.capabilities.canEditPlaylists;
    defaults.canFetchLyrics ||= item.capabilities.canFetchLyrics;
    defaults.canFetchCovers ||= item.capabilities.canFetchCovers;
    defaults.canResolveStream ||= item.capabilities.canResolveStream;
    defaults.canRunIncrementalSync ||= item.capabilities.canRunIncrementalSync;
  }

  return defaults;
}

function byConnectorId(
  item: PlatformConnectorAuthSnapshot | MusicSourceFacadeItem
): string {
  return normalizeString(item.connectorId);
}

function mapToConnectorFacade(
  connectorId: string,
  authSnapshot: PlatformConnectorAuthSnapshot | null,
  sourceItems: MusicSourceFacadeItem[]
): PlatformConnectorFacadeItem {
  const fallbackDisplayName = connectorId.replace('connector.platform.', '') || connectorId;
  return {
    connectorId,
    displayName:
      normalizeString(authSnapshot?.displayName) ||
      normalizeString(sourceItems[0]?.displayName) ||
      fallbackDisplayName,
    authState: authSnapshot?.authState ?? 'unauthorized',
    accountUid: authSnapshot?.accountUid,
    updatedAtMs: authSnapshot?.updatedAtMs,
    expiresAtMs: authSnapshot?.expiresAtMs,
    availability: authSnapshot?.availability,
    availabilityMessage: authSnapshot?.availabilityMessage,
    sourceIds: sourceItems.map((item) => item.sourceId),
    sources: sourceItems,
    capabilities: mergeCapabilities(sourceItems),
  };
}

export async function listPlatformConnectorFacadeItems(): Promise<PlatformConnectorFacadeItem[]> {
  const [authSnapshots, sourceItems] = await Promise.all([
    listPlatformConnectorAuthSnapshots(),
    listMusicSourceFacadeItems(),
  ]);

  const platformSourceItems = sourceItems.filter((item) => item.kind === 'platform');
  const authByConnectorId = new Map(authSnapshots.map((item) => [byConnectorId(item), item]));
  const sourceByConnectorId = new Map<string, MusicSourceFacadeItem[]>();

  for (const source of platformSourceItems) {
    const connectorId = byConnectorId(source);
    if (!connectorId) continue;
    const bucket = sourceByConnectorId.get(connectorId) ?? [];
    bucket.push(source);
    sourceByConnectorId.set(connectorId, bucket);
  }

  const connectorIds = new Set<string>([
    ...authByConnectorId.keys(),
    ...sourceByConnectorId.keys(),
  ]);

  const items: PlatformConnectorFacadeItem[] = [];
  for (const connectorId of connectorIds) {
    const authSnapshot = authByConnectorId.get(connectorId) ?? null;
    const sources = sourceByConnectorId.get(connectorId) ?? [];
    items.push(mapToConnectorFacade(connectorId, authSnapshot, sources));
  }

  return items.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export async function searchPlatformTracks(
  options: PlatformTrackSearchOptions
): Promise<PlatformTrackSearchResult> {
  const query = normalizeString(options.query);
  if (!query) return { connectorViews: [], tracks: [] };

  const connectorViews = await listPlatformConnectorFacadeItems();
  if (connectorViews.length === 0) {
    return {
      connectorViews,
      tracks: [],
    };
  }

  const connectorFilter = new Set(
    (options.connectorIds ?? []).map((item) => normalizeString(item)).filter((item) => item.length > 0)
  );

  const targetSourceIds: string[] = [];
  for (const view of connectorViews) {
    if (view.authState !== 'authorized') continue;
    if (!view.capabilities.canSearchTracks) continue;
    if (connectorFilter.size > 0 && !connectorFilter.has(view.connectorId)) continue;
    targetSourceIds.push(...view.sourceIds);
  }

  if (targetSourceIds.length === 0) {
    return {
      connectorViews,
      tracks: [],
    };
  }

  const tracks = await searchMusicSourceTracks({
    query,
    limit: options.limit,
    sourceIds: targetSourceIds,
  });

  return {
    connectorViews,
    tracks,
  };
}
