import type { PlatformCompatRuntimeAuthState } from '@pixel-matrix/plugin-platform-contracts';

import {
  listMusicSourceFacadeItems,
  searchMusicSourceTracks,
  type MusicSourceCapabilityFlags,
  type MusicSourceFacadeItem,
  type MusicSourceTrackCandidate,
} from '../../services/audio/musicSourceFacade';
import {
  listPlatformInstanceAuthSnapshots,
  type PlatformInstanceAuthSnapshot,
} from './platformInstanceAuth';
import { listPlatformConnectorDefinitions } from './connectorAuth';
import { invokePlatformRuntimeBinding } from './bindingRuntime';
import {
  PLATFORM_LIBRARY_BINDING_ID,
  PLATFORM_SEARCH_BINDING_ID,
} from './platformInstanceApiBinding';
import {
  listPlatformRuntimeDescriptors,
  resolvePreferredPlatformRuntimeDescriptorForConnector,
} from './platformRuntimeDescriptor';
import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';

export interface PlatformConnectorFacadeItem {
  connectorId: string;
  instanceId?: string;
  displayName: string;
  authState: PlatformCompatRuntimeAuthState;
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

export interface PlatformPreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  resourceId?: string;
  songId?: string;
  contentKind?: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
}

export interface PreparePlatformPlaybackOptions {
  sourceLocator: string;
  connectorId?: string;
  qualityHint?: string;
  instanceId?: string | null;
}

export interface PreparePlatformPlaybackResult {
  connectorId: string;
  prepared: PlatformPreparedPlayback;
}

export interface ListPlatformConnectorFacadeItemsOptions {
  refresh?: boolean;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readConnectorSuffix(connectorId: string): string {
  return normalizeString(connectorId).replace(/^connector\.platform\./, '');
}

function extractSourceLocatorScheme(value: string): string {
  const normalized = value.trim().toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):\/\//.exec(normalized);
  if (!match) return '';
  const scheme = match[1] ?? '';
  return scheme === 'http' || scheme === 'https' || scheme === 'file' ? '' : scheme;
}

function mapPreparedPlayback(value: unknown): PlatformPreparedPlayback | null {
  const record = asRecord(value);
  if (!record) return null;

  const sourceLocator = normalizeString(record.sourceLocator);
  const streamUrl = normalizeString(record.streamUrl);
  const cachePath = normalizeString(record.cachePath);
  if (!sourceLocator || !streamUrl || !cachePath) {
    return null;
  }

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizeString(record.mimeType) || undefined,
    durationSeconds: readFiniteNumber(record.durationSeconds),
    resourceId: normalizeString(record.resourceId) || undefined,
    songId: normalizeString(record.songId) || undefined,
    contentKind: normalizeString(record.contentKind) || undefined,
    selectedQualityKey: normalizeString(record.selectedQualityKey) || undefined,
    selectedQualityLabel: normalizeString(record.selectedQualityLabel) || undefined,
  };
}

type PlatformPrepareCandidate = {
  connectorId: PlatformConnectorId;
  displayName: string;
  workspaceKind?: string;
  authState?: PlatformCompatRuntimeAuthState;
  canResolveStream?: boolean;
};

function scorePrepareCandidate(
  candidate: PlatformPrepareCandidate,
  normalizedSourceLocator: string,
  scheme: string
): number {
  let score = 0;
  const tokens = new Set<string>([
    readConnectorSuffix(candidate.connectorId),
    normalizeString(candidate.workspaceKind).toLowerCase(),
  ]);

  for (const token of tokens) {
    if (!token) continue;
    if (scheme && token === scheme) {
      score += 100;
    }
    if (normalizedSourceLocator.includes(token)) {
      score += 24;
    }
  }

  if (candidate.authState === 'authorized') {
    score += 8;
  } else if (candidate.authState === 'pending') {
    score += 4;
  }

  if (candidate.canResolveStream) {
    score += 3;
  }

  return score;
}

async function resolvePrepareCandidates(
  options: PreparePlatformPlaybackOptions
): Promise<PlatformPrepareCandidate[]> {
  const explicitConnectorId = normalizePlatformConnectorId(options.connectorId);
  if (explicitConnectorId) {
    const descriptor =
      resolvePreferredPlatformRuntimeDescriptorForConnector(explicitConnectorId);
    const definition =
      descriptor?.connectorDefinition ??
      listPlatformConnectorDefinitions().find(
        (item) => item.connectorId === explicitConnectorId
      );
    return [
      {
        connectorId: explicitConnectorId,
        displayName:
          normalizeString(descriptor?.displayName) ||
          normalizeString(definition?.displayName) ||
          readConnectorSuffix(explicitConnectorId),
        workspaceKind: descriptor?.workspaceKind ?? definition?.workspaceKind,
        authState: descriptor?.authState,
      },
    ];
  }

  const definitions = listPlatformConnectorDefinitions().filter((item) => item.enabled !== false);
  const connectorViews = await listPlatformConnectorFacadeItems();
  const candidates = new Map<PlatformConnectorId, PlatformPrepareCandidate>();

  for (const definition of definitions) {
    candidates.set(definition.connectorId, {
      connectorId: definition.connectorId,
      displayName: normalizeString(definition.displayName) || readConnectorSuffix(definition.connectorId),
      workspaceKind: definition.workspaceKind,
    });
  }

  for (const view of connectorViews) {
    const connectorId = normalizePlatformConnectorId(view.connectorId);
    if (!connectorId) continue;
    const current = candidates.get(connectorId);
    candidates.set(connectorId, {
      connectorId,
      displayName:
        normalizeString(view.displayName) ||
        current?.displayName ||
        readConnectorSuffix(connectorId),
      workspaceKind: current?.workspaceKind,
      authState: view.authState,
      canResolveStream: view.capabilities.canResolveStream,
    });
  }

  const normalizedSourceLocator = normalizeString(options.sourceLocator).toLowerCase();
  const scheme = extractSourceLocatorScheme(options.sourceLocator);

  return Array.from(candidates.values()).sort((left, right) => {
    const scoreDelta =
      scorePrepareCandidate(right, normalizedSourceLocator, scheme) -
      scorePrepareCandidate(left, normalizedSourceLocator, scheme);
    if (scoreDelta !== 0) return scoreDelta;
    return left.displayName.localeCompare(right.displayName, 'zh-CN');
  });
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
  item: PlatformInstanceAuthSnapshot | MusicSourceFacadeItem
): string {
  return normalizeString(item.connectorId);
}

