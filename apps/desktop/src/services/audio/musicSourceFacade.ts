import {
  listNativeLibraryConnectors,
  listNativeLibrarySources,
  queryNativeLibraryTracks,
  type NativeLibraryConnectorRecord,
  type NativeLibrarySourceRecord,
  type NativeLibraryTrackRecord,
} from '../../modules/music-library';

export type MusicSourceKind = 'local' | 'nas' | 'platform';
export type MusicSourceStatus = 'active' | 'offline' | 'error';
export type MusicSourceTrackAvailability = 'available' | 'missing' | 'remote-only';

export interface MusicSourceCapabilityFlags {
  canSearchTracks: boolean;
  canSearchAlbums: boolean;
  canListPlaylists: boolean;
  canEditPlaylists: boolean;
  canFetchLyrics: boolean;
  canFetchCovers: boolean;
  canResolveStream: boolean;
  canRunIncrementalSync: boolean;
}

export interface MusicSourceFacadeItem {
  sourceId: string;
  connectorId: string;
  kind: MusicSourceKind;
  driver: string;
  displayName: string;
  status: MusicSourceStatus;
  pathLocator?: string;
  capabilities: MusicSourceCapabilityFlags;
}

export interface MusicSourceTrackCandidate {
  trackId: string;
  sourceId: string;
  connectorId: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  qualityTier?: string;
  availability: MusicSourceTrackAvailability;
  sourceLocator?: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function detectSourceKind(source: NativeLibrarySourceRecord): MusicSourceKind {
  const category = normalizeString(source.category).toLowerCase();
  const path = normalizeString(source.path).toLowerCase();

  if (category === 'platform' || path.startsWith('platform://')) {
    return 'platform';
  }

  if (
    category === 'nas' ||
    path.startsWith('smb://') ||
    path.startsWith('webdav://') ||
    path.startsWith('nfs://')
  ) {
    return 'nas';
  }

  return 'local';
}

function inferConnectorId(kind: MusicSourceKind, connectors: NativeLibraryConnectorRecord[]): string {
  const matched = connectors.find((item) => normalizeString(item.kind).toLowerCase() === kind);
  if (matched) return matched.id;

  if (kind === 'local') return 'connector.local.default';
  if (kind === 'nas') return 'connector.nas.default';
  return 'connector.platform.default';
}

function buildCapabilities(kind: MusicSourceKind, driver: string): MusicSourceCapabilityFlags {
  const normalizedDriver = normalizeString(driver).toLowerCase();
  const isRemote = kind === 'platform';
  const isNas = kind === 'nas';

  if (isRemote && (normalizedDriver === 'bilibili-web' || normalizedDriver === 'bilibili')) {
    return {
      canSearchTracks: true,
      canSearchAlbums: false,
      canListPlaylists: true,
      canEditPlaylists: false,
      canFetchLyrics: true,
      canFetchCovers: true,
      canResolveStream: false,
      canRunIncrementalSync: false,
    };
  }

  return {
    canSearchTracks: true,
    canSearchAlbums: true,
    canListPlaylists: isRemote,
    canEditPlaylists: isRemote,
    canFetchLyrics: isRemote || isNas || normalizedDriver === 'filesystem',
    canFetchCovers: true,
    canResolveStream: true,
    canRunIncrementalSync: kind !== 'platform',
  };
}

function mapSourceToFacade(
  source: NativeLibrarySourceRecord,
  connectors: NativeLibraryConnectorRecord[]
): MusicSourceFacadeItem {
  const kind = detectSourceKind(source);
  const connectorId = inferConnectorId(kind, connectors);
  const connector = connectors.find((item) => item.id === connectorId);
  const driver = connector?.driver || (kind === 'nas' ? 'nas' : 'filesystem');
  const statusRaw = normalizeString(connector?.status || 'active').toLowerCase();
  const status: MusicSourceStatus =
    statusRaw === 'offline' || statusRaw === 'error' ? statusRaw : 'active';

  return {
    sourceId: source.id,
    connectorId,
    kind,
    driver,
    displayName: source.displayName || source.path,
    status,
    pathLocator: source.path,
    capabilities: buildCapabilities(kind, driver),
  };
}

function mapTrackAvailability(track: NativeLibraryTrackRecord): MusicSourceTrackAvailability {
  const normalizedStatus = normalizeString(track.status).toLowerCase();
  if (normalizedStatus === 'missing') return 'missing';
  return 'available';
}

export async function listMusicSourceFacadeItems(): Promise<MusicSourceFacadeItem[]> {
  const [sources, connectors] = await Promise.all([
    listNativeLibrarySources(),
    listNativeLibraryConnectors(),
  ]);

  const sourceItems = sources.map((source) => mapSourceToFacade(source, connectors));
  const sourceIds = new Set(sourceItems.map((item) => item.sourceId));

  const virtualPlatformItems: MusicSourceFacadeItem[] = [];
  for (const connector of connectors) {
    const kindRaw = normalizeString(connector.kind).toLowerCase();
    if (kindRaw !== 'platform') continue;

    const virtualSourceId = `virtual::${connector.id}`;
    if (sourceIds.has(virtualSourceId)) continue;

    virtualPlatformItems.push({
      sourceId: virtualSourceId,
      connectorId: connector.id,
      kind: 'platform',
      driver: connector.driver,
      displayName: connector.displayName || connector.id,
      status:
        normalizeString(connector.status).toLowerCase() === 'error'
          ? 'error'
          : normalizeString(connector.status).toLowerCase() === 'offline'
            ? 'offline'
            : 'active',
      capabilities: buildCapabilities('platform', connector.driver),
    });
  }

  return [...sourceItems, ...virtualPlatformItems].sort((a, b) => {
    if (a.kind !== b.kind) {
      const rank = (kind: MusicSourceKind) => {
        if (kind === 'local') return 0;
        if (kind === 'nas') return 1;
        return 2;
      };
      return rank(a.kind) - rank(b.kind);
    }
    return a.displayName.localeCompare(b.displayName, 'zh-CN');
  });
}

export async function searchMusicSourceTracks(options: {
  query: string;
  limit?: number;
  sourceIds?: string[];
}): Promise<MusicSourceTrackCandidate[]> {
  const query = normalizeString(options.query);
  if (!query) return [];

  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(500, Math.floor(options.limit)))
      : 100;

