import { isTauriRuntime } from '../../utils/tauriRuntime';
import { clearBilibiliFacadeCaches } from './bilibiliFacade';
import { listPlatformConnectorDefinitions } from './connectorAuth';
import { getMusicPlatformGlobalCacheSettings } from './globalSettings';
import {
  getInstalledPlatformPackRecord,
  listInstalledPlatformPackRecordsForConnector,
  removeInstalledPlatformPackRecord,
  type InstalledPlatformPackRecord,
} from './installedPlatformPacks';
import {
  getPlatformInstance,
  listPlatformInstances,
  removePlatformInstance,
  upsertPlatformInstance,
} from './instanceRegistry';
import { clearNeteaseFacadeCaches } from './neteaseFacade';
import {
  BILIBILI_CONNECTOR_ID,
  NETEASE_CONNECTOR_ID,
} from './platformConnectorModel';
import {
  getPlatformImportedInstanceRecord,
  getPlatformImportedInstanceRecordByInstallationId,
  removePlatformImportedInstanceRecordByInstallationId,
  type PlatformImportedInstanceRecord,
} from './platformImportedInstanceRegistry';
import {
  removePlatformPackRegistration,
  removePlatformPackRegistrationForInstallation,
} from './platformPackRegistry';
import { disposePlatformPackSidecar } from './platformPackSidecarBridge';
import {
  clearPlatformInstanceAuthCookies,
  logoutPlatformInstance,
} from './platformInstanceAuth';
import {
  persistPlatformLoginRegistry,
  readPlatformLoginRegistry,
  removePlatformLoginRegistryEntry,
} from './platformLoginRegistry';
import {
  getPlatformRenderSelection,
  removePlatformRenderSelection,
  setPlatformRenderSelectionMounted,
} from './renderSelectionRegistry';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function joinNormalizedFsPath(...segments: Array<string | undefined>): string {
  return segments
    .flatMap((segment) => normalizeString(segment).split('/'))
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/^([a-zA-Z]:)/, '$1');
}

function sanitizeCacheScopeKey(scopeKey: string | null | undefined): string {
  const normalized = normalizeString(scopeKey) || 'default';
  const sanitized = normalized
    .split('')
    .map((char) => (/[A-Za-z0-9_-]/.test(char) ? char : '_'))
    .join('')
    .replace(/^_+|_+$/g, '');
  return (sanitized || 'default').toLowerCase();
}

function clearConnectorScopedFacadeCaches(
  record: InstalledPlatformPackRecord,
  instanceId?: string | null
): void {
  if (record.connectorId === BILIBILI_CONNECTOR_ID) {
    clearBilibiliFacadeCaches(instanceId);
    return;
  }
  if (record.connectorId === NETEASE_CONNECTOR_ID) {
    clearNeteaseFacadeCaches(instanceId);
  }
}

function resolveInstalledPlatformPackScopedCacheDir(
  record: InstalledPlatformPackRecord,
  effectiveRootPath: string,
  instanceId?: string | null
): string | null {
  const normalizedRoot = normalizeFsPath(effectiveRootPath);
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedRoot || !normalizedInstanceId) {
    return null;
  }

  if (
    record.connectorId !== BILIBILI_CONNECTOR_ID &&
    record.connectorId !== NETEASE_CONNECTOR_ID
  ) {
    return null;
  }

  return joinNormalizedFsPath(
    normalizedRoot,
    record.platformId,
    'playback-cache',
    sanitizeCacheScopeKey(normalizedInstanceId)
  );
}

async function removeDirectoryIfExists(path: string): Promise<void> {
  const normalizedPath = normalizeFsPath(path);
  if (!normalizedPath || !isTauriRuntime()) {
    return;
  }

  const fs = await import('@tauri-apps/api/fs');
  const exists = await fs.exists(normalizedPath).catch(() => false);
  if (!exists) {
    return;
  }
  await fs.removeDir(normalizedPath, { recursive: true });
}

function resolveImportedInstanceForInstalledPack(options: {
  installationId: string;
  instanceId?: string | null;
}): PlatformImportedInstanceRecord | null {
  const normalizedInstanceId = normalizeString(options.instanceId);
  if (normalizedInstanceId) {
    return getPlatformImportedInstanceRecord(normalizedInstanceId);
  }
  return getPlatformImportedInstanceRecordByInstallationId(options.installationId);
}

function resolveInstalledPlatformPackInstanceId(options: {
  installationId: string;
  instanceId?: string | null;
}): string | null {
  const importedInstance = resolveImportedInstanceForInstalledPack(options);
  return normalizeString(options.instanceId) || importedInstance?.instanceId || null;
}

function clearPlatformInstanceLocalAuthState(instanceId: string): void {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return;
  }

  const record = getPlatformInstance(normalizedInstanceId);
  if (!record) {
    return;
  }

  upsertPlatformInstance({
    ...record,
    account: {},
    auth: {
      ...record.auth,
      status: 'empty',
      cookieUpdatedAtMs: undefined,
    },
    metadata: {
      ...record.metadata,
      authExpiresAtMs: undefined,
    },
  });
}