function mapToConnectorFacade(
  connectorId: string,
  authSnapshot: PlatformInstanceAuthSnapshot | null,
  sourceItems: MusicSourceFacadeItem[]
): PlatformConnectorFacadeItem {
  const fallbackDisplayName = connectorId.replace('connector.platform.', '') || connectorId;
  return {
    connectorId,
    instanceId: authSnapshot?.instanceId,
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

export async function listPlatformConnectorFacadeItems(
  options?: ListPlatformConnectorFacadeItemsOptions
): Promise<PlatformConnectorFacadeItem[]> {
  const [, sourceItems] = await Promise.all([
    listPlatformInstanceAuthSnapshots({ refresh: options?.refresh === true }),
    listMusicSourceFacadeItems(),
  ]);

  const runtimeDescriptors = listPlatformRuntimeDescriptors();
  const platformSourceItems = sourceItems.filter((item) => item.kind === 'platform');
  const descriptorsByConnectorId = new Map(
    runtimeDescriptors.map((descriptor) => [descriptor.connectorId, descriptor])
  );
  const sourceByConnectorId = new Map<string, MusicSourceFacadeItem[]>();

  for (const source of platformSourceItems) {
    const connectorId = byConnectorId(source);
    if (!connectorId) continue;
    const bucket = sourceByConnectorId.get(connectorId) ?? [];
    bucket.push(source);
    sourceByConnectorId.set(connectorId, bucket);
  }

  const connectorIds = new Set<string>([
    ...descriptorsByConnectorId.keys(),
    ...sourceByConnectorId.keys(),
  ]);

  const items: PlatformConnectorFacadeItem[] = [];
  for (const connectorId of connectorIds) {
    const descriptor =
      descriptorsByConnectorId.get(
        normalizePlatformConnectorId(connectorId) ?? ('__unknown__' as PlatformConnectorId)
      ) ?? null;
    const sources = sourceByConnectorId.get(connectorId) ?? [];
    const authSnapshot: PlatformInstanceAuthSnapshot | null = descriptor
      ? {
          instanceId: descriptor.instanceRecord?.instanceId ?? `${descriptor.platformId ?? 'unknown'}:builtin`,
          platformId: descriptor.platformId ?? 'unknown',
          connectorId: descriptor.connectorId,
          displayName: descriptor.displayName,
          authState: descriptor.authState,
          accountUid: descriptor.instanceRecord?.account.accountId,
          updatedAtMs: descriptor.instanceRecord?.auth.cookieUpdatedAtMs,
          expiresAtMs:
            typeof descriptor.instanceRecord?.metadata?.authExpiresAtMs === 'number' &&
            Number.isFinite(descriptor.instanceRecord.metadata.authExpiresAtMs)
              ? descriptor.instanceRecord.metadata.authExpiresAtMs
              : undefined,
          availability: descriptor.availability ?? undefined,
          availabilityMessage: descriptor.availabilityMessage,
        }
      : null;
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

export async function preparePlatformPlayback(
  options: PreparePlatformPlaybackOptions
): Promise<PreparePlatformPlaybackResult | null> {
  const sourceLocator = normalizeString(options.sourceLocator);
  if (!sourceLocator) return null;

  const candidates = await resolvePrepareCandidates({
    ...options,
    sourceLocator,
  });
  if (candidates.length < 1) {
    return null;
  }

  const payload: Record<string, unknown> = {
    sourceLocator,
  };
  const qualityHint = normalizeString(options.qualityHint);
  if (qualityHint) {
    payload.qualityHint = qualityHint;
  }
  const instanceId = normalizeString(options.instanceId);
  if (instanceId) {
    payload.instanceId = instanceId;
  }

  for (const candidate of candidates) {
    for (const bindingId of [PLATFORM_LIBRARY_BINDING_ID, PLATFORM_SEARCH_BINDING_ID]) {
      const result = await invokePlatformRuntimeBinding({
        bindingId,
        connectorId: candidate.connectorId,
        displayName: candidate.displayName,
        method: 'preparePlayback',
        payload,
      });
      if (!result.ok) {
        continue;
      }

      const prepared = mapPreparedPlayback(result.data);
      if (!prepared) {
        continue;
      }

      return {
        connectorId: candidate.connectorId,
        prepared,
      };
    }
  }

  return null;
}
