import { BUILTIN_MAGNET_IDS } from '../../../constants/magnets';
import {
  createDefaultMagnetSpacesState,
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  sanitizeMagnetSpacesState,
  type MagnetLayoutStorePatch,
} from '../../../modules/magnets';
import { readJson, writeDurableText } from '../../../modules/storage';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../../utils/windowCommunication';
import type { ThemeImportCandidate } from '../../../themes/types/themeImport';
import type { InstallPlanExecutorBackup, InstallPlanExecutorContext } from './installPlanExecutorTypes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeBackupId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (normalized || 'install-plan').slice(0, 160);
}

async function loadMagnetLayoutStoreState() {
  if (!isTauriRuntime()) return null;
  const bootstrapped = await magnetLayoutStoreBootstrap(BUILTIN_MAGNET_IDS, 'all-known-spaces');
  return bootstrapped?.state ?? (await magnetLayoutStoreGetState());
}

async function applyMagnetLayoutPatches(patches: MagnetLayoutStorePatch[], reason: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const store = await magnetLayoutStoreGetState();
  const response = await magnetLayoutStoreApplyPatchWithRetry({
    expectedRevision: store?.revision ?? 0,
    patches,
    reason,
  });
  return Boolean(response?.ok);
}

export async function createInstallPlanBackup(
  planId: string,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorBackup> {
  if (!context.currentTheme) {
    throw new Error('Install plan backup requires the current theme snapshot');
  }

  const store = await loadMagnetLayoutStoreState();
  const spaces =
    store?.spaces ??
    sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));

  const layoutsBySpaceId: Record<string, unknown> = {};
  const configsBySpaceId: Record<string, unknown> = {};

  for (const space of spaces.spaces) {
    const storeLayout = store?.layoutsBySpaceId?.[space.id];
    if (storeLayout) {
      layoutsBySpaceId[space.id] = storeLayout;
    } else {
      const layoutRaw = readJson<unknown | null>(resolveMagnetLayoutStorageKey(space.id), null);
      if (layoutRaw !== null) {
        layoutsBySpaceId[space.id] = sanitizeMagnetSpaceLayout(layoutRaw);
      }
    }

    const configRaw = readJson<unknown | null>(resolveMagnetConfigStorageKey(space.id), null);
    if (isPlainObject(configRaw)) {
      configsBySpaceId[space.id] = configRaw;
    }
  }

  const backupId = `${sanitizeBackupId(planId)}-${Date.now().toString(36)}`;
  const snapshot = {
    formatVersion: '1.0',
    planId,
    createdAt: Date.now(),
    theme: context.currentTheme,
    magnets: {
      spaces,
      layoutsBySpaceId,
      configsBySpaceId,
    },
  };

  const snapshotText = JSON.stringify(snapshot);
  const written = await writeDurableText('install-plan-backup', backupId, snapshotText);
  if (!written) {
    throw new Error('failed to write install plan backup');
  }

  return {
    id: backupId,
    createdAt: snapshot.createdAt,
    durableKey: `install-plan-backup:${backupId}`,
    snapshotText,
  };
}

export async function restoreInstallPlanBackup(
  backupJson: string,
  context: InstallPlanExecutorContext
): Promise<void> {
  if (!context.applyTheme) {
    throw new Error('Install plan backup restore requires an applyTheme callback');
  }

  const parsed = JSON.parse(backupJson) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error('backup must be an object');
  }

  await context.applyTheme(parsed.theme as ThemeImportCandidate);

  const magnets = parsed.magnets;
  if (!isPlainObject(magnets)) {
    throw new Error('backup.magnets must be an object');
  }

  const spaces = sanitizeMagnetSpacesState(magnets.spaces);
  const spaceIds = new Set(spaces.spaces.map((space) => space.id));
  const layoutsBySpaceId = magnets.layoutsBySpaceId;
  const configsBySpaceId = magnets.configsBySpaceId;

  if (isTauriRuntime() && isPlainObject(layoutsBySpaceId)) {
    const patches: MagnetLayoutStorePatch[] = [{ kind: 'setSpacesState', spaces }];
    for (const [spaceId, layoutValue] of Object.entries(layoutsBySpaceId)) {
      if (!spaceIds.has(spaceId)) continue;
      if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
      patches.push({ kind: 'setSpaceLayout', spaceId, layout: sanitizeMagnetSpaceLayout(layoutValue) });
    }
    const ok = await applyMagnetLayoutPatches(patches, 'installPlan.backupRestore');
    if (!ok) {
      throw new Error('failed to restore magnet layout store backup');
    }
  } else if (isPlainObject(layoutsBySpaceId)) {
    for (const [spaceId, layoutValue] of Object.entries(layoutsBySpaceId)) {
      if (!spaceIds.has(spaceId)) continue;
      if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
      await broadcastDataUpdate(resolveMagnetLayoutStorageKey(spaceId), sanitizeMagnetSpaceLayout(layoutValue));
    }
  }

  if (isPlainObject(configsBySpaceId)) {
    for (const [spaceId, configValue] of Object.entries(configsBySpaceId)) {
      if (!spaceIds.has(spaceId)) continue;
      if (!isPlainObject(configValue)) continue;
      await broadcastDataUpdate(resolveMagnetConfigStorageKey(spaceId), configValue);
    }
  }

  if (!isTauriRuntime()) {
    await broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, spaces, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
  }
}