async function waitForPlatformPackTeardown(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof window.requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  } else {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  await new Promise<void>((resolve) => window.setTimeout(resolve, 32));
}

async function deactivateInstalledPlatformPackRuntime(
  record: InstalledPlatformPackRecord
): Promise<void> {
  if (normalizeString(record.sidecarPath)) {
    await disposePlatformPackSidecar(
      record.connectorId,
      record.sidecarPath as string,
      'platform-pack-unregister'
    ).catch(() => undefined);
  }
  await waitForPlatformPackTeardown();
}

async function hideInstalledPlatformPackWorkspaceForTeardown(
  instanceId: string | null
): Promise<(() => Promise<void>) | null> {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return null;
  }

  const selection = getPlatformRenderSelection(normalizedInstanceId);
  if (selection?.mounted !== true) {
    return null;
  }

  setPlatformRenderSelectionMounted(normalizedInstanceId, false);
  await waitForPlatformPackTeardown();

  return async () => {
    setPlatformRenderSelectionMounted(normalizedInstanceId, true);
    await waitForPlatformPackTeardown();
  };
}

async function removePlatformLoginRegistration(instanceId: string): Promise<void> {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return;
  }

  const current = readPlatformLoginRegistry(
    listPlatformConnectorDefinitions(),
    undefined,
    listPlatformInstances()
  );
  const next = removePlatformLoginRegistryEntry(current, normalizedInstanceId);
  if (next.length === current.length) {
    return;
  }
  await persistPlatformLoginRegistry(next);
}

export async function clearInstalledPlatformPackCaches(options: {
  installationId: string;
  instanceId?: string | null;
}): Promise<InstalledPlatformPackRecord | null> {
  const record = getInstalledPlatformPackRecord(options.installationId);
  if (!record) {
    return null;
  }

  const instanceId = resolveInstalledPlatformPackInstanceId(options);

  clearConnectorScopedFacadeCaches(record, instanceId);

  if (!isTauriRuntime()) {
    return record;
  }

  const settings = await getMusicPlatformGlobalCacheSettings();
  const scopedCacheDir = resolveInstalledPlatformPackScopedCacheDir(
    record,
    settings?.effectiveRootPath ?? '',
    instanceId
  );
  if (scopedCacheDir) {
    await removeDirectoryIfExists(scopedCacheDir);
  }

  return record;
}

export async function resetInstalledPlatformPackState(options: {
  installationId: string;
  instanceId?: string | null;
}): Promise<InstalledPlatformPackRecord | null> {
  const record = await clearInstalledPlatformPackCaches(options);
  if (!record) {
    return null;
  }

  const instanceId = resolveInstalledPlatformPackInstanceId(options);
  if (!instanceId) {
    return record;
  }

  await logoutPlatformInstance(instanceId).catch(() => null);
  await clearPlatformInstanceAuthCookies(instanceId).catch(() => null);
  clearPlatformInstanceLocalAuthState(instanceId);
  setPlatformRenderSelectionMounted(instanceId, false);

  return record;
}

export async function unregisterInstalledPlatformPack(options: {
  installationId: string;
  instanceId?: string | null;
}): Promise<InstalledPlatformPackRecord | null> {
  const record = getInstalledPlatformPackRecord(options.installationId);
  if (!record) {
    return null;
  }

  const instanceId = resolveInstalledPlatformPackInstanceId({
    installationId: record.installationId,
    instanceId: options.instanceId,
  });
  const restoreWorkspaceVisibility = await hideInstalledPlatformPackWorkspaceForTeardown(
    instanceId
  );

  let removedRecord: InstalledPlatformPackRecord | null = null;
  try {
    await clearInstalledPlatformPackCaches({
      installationId: record.installationId,
      instanceId,
    });

    await deactivateInstalledPlatformPackRuntime(record);

    removedRecord = await removeInstalledPlatformPackRecord(record.installationId);
    if (!removedRecord) {
      if (restoreWorkspaceVisibility) {
        await restoreWorkspaceVisibility();
      }
      return null;
    }
  } catch (error) {
    if (restoreWorkspaceVisibility) {
      await restoreWorkspaceVisibility();
    }
    throw error;
  }

  if (instanceId) {
    await logoutPlatformInstance(instanceId).catch(() => null);
    await clearPlatformInstanceAuthCookies(instanceId).catch(() => null);
    clearPlatformInstanceLocalAuthState(instanceId);
    setPlatformRenderSelectionMounted(instanceId, false);
  }

  if (instanceId) {
    await removePlatformLoginRegistration(instanceId);
    removePlatformRenderSelection(instanceId);
    removePlatformInstance(instanceId);
  }

  await removePlatformImportedInstanceRecordByInstallationId(record.installationId);
  const remainingConnectorInstallations =
    listInstalledPlatformPackRecordsForConnector(record.connectorId);
  if (remainingConnectorInstallations.length > 0) {
    removePlatformPackRegistrationForInstallation(record.installationId);
  } else {
    removePlatformPackRegistration(record.connectorId);
  }

  return removedRecord;
}
