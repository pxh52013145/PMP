import type {
  PlatformApiResult,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  beginConnectorQrLoginFromInstanceAuth,
  clearConnectorAuthCookiesFromInstanceAuth,
  getConnectorAuthSnapshotFromInstanceAuth,
  logoutConnectorFromInstanceAuth,
  pollConnectorQrLoginFromInstanceAuth,
  refreshConnectorAuthSnapshotFromInstanceAuth,
} from './connectorAuthCompat';
import {
  normalizePlatformConnectorId,
  resolvePlatformConnectorTemplate,
  type BuiltinPlatformCompatRegistration,
  type PlatformConnectorAdapter,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformQrLoginPollResult,
  type PlatformQrLoginSession,
} from './platformConnectorModel';

export interface BuiltinPlatformCompatContractRegistration {
  connectorId: PlatformConnectorId;
  enabled: boolean;
  contract: PlatformCompatContractFile;
  source?: BuiltinPlatformCompatRegistration['source'];
  metadata?: Record<string, unknown>;
}

type PlatformConnectorDefinitionsListener = (definitions: PlatformConnectorDefinition[]) => void;
type PlatformConnectorCompatRegistrationsListener = (
  registrations: BuiltinPlatformCompatRegistration[]
) => void;
type PlatformConnectorRegistryBootstrapState = {
  requested: boolean;
  completed: boolean;
  initializer: (() => void) | null;
};

const platformConnectorAdapterRegistry = new Map<PlatformConnectorId, PlatformConnectorAdapter>();
const platformCompatRegistrationsByConnectorId = new Map<
  PlatformConnectorId,
  BuiltinPlatformCompatRegistration
>();
const platformConnectorDefinitionsListeners = new Set<PlatformConnectorDefinitionsListener>();
const platformConnectorCompatRegistrationsListeners = new Set<
  PlatformConnectorCompatRegistrationsListener
>();

function getPlatformConnectorRegistryBootstrapState(): PlatformConnectorRegistryBootstrapState {
  type StatefulBootstrapResolver = typeof getPlatformConnectorRegistryBootstrapState & {
    state?: PlatformConnectorRegistryBootstrapState;
  };

  const resolver = getPlatformConnectorRegistryBootstrapState as StatefulBootstrapResolver;
  if (resolver.state) {
    return resolver.state;
  }

  const initialState: PlatformConnectorRegistryBootstrapState = {
    requested: false,
    completed: false,
    initializer: null,
  };
  resolver.state = initialState;
  return initialState;
}

function ensurePlatformConnectorRegistryInitialized(): void {
  const bootstrapState = getPlatformConnectorRegistryBootstrapState();
  bootstrapState.requested = true;
  if (bootstrapState.completed || !bootstrapState.initializer) {
    return;
  }

  bootstrapState.completed = true;
  bootstrapState.initializer();
}

export function registerPlatformConnectorRegistryInitializer(initializer: () => void): void {
  const bootstrapState = getPlatformConnectorRegistryBootstrapState();
  bootstrapState.initializer = initializer;
  if (bootstrapState.requested && !bootstrapState.completed) {
    bootstrapState.completed = true;
    initializer();
  }
}

function createUnsupportedSnapshot(
  definition: PlatformConnectorDefinition
): PlatformConnectorAuthSnapshot {
  return {
    connectorId: definition.connectorId,
    displayName: definition.displayName,
    authState: 'unauthorized',
    availability: definition.enabled ? 'available' : 'unavailable',
    availabilityMessage: definition.enabled ? undefined : 'connector not integrated yet',
  };
}

function createPlatformApiOkResult<T>(data: T): PlatformApiResult<T> {
  return {
    ok: true,
    data,
  };
}

function createPlatformApiErrorResult(
  code: string,
  message: string,
  retryable?: boolean,
  details?: unknown
): PlatformApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      details,
    },
  };
}

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

function mapAuthSnapshotToPlatformCompatAuthData(snapshot: PlatformConnectorAuthSnapshot) {
  return {
    authState: snapshot.authState,
    accountId: snapshot.accountUid,
    updatedAtMs: snapshot.updatedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
    availability: snapshot.availability,
    availabilityMessage: snapshot.availabilityMessage,
    metadata: {
      connectorId: snapshot.connectorId,
      displayName: snapshot.displayName,
    },
  };
}

