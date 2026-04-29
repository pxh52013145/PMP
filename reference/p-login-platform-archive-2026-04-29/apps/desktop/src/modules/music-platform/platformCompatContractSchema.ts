import {
  isMusicPlatformWorkspaceContextField,
  isMusicPlatformWorkspaceShellSlotId,
  type MusicPlatformWorkspaceCapabilityFamilies,
  type MusicPlatformWorkspaceContextDescriptor,
  type MusicPlatformWorkspaceDescriptor,
  type MusicPlatformWorkspaceRootDescriptor,
  type MusicPlatformWorkspaceShellSlotDescriptor,
  type PlatformCompatContractFile,
} from '@pixel-matrix/plugin-platform-contracts';

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

function readOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${fieldName}): expected an array of strings`
    );
  }

  const normalized = [...new Set(value.map((item) => readContractString(item)).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
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

function readRuntimeCarrier(
  value: unknown,
  sourceFileLabel: string
): 'same-process' | 'dedicated-worker' | 'webview-frame' | 'native-process' | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  const normalized = readContractString(value);
  if (
    normalized === 'same-process' ||
    normalized === 'dedicated-worker' ||
    normalized === 'webview-frame' ||
    normalized === 'native-process'
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.requiredRuntimeCarrier is invalid`
  );
}

function parseWorkspaceRootDescriptor(
  value: unknown,
  sourceFileLabel: string
): MusicPlatformWorkspaceRootDescriptor | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isJsonRecord(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.root must be an object`
    );
  }

  const viewId = readContractString(value.viewId);
  if (!viewId) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.root.viewId is required`
    );
  }

  return {
    viewId,
    viewType: readOptionalString(value.viewType),
  };
}

function parseWorkspaceShellSlotDescriptor(
  value: unknown,
  sourceFileLabel: string,
  index: number
): MusicPlatformWorkspaceShellSlotDescriptor {
  if (!isJsonRecord(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.shellSlots[${index}] must be an object`
    );
  }

  const slotId = readContractString(value.slotId);
  if (!isMusicPlatformWorkspaceShellSlotId(slotId)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.shellSlots[${index}].slotId is invalid`
    );
  }

  const viewId = readContractString(value.viewId);
  if (!viewId) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.shellSlots[${index}].viewId is required`
    );
  }

  return {
    slotId,
    viewId,
    viewType: readOptionalString(value.viewType),
  };
}

function parseWorkspaceShellSlots(
  value: unknown,
  sourceFileLabel: string
): MusicPlatformWorkspaceShellSlotDescriptor[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.shellSlots must be an array`
    );
  }

  const bySlotId = new Map<string, MusicPlatformWorkspaceShellSlotDescriptor>();
  value.forEach((item, index) => {
    const descriptor = parseWorkspaceShellSlotDescriptor(item, sourceFileLabel, index);
    bySlotId.set(descriptor.slotId, descriptor);
  });
  const descriptors = Array.from(bySlotId.values());
  return descriptors.length > 0 ? descriptors : undefined;
}

function parseWorkspaceCapabilityFamilies(
  value: unknown,
  sourceFileLabel: string
): MusicPlatformWorkspaceCapabilityFamilies | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isJsonRecord(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.capabilityFamilies must be an object`
    );
  }

  const required = readOptionalStringArray(
    value.required,
    `${sourceFileLabel}:workspace.capabilityFamilies.required`
  );
  const optional = readOptionalStringArray(
    value.optional,
    `${sourceFileLabel}:workspace.capabilityFamilies.optional`
  );

  if (!required && !optional) {
    return undefined;
  }

  return {
    required,
    optional,
  };
}

function parseWorkspaceContextDescriptor(
  value: unknown,
  sourceFileLabel: string
): MusicPlatformWorkspaceContextDescriptor | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isJsonRecord(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.context must be an object`
    );
  }

  const scope = readContractString(value.scope);
  if (scope !== 'platform-instance') {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.context.scope must be "platform-instance"`
    );
  }

  if (!Array.isArray(value.fields)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.context.fields must be an array`
    );
  }

  const fields = [...new Set(value.fields.map((item) => readContractString(item)).filter(Boolean))];
  if (fields.length < 1) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.context.fields must not be empty`
    );
  }
  if (!fields.every((field) => isMusicPlatformWorkspaceContextField(field))) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.context.fields contains unsupported values`
    );
  }
  const normalizedFields = fields as MusicPlatformWorkspaceContextDescriptor['fields'];

  return {
    scope: 'platform-instance',
    fields: normalizedFields,
  };
}

function parseWorkspaceDescriptor(
  value: unknown,
  sourceFileLabel: string
): MusicPlatformWorkspaceDescriptor | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isJsonRecord(value)) {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace must be an object`
    );
  }

  const ownership = readContractString(value.ownership);
  if (ownership !== 'host' && ownership !== 'pack') {
    throw new Error(
      `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.ownership must be "host" or "pack"`
    );
  }

  return {
    ownership,
    requiredRuntimeCarrier: readRuntimeCarrier(value.requiredRuntimeCarrier, sourceFileLabel),
    root: parseWorkspaceRootDescriptor(value.root, sourceFileLabel),
    shellSlots: parseWorkspaceShellSlots(value.shellSlots, sourceFileLabel),
    capabilityFamilies: parseWorkspaceCapabilityFamilies(
      value.capabilityFamilies,
      sourceFileLabel
    ),
    context: parseWorkspaceContextDescriptor(value.context, sourceFileLabel),
  };
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
  const workspace = parseWorkspaceDescriptor(value.workspace, sourceFileLabel);
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
    workspace,
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

  if (contract.workspace) {
    if (
      contract.workspace.ownership === 'pack' &&
      !contract.workspace.root &&
      (!contract.workspace.shellSlots || contract.workspace.shellSlots.length < 1)
    ) {
      throw new Error(
        `Invalid platform compat contract JSON (${sourceFileLabel}): workspace.ownership=pack requires workspace.root or workspace.shellSlots`
      );
    }

    if (contract.workspace.root) {
      assertRequiredContractString(
        contract.workspace.root.viewId,
        'workspace.root.viewId',
        sourceFileLabel
      );
    }

    for (const [index, shellSlot] of (contract.workspace.shellSlots ?? []).entries()) {
      assertRequiredContractString(
        shellSlot.slotId,
        `workspace.shellSlots[${index}].slotId`,
        sourceFileLabel
      );
      assertRequiredContractString(
        shellSlot.viewId,
        `workspace.shellSlots[${index}].viewId`,
        sourceFileLabel
      );
    }
  }

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