  const [facadeItems, tracks] = await Promise.all([
    listMusicSourceFacadeItems(),
    queryNativeLibraryTracks({
      searchQuery: query,
      includeMissing: true,
      visibleOnly: false,
      limit,
      offset: 0,
    }),
  ]);

  const allowedSourceIds = new Set(
    Array.isArray(options.sourceIds)
      ? options.sourceIds
          .map((sourceId) => normalizeString(sourceId))
          .filter((sourceId) => sourceId.length > 0)
      : []
  );
  const hasSourceFilter = allowedSourceIds.size > 0;

  const sourceMap = new Map(facadeItems.map((item) => [item.sourceId, item]));
  const candidates: MusicSourceTrackCandidate[] = [];

  for (const track of tracks) {
    const sourceId = normalizeString(track.sourceId);
    if (!sourceId) continue;
    if (hasSourceFilter && !allowedSourceIds.has(sourceId)) continue;

    const source = sourceMap.get(sourceId);
    candidates.push({
      trackId: track.id,
      sourceId,
      connectorId: source?.connectorId || 'connector.local.default',
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.durationSeconds,
      qualityTier:
        typeof track.sampleRate === 'number'
          ? `${Math.floor(track.sampleRate)}Hz`
          : track.bitDepth
            ? `${Math.floor(track.bitDepth)}bit`
            : undefined,
      availability: mapTrackAvailability(track),
      sourceLocator: track.filePath,
    });
  }

  return candidates.slice(0, limit);
}
