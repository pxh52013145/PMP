import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';

type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readContractString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readOptionalString(value: unknown): string | undefined {
  const next = readContractString(value);
  return next.length > 0 ? next : undefined;
}

function readApiBindingValue(value: unknown): string | undefined {
  const next = readContractString(value);
  return next.length > 0 ? next : undefined;
}

function readLoginMode(value: unknown): 'none' | 'cookie' | 'qr' | 'cookie+qr' | null {
  const normalized = readContractString(value);
  if (
    normalized === 'none' ||
    normalized === 'cookie' ||
    normalized === 'qr' ||
    normalized === 'cookie+qr'
  ) {
    return normalized;
  }
  return null;
}

export function assertRequiredContractString(
  value: string,
  fieldName: string,
  sourceFileLabel: string
): void {
  if (value.length > 0) return;
  throw new Error(`Invalid platform compat contract JSON (${sourceFileLabel}): missing ${fieldName}`);
}

export function parsePlatformCompatContractFromJson(
  value: unknown,
  sourceFileLabel: string
): PlatformCompatContractFile {
  if (!isJsonRecord(value)) {
    throw new Error(`Invalid platform compat contract JSON: ${sourceFileLabel}`);
  }

  const platform = isJsonRecord(value.platform) ? value.platform : {};
  const auth = isJsonRecord(value.auth) ? value.auth : {};
  const capabilities = isJsonRecord(value.capabilities) ? value.capabilities : {};
  const apiBindings = isJsonRecord(value.apiBindings) ? value.apiBindings : {};
  const extension = isJsonRecord(value.extension) ? value.extension : undefined;
  const loginMode = readLoginMode(auth.loginMode);
  if (!loginMode) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): invalid auth.loginMode`
    );
  }
  const contractVersion = readContractString(value.contractVersion);
  if (contractVersion !== '1.0') {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): unsupported contractVersion ${contractVersion || '(empty)'}`
    );
  }

  return {
    contractVersion: '1.0',
    platform: {
      platformId: readContractString(platform.platformId),
      displayName: readContractString(platform.displayName),
      staticIcon: readContractString(platform.staticIcon),
      vendor: readOptionalString(platform.vendor),
      supportsMultiInstance: readBoolean(platform.supportsMultiInstance),
    },
    auth: {
      loginMode,
      requiresCookie: readBoolean(auth.requiresCookie),
      requiresAccountId: readBoolean(auth.requiresAccountId),
      supportsRefresh: readBoolean(auth.supportsRefresh),
    },
    capabilities: {
      playlists: readBoolean(capabilities.playlists),
      favorites: readBoolean(capabilities.favorites),
      dailyRecommendations: readBoolean(capabilities.dailyRecommendations),
      search: readBoolean(capabilities.search),
      quality: readBoolean(capabilities.quality),
      navigation: readBoolean(capabilities.navigation),
      settings: readBoolean(capabilities.settings),
      pages: readBoolean(capabilities.pages),
    },
    apiBindings: {
      auth: readContractString(apiBindings.auth),
      library: readApiBindingValue(apiBindings.library),
      recommendations: readApiBindingValue(apiBindings.recommendations),
      search: readApiBindingValue(apiBindings.search),
      quality: readApiBindingValue(apiBindings.quality),
      navigation: readApiBindingValue(apiBindings.navigation),
      settings: readApiBindingValue(apiBindings.settings),
      pages: readApiBindingValue(apiBindings.pages),
    },
    extension,
  };
}

export function validatePlatformCompatContract(
  contract: PlatformCompatContractFile,
  sourceFileLabel: string,
  expectations?: {
    connectorId?: string;
    workspaceKind?: string;
    workspaceMode?: string;
  }
): void {
  assertRequiredContractString(contract.contractVersion, 'contractVersion', sourceFileLabel);
  assertRequiredContractString(contract.platform.platformId, 'platform.platformId', sourceFileLabel);
  assertRequiredContractString(contract.platform.displayName, 'platform.displayName', sourceFileLabel);
  assertRequiredContractString(contract.platform.staticIcon, 'platform.staticIcon', sourceFileLabel);
  assertRequiredContractString(contract.apiBindings.auth, 'apiBindings.auth', sourceFileLabel);

  if (!expectations) return;

  if (expectations.connectorId) {
    const connectorId = readContractString(contract.extension?.connectorId);
    if (connectorId !== expectations.connectorId) {
      throw new Error(
        `Invalid platform compat contract JSON (${sourceFileLabel}): extension.connectorId mismatch`
      );
    }
  }

  if (expectations.workspaceKind) {
    const workspaceKind = readContractString(contract.extension?.workspaceKind);
    if (workspaceKind !== expectations.workspaceKind) {
      throw new Error(
        `Invalid platform compat contract JSON (${sourceFileLabel}): extension.workspaceKind mismatch`
      );
    }
  }

  if (expectations.workspaceMode) {
    const workspaceMode = readContractString(contract.extension?.workspaceMode);
    if (workspaceMode !== expectations.workspaceMode) {
      throw new Error(
        `Invalid platform compat contract JSON (${sourceFileLabel}): extension.workspaceMode mismatch`
      );
    }
  }
}