function mapQrSessionToPlatformCompatData(session: PlatformQrLoginSession) {
  return {
    sessionId: session.sessionId,
    qrcodeKey: session.qrcodeKey,
    qrUrl: session.qrUrl,
    qrImageDataUrl: session.qrImageDataUrl,
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

function mapQrPollResultToPlatformCompatData(result: PlatformQrLoginPollResult) {
  return {
    sessionId: result.sessionId,
    state: result.state,
    stateCode: result.stateCode,
    stateMessage: result.stateMessage,
    authState: result.authState,
    accountId: result.accountUid,
    expiresAtMs: result.expiresAtMs,
    metadata: {
      connectorId: result.connectorId,
    },
  };
}

function createBuiltinPlatformCompatRuntime(
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter
): PlatformCompatRuntimeApi {
  return {
    auth: {
      getSnapshot: async () => {
        const snapshot = await adapter.getAuthSnapshot();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth snapshot is unavailable`
          );
        }
        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      refreshSnapshot: async () => {
        const snapshot = await adapter.refreshAndEmitAuthSnapshot();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth snapshot refresh is unavailable`
          );
        }
        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      beginQrLogin: async () => {
        if (definition.authFlow !== 'qr' || typeof adapter.beginQrLogin !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support QR login`
          );
        }

        const session = await adapter.beginQrLogin();
        if (!session) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} QR login session is unavailable`
          );
        }

        return createPlatformApiOkResult(mapQrSessionToPlatformCompatData(session));
      },
      pollQrLogin: async ({ sessionId }) => {
        if (definition.authFlow !== 'qr' || typeof adapter.pollQrLogin !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support QR login polling`
          );
        }

        const result = await adapter.pollQrLogin(sessionId);
        if (!result) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} QR login poll result is unavailable`
          );
        }

        return createPlatformApiOkResult(mapQrPollResultToPlatformCompatData(result));
      },
      logout: async () => {
        if (typeof adapter.logout !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support logout`
          );
        }

        const snapshot = await adapter.logout();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} logout snapshot is unavailable`
          );
        }

        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      clearAuthCookies: async () => {
        if (typeof adapter.clearAuthCookies !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support auth cookie clearing`
          );
        }

        const snapshot = await adapter.clearAuthCookies();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth cookie clearing is unavailable`
          );
        }

        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
    },
    metadata: {
      connectorId: definition.connectorId,
      workspaceKind: definition.workspaceKind,
      workspaceMode: definition.workspaceMode,
    },
  };
}

export function createPlatformCompatRuntimeFromConnectorAdapter(
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter
): PlatformCompatRuntimeApi {
  return createBuiltinPlatformCompatRuntime(definition, adapter);
}

function createPassiveAdapter(definition: PlatformConnectorDefinition): PlatformConnectorAdapter {
  return {
    definition,
    getAuthSnapshot: async () => createUnsupportedSnapshot(definition),
    refreshAndEmitAuthSnapshot: async () => createUnsupportedSnapshot(definition),
    beginQrLogin: async () => null,
    pollQrLogin: async () => null,
    logout: async () => createUnsupportedSnapshot(definition),
    clearAuthCookies: async () => createUnsupportedSnapshot(definition),
  };
}

export function createPassivePlatformConnectorAdapter(
  definition: PlatformConnectorDefinition
): PlatformConnectorAdapter {
  return createPassiveAdapter(definition);
}

async function readConnectorSnapshotFromCompatSources(
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter,
  mode: 'get' | 'refresh' | 'logout' | 'clear'
): Promise<PlatformConnectorAuthSnapshot> {
  const instanceSnapshot =
    mode === 'get'
      ? await getConnectorAuthSnapshotFromInstanceAuth(definition)
      : mode === 'refresh'
        ? await refreshConnectorAuthSnapshotFromInstanceAuth(definition)
        : mode === 'logout'
          ? await logoutConnectorFromInstanceAuth(definition)
          : await clearConnectorAuthCookiesFromInstanceAuth(definition);
  if (instanceSnapshot) {
    return instanceSnapshot;
  }

  const adapterSnapshot =
    mode === 'get'
      ? await adapter.getAuthSnapshot()
      : mode === 'refresh'
        ? await adapter.refreshAndEmitAuthSnapshot()
        : mode === 'logout'
          ? typeof adapter.logout === 'function'
            ? await adapter.logout()
            : null
          : typeof adapter.clearAuthCookies === 'function'
            ? await adapter.clearAuthCookies()
            : null;
  return adapterSnapshot ?? createUnsupportedSnapshot(definition);
}

function cloneConnectorDefinition(
  definition: PlatformConnectorDefinition
): PlatformConnectorDefinition {
  return { ...definition };
}

function cloneBuiltinPlatformCompatRegistration(
  registration: BuiltinPlatformCompatRegistration
): BuiltinPlatformCompatRegistration {
  return {
    ...registration,
    contract: cloneContract(registration.contract),
    metadata: registration.metadata ? { ...registration.metadata } : undefined,
  };
}

