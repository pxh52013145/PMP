import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';
import type { PlatformConnectorId } from './connectorAuth';
import bilibiliPlatformCompatContractJson from '../../../../../resource/music-platform/contracts/builtin/bilibili.platform-compat.contract.json';
import neteasePlatformCompatContractJson from '../../../../../resource/music-platform/contracts/builtin/netease.platform-compat.contract.json';
import {
  parsePlatformCompatContractFromJson,
  validatePlatformCompatContract,
} from './platformCompatContractSchema';

export interface BuiltinPlatformCompatContractRegistration {
  connectorId: PlatformConnectorId;
  enabled: boolean;
  contract: PlatformCompatContractFile;
}

const BILIBILI_PLATFORM_COMPAT_CONTRACT: PlatformCompatContractFile =
  parsePlatformCompatContractFromJson(
    bilibiliPlatformCompatContractJson,
    'resource/music-platform/contracts/builtin/bilibili.platform-compat.contract.json'
  );

validatePlatformCompatContract(
  BILIBILI_PLATFORM_COMPAT_CONTRACT,
  'resource/music-platform/contracts/builtin/bilibili.platform-compat.contract.json',
  {
    connectorId: 'connector.platform.bilibili',
    workspaceKind: 'bilibili',
    workspaceMode: 'dedicated',
  }
);

const NETEASE_PLATFORM_COMPAT_CONTRACT: PlatformCompatContractFile =
  parsePlatformCompatContractFromJson(
    neteasePlatformCompatContractJson,
    'resource/music-platform/contracts/builtin/netease.platform-compat.contract.json'
  );

validatePlatformCompatContract(
  NETEASE_PLATFORM_COMPAT_CONTRACT,
  'resource/music-platform/contracts/builtin/netease.platform-compat.contract.json',
  {
    connectorId: 'connector.platform.netease',
    workspaceKind: 'netease',
    workspaceMode: 'dedicated',
  }
);

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
