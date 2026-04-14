import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';
import type { PlatformConnectorId } from './connectorAuth';

export interface BuiltinPlatformCompatContractRegistration {
  connectorId: PlatformConnectorId;
  enabled: boolean;
  contract: PlatformCompatContractFile;
}

const BILIBILI_PLATFORM_COMPAT_CONTRACT: PlatformCompatContractFile = {
  contractVersion: '1.0',
  platform: {
    platformId: 'bilibili',
    displayName: 'Bilibili',
    staticIcon: 'bilibili',
    vendor: 'Bilibili',
    supportsMultiInstance: false,
  },
  auth: {
    loginMode: 'qr',
    requiresCookie: false,
    requiresAccountId: false,
    supportsRefresh: true,
  },
  capabilities: {
    playlists: false,
    favorites: true,
    dailyRecommendations: true,
    search: true,
    quality: true,
    navigation: false,
    settings: true,
    pages: true,
  },
  apiBindings: {
    auth: 'host.pmp.connector-auth',
    library: 'host.pmp.music-platform.bilibili.library',
    recommendations: 'host.pmp.music-platform.bilibili.recommendations',
    search: 'host.pmp.music-platform.bilibili.search',
    quality: 'host.pmp.music-platform.bilibili.quality',
    settings: 'host.pmp.music-platform.bilibili.settings',
    pages: 'host.pmp.music-platform.bilibili.workspace',
  },
  extension: {
    connectorId: 'connector.platform.bilibili',
    workspaceKind: 'bilibili',
    workspaceMode: 'dedicated',
    runtimeAdapter: 'connectorAuth',
    source: 'builtin',
  },
};

const NETEASE_PLATFORM_COMPAT_CONTRACT: PlatformCompatContractFile = {
  contractVersion: '1.0',
  platform: {
    platformId: 'netease',
    displayName: 'Netease',
    staticIcon: 'netease',
    vendor: 'NetEase Cloud Music',
    supportsMultiInstance: false,
  },
  auth: {
    loginMode: 'qr',
    requiresCookie: false,
    requiresAccountId: false,
    supportsRefresh: true,
  },
  capabilities: {
    playlists: true,
    favorites: false,
    dailyRecommendations: true,
    search: true,
    quality: false,
    navigation: false,
    settings: false,
    pages: true,
  },
  apiBindings: {
    auth: 'host.pmp.connector-auth',
    library: 'host.pmp.music-platform.netease.library',
    recommendations: 'host.pmp.music-platform.netease.recommendations',
    search: 'host.pmp.music-platform.netease.search',
    pages: 'host.pmp.music-platform.netease.workspace',
  },
  extension: {
    connectorId: 'connector.platform.netease',
    workspaceKind: 'netease',
    workspaceMode: 'dedicated',
    runtimeAdapter: 'connectorAuth',
    source: 'builtin',
  },
};

const BUILTIN_PLATFORM_COMPAT_CONTRACTS: BuiltinPlatformCompatContractRegistration[] = [
  {
    connectorId: 'connector.platform.bilibili',
    enabled: true,
    contract: BILIBILI_PLATFORM_COMPAT_CONTRACT,
  },
  {
    connectorId: 'connector.platform.netease',
    enabled: true,
    contract: NETEASE_PLATFORM_COMPAT_CONTRACT,
  },
];

function cloneContract(contract: PlatformCompatContractFile): PlatformCompatContractFile {
  return {
    ...contract,
    platform: { ...contract.platform },
    auth: { ...contract.auth },
    capabilities: { ...contract.capabilities },
    apiBindings: { ...contract.apiBindings },
    extension: contract.extension ? { ...contract.extension } : undefined,
  };
}

function normalizeConnectorId(value: unknown): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

export function listBuiltinPlatformCompatContractRegistrations(): BuiltinPlatformCompatContractRegistration[] {
  return BUILTIN_PLATFORM_COMPAT_CONTRACTS.map((entry) => ({
    connectorId: entry.connectorId,
    enabled: entry.enabled,
    contract: cloneContract(entry.contract),
  }));
}

export function getBuiltinPlatformCompatContractRegistration(
  connectorId: string
): BuiltinPlatformCompatContractRegistration | null {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return null;

  const matched =
    BUILTIN_PLATFORM_COMPAT_CONTRACTS.find((entry) => entry.connectorId === normalizedConnectorId) ??
    null;
  if (!matched) return null;

  return {
    connectorId: matched.connectorId,
    enabled: matched.enabled,
    contract: cloneContract(matched.contract),
  };
}