function cloneBuiltinPlatformCompatContractRegistration(
  registration: BuiltinPlatformCompatContractRegistration
): BuiltinPlatformCompatContractRegistration {
  return {
    ...registration,
    contract: cloneContract(registration.contract),
    metadata: registration.metadata ? { ...registration.metadata } : undefined,
  };
}

function emitPlatformConnectorDefinitionsChanged(): void {
  if (platformConnectorDefinitionsListeners.size === 0) return;
  const snapshot = listPlatformConnectorDefinitions();
  for (const listener of platformConnectorDefinitionsListeners) {
    listener(snapshot.map(cloneConnectorDefinition));
  }
}

function emitPlatformConnectorCompatRegistrationsChanged(): void {
  if (platformConnectorCompatRegistrationsListeners.size === 0) return;
  const snapshot = listBuiltinPlatformCompatRegistrations();
  for (const listener of platformConnectorCompatRegistrationsListeners) {
    listener(snapshot.map(cloneBuiltinPlatformCompatRegistration));
  }
}

function sortByConnectorDefinition(
  left: PlatformConnectorDefinition,
  right: PlatformConnectorDefinition
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.displayName.localeCompare(right.displayName, 'zh-CN');
}

function getPlatformConnectorAdapter(connectorId: string): PlatformConnectorAdapter | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  return platformConnectorAdapterRegistry.get(normalizedConnectorId) ?? null;
}

function getPlatformConnectorDefinitionInternal(
  connectorId: string
): PlatformConnectorDefinition | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  const adapter = platformConnectorAdapterRegistry.get(normalizedConnectorId);
  return adapter?.definition ? cloneConnectorDefinition(adapter.definition) : null;
}

function listMergedPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  return Array.from(platformCompatRegistrationsByConnectorId.values())
    .map(cloneBuiltinPlatformCompatRegistration)
    .sort((left, right) => {
      const leftDefinition = getPlatformConnectorDefinitionInternal(left.connectorId);
      const rightDefinition = getPlatformConnectorDefinitionInternal(right.connectorId);
      if (leftDefinition && rightDefinition) {
        return sortByConnectorDefinition(leftDefinition, rightDefinition);
      }
      return left.platformId.localeCompare(right.platformId, 'zh-CN');
    });
}

export function listBuiltinPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  ensurePlatformConnectorRegistryInitialized();
  return listMergedPlatformCompatRegistrations().map(cloneBuiltinPlatformCompatRegistration);
}

export function listBuiltinPlatformCompatContractRegistrations(): BuiltinPlatformCompatContractRegistration[] {
  return listBuiltinPlatformCompatRegistrations().map((registration) =>
    cloneBuiltinPlatformCompatContractRegistration({
      connectorId: registration.connectorId,
      enabled: registration.enabled,
      contract: registration.contract,
      source: registration.source,
      metadata: registration.metadata,
    })
  );
}

export function getBuiltinPlatformCompatContractRegistration(
  connectorId: string
): BuiltinPlatformCompatContractRegistration | null {
  ensurePlatformConnectorRegistryInitialized();
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  const registration =
    platformCompatRegistrationsByConnectorId.get(normalizedConnectorId) ?? null;
  if (!registration) return null;

  return cloneBuiltinPlatformCompatContractRegistration({
    connectorId: registration.connectorId,
    enabled: registration.enabled,
    contract: registration.contract,
    source: registration.source,
    metadata: registration.metadata,
  });
}

export function registerPlatformConnectorAdapter(adapter: PlatformConnectorAdapter): void {
  ensurePlatformConnectorRegistryInitialized();
  platformConnectorAdapterRegistry.set(adapter.definition.connectorId, adapter);
  emitPlatformConnectorDefinitionsChanged();
  emitPlatformConnectorCompatRegistrationsChanged();
}

export function unregisterPlatformConnectorAdapter(connectorId: string): boolean {
  ensurePlatformConnectorRegistryInitialized();
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  const deleted = platformConnectorAdapterRegistry.delete(normalizedConnectorId);
  if (!deleted) return false;
  emitPlatformConnectorDefinitionsChanged();
  emitPlatformConnectorCompatRegistrationsChanged();
  return deleted;
}

export function registerPlatformCompatRegistrationForConnector(
  registration: BuiltinPlatformCompatRegistration
): void {
  ensurePlatformConnectorRegistryInitialized();
  platformCompatRegistrationsByConnectorId.set(
    registration.connectorId,
    cloneBuiltinPlatformCompatRegistration({
      ...registration,
      source: registration.source ?? 'runtime',
    })
  );
  emitPlatformConnectorCompatRegistrationsChanged();
}

