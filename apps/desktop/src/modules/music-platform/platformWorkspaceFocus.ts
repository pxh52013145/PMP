import { readJson } from '../storage';
import { getPlatformInstance } from './instanceRegistry';
import { setActiveMusicPlatformInstance } from './activeInstanceRegistry';
import { setPlatformRenderSelectionMounted } from './renderSelectionRegistry';
import { createDefaultMagnetSpacesState, sanitizeMagnetSpacesState } from '../magnets/spaces';
import {
  createDefaultMagnetSpaceLayout,
  ensureMagnetSpaceLayout,
  saveMagnetSpaceLayout,
} from '../magnets/layoutStorage';
import { resolveMagnetLayoutStorageKey } from '../magnets/layout';
import {
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreGetState,
  type MagnetLayoutStorePatch,
} from '../magnets/layoutStore';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  broadcastSignal,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export interface FocusMusicPlatformWorkspaceResult {
  instanceId: string;
  connectorId: string | null;
  targetSpaceId: string;
}

const PLATFORM_WORKSPACE_SPACE_ID = 'space2';
const PLATFORM_WORKSPACE_MAGNET_IDS = ['platform-magnet', 'btn-platform-login'] as const;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConnectorId(value: unknown): string | null {
  const connectorId = normalizeString(value).toLowerCase();
  return connectorId.startsWith('connector.platform.') ? connectorId : null;
}

async function focusPlatformWorkspaceSpaceViaLayoutStore(): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const store = await magnetLayoutStoreGetState();
  if (!store) return false;

  const layout =
    store.layoutsBySpaceId[PLATFORM_WORKSPACE_SPACE_ID] ??
    createDefaultMagnetSpaceLayout(PLATFORM_WORKSPACE_SPACE_ID);
  const active = new Set(layout.activeMagnetIds);
  const patches: MagnetLayoutStorePatch[] = [];

  if (store.spaces.activeSpaceId !== PLATFORM_WORKSPACE_SPACE_ID) {
    patches.push({ kind: 'setActiveSpaceId', spaceId: PLATFORM_WORKSPACE_SPACE_ID });
  }

  for (const magnetId of PLATFORM_WORKSPACE_MAGNET_IDS) {
    if (active.has(magnetId)) continue;
    patches.push({
      kind: 'setMagnetActive',
      spaceId: PLATFORM_WORKSPACE_SPACE_ID,
      magnetId,
      active: true,
    });
  }

  if (patches.length === 0) return true;

  const response = await magnetLayoutStoreApplyPatchWithRetry({
    expectedRevision: store.revision,
    patches,
    reason: 'platform-pack-dev-focus-workspace',
  });
  if (!response) return false;
  if (!response.ok) {
    throw new Error(
      response.error?.message ?? 'Failed to focus the platform workspace space'
    );
  }
  return true;
}

async function focusPlatformWorkspaceSpaceViaStorage(): Promise<void> {
  const currentSpaces = sanitizeMagnetSpacesState(
    readJson<unknown>(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState())
  );
  if (currentSpaces.activeSpaceId !== PLATFORM_WORKSPACE_SPACE_ID) {
    await broadcastDataUpdate(
      STORAGE_KEYS.MAGNET_SPACES,
      {
        ...currentSpaces,
        activeSpaceId: PLATFORM_WORKSPACE_SPACE_ID,
      },
      TAURI_EVENTS.MAGNET_SPACES_UPDATED
    );
  }

  const { layout, storageKey } = ensureMagnetSpaceLayout(PLATFORM_WORKSPACE_SPACE_ID);
  const active = new Set(layout.activeMagnetIds);
  let changed = false;
  for (const magnetId of PLATFORM_WORKSPACE_MAGNET_IDS) {
    if (active.has(magnetId)) continue;
    active.add(magnetId);
    changed = true;
  }
  if (!changed) return;

  saveMagnetSpaceLayout(
    {
      ...layout,
      activeMagnetIds: Array.from(active),
    },
    storageKey ?? resolveMagnetLayoutStorageKey(PLATFORM_WORKSPACE_SPACE_ID)
  );
  await broadcastSignal(TAURI_EVENTS.MAGNET_ACTIVATED);
}

async function focusPlatformWorkspaceSpace(): Promise<void> {
  const focusedViaLayoutStore = await focusPlatformWorkspaceSpaceViaLayoutStore();
  if (focusedViaLayoutStore) return;
  await focusPlatformWorkspaceSpaceViaStorage();
}

export async function focusMusicPlatformWorkspaceInstance(input: {
  instanceId: string;
  connectorId?: string | null;
}): Promise<FocusMusicPlatformWorkspaceResult> {
  const instanceId = normalizeString(input.instanceId);
  if (!instanceId) {
    throw new Error('Platform workspace focus requires an instance id');
  }

  const instance = getPlatformInstance(instanceId);
  if (!instance) {
    throw new Error(`Platform workspace instance is not registered: ${instanceId}`);
  }

  const connectorId =
    normalizeConnectorId(input.connectorId) ??
    normalizeConnectorId(instance.metadata?.connectorId) ??
    null;

  setPlatformRenderSelectionMounted(instanceId, true);
  await setActiveMusicPlatformInstance({
    instanceId,
    connectorId,
  });
  await focusPlatformWorkspaceSpace();

  return {
    instanceId,
    connectorId,
    targetSpaceId: PLATFORM_WORKSPACE_SPACE_ID,
  };
}