export function unregisterPlatformCompatRegistrationForConnector(connectorId: string): boolean {
  ensurePlatformConnectorRegistryInitialized();
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  const deleted = platformCompatRegistrationsByConnectorId.delete(normalizedConnectorId);
  if (deleted) {
    emitPlatformConnectorCompatRegistrationsChanged();
  }
  return deleted;
}

export function listPlatformConnectorDefinitions(): PlatformConnectorDefinition[] {
  ensurePlatformConnectorRegistryInitialized();
  const definitions = Array.from(platformConnectorAdapterRegistry.values()).map(
    (item) => item.definition
  );
  return definitions.map(cloneConnectorDefinition).sort(sortByConnectorDefinition);
}

export function getPlatformConnectorDefinition(
  connectorId: string
): PlatformConnectorDefinition | null {
  ensurePlatformConnectorRegistryInitialized();
  return getPlatformConnectorDefinitionInternal(connectorId);
}

export function listPlatformConnectorAdapters(): PlatformConnectorAdapter[] {
  ensurePlatformConnectorRegistryInitialized();
  return listPlatformConnectorDefinitions()
    .map((definition) => platformConnectorAdapterRegistry.get(definition.connectorId))
    .filter((adapter): adapter is PlatformConnectorAdapter => Boolean(adapter));
}

export function subscribePlatformConnectorDefinitions(
  listener: PlatformConnectorDefinitionsListener
): () => void {
  ensurePlatformConnectorRegistryInitialized();
  platformConnectorDefinitionsListeners.add(listener);
  return () => {
    platformConnectorDefinitionsListeners.delete(listener);
  };
}

export function subscribePlatformConnectorCompatRegistrations(
  listener: PlatformConnectorCompatRegistrationsListener
): () => void {
  ensurePlatformConnectorRegistryInitialized();
  platformConnectorCompatRegistrationsListeners.add(listener);
  return () => {
    platformConnectorCompatRegistrationsListeners.delete(listener);
  };
}

export async function getPlatformConnectorAuthSnapshot(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!adapter || !definition) return null;
  return readConnectorSnapshotFromCompatSources(definition, adapter, 'get');
}

export async function refreshAndEmitPlatformConnectorAuthSnapshot(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!adapter || !definition) return null;
  return readConnectorSnapshotFromCompatSources(definition, adapter, 'refresh');
}

export async function beginPlatformQrLogin(
  connectorId: string
): Promise<PlatformQrLoginSession | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!definition) return null;

  const instanceSession = await beginConnectorQrLoginFromInstanceAuth(definition);
  if (instanceSession) return instanceSession;
  if (!adapter || typeof adapter.beginQrLogin !== 'function') return null;
  return adapter.beginQrLogin();
}

export async function pollPlatformQrLogin(
  connectorId: string,
  sessionId: string
): Promise<PlatformQrLoginPollResult | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!definition) return null;

  const instanceResult = await pollConnectorQrLoginFromInstanceAuth(definition, sessionId);
  if (instanceResult) return instanceResult;
  if (!adapter || typeof adapter.pollQrLogin !== 'function') return null;
  return adapter.pollQrLogin(sessionId);
}

export async function logoutPlatformConnector(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!adapter || !definition) return null;
  return readConnectorSnapshotFromCompatSources(definition, adapter, 'logout');
}

export async function clearPlatformConnectorCookies(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  ensurePlatformConnectorRegistryInitialized();
  const adapter = getPlatformConnectorAdapter(connectorId);
  const definition = adapter?.definition ?? getPlatformConnectorDefinitionInternal(connectorId);
  if (!adapter || !definition) return null;
  return readConnectorSnapshotFromCompatSources(definition, adapter, 'clear');
}

export async function listPlatformConnectorAuthSnapshots(): Promise<PlatformConnectorAuthSnapshot[]> {
  const definitions = listPlatformConnectorDefinitions();
  const snapshots = await Promise.all(
    definitions.map((definition) => getPlatformConnectorAuthSnapshot(definition.connectorId))
  );
  return definitions
    .map((definition, index) => snapshots[index] ?? createUnsupportedSnapshot(definition))
    .sort((left, right) => {
      const leftDefinition = getPlatformConnectorDefinitionInternal(left.connectorId);
      const rightDefinition = getPlatformConnectorDefinitionInternal(right.connectorId);
      if (leftDefinition && rightDefinition) {
        return sortByConnectorDefinition(leftDefinition, rightDefinition);
      }
      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
}

export { resolvePlatformConnectorTemplate };
