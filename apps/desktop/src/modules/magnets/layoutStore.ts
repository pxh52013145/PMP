import { invoke } from '@tauri-apps/api/tauri';
import { DEFAULT_ACTIVE_MAGNET_IDS } from '../../constants/magnets';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson } from '../storage';
import {
  createDefaultMagnetSpacesState,
  sanitizeMagnetSpacesState,
  type MagnetSpacesState,
} from './spaces';
import type { MagnetSpaceLayout } from './layout';
import { ensureMagnetSpaceLayout } from './layoutStorage';

export type MagnetSpacePresetV1 = {
  id: string;
  name: string;
  createdAt: number;
  layout: MagnetSpaceLayout;
};

export type MagnetSpacePreset = MagnetSpacePresetV1;

export type MagnetSpaceHistoryItemV1 = {
  id: string;
  reason: string;
  createdAt: number;
  layout: MagnetSpaceLayout;
};

export type MagnetSpaceHistoryItem = MagnetSpaceHistoryItemV1;

export type MagnetLayoutStoreStateV1 = {
  version: 1;
  revision: number;
  spaces: MagnetSpacesState;
  layoutsBySpaceId: Record<string, MagnetSpaceLayout>;
  presetsBySpaceId: Record<string, MagnetSpacePreset[]>;
  historyBySpaceId: Record<string, MagnetSpaceHistoryItem[]>;
};

export type MagnetLayoutStoreState = MagnetLayoutStoreStateV1;

export type MagnetLayoutStoreBootstrapRequest = {
  spaces: MagnetSpacesState;
  layoutsBySpaceId: Record<string, MagnetSpaceLayout>;
};

export type MagnetLayoutStoreBootstrapResponse = {
  didBootstrap: boolean;
  state: MagnetLayoutStoreState;
};

export type MagnetLayoutStorePatch =
  | { kind: 'setActiveSpaceId'; spaceId: string }
  | { kind: 'setSpacesState'; spaces: MagnetSpacesState }
  | { kind: 'setSpaceLayout'; spaceId: string; layout: MagnetSpaceLayout }
  | { kind: 'setActiveMagnetIds'; spaceId: string; activeMagnetIds: string[] }
  | { kind: 'setMagnetActive'; spaceId: string; magnetId: string; active: boolean }
  | {
      kind: 'updateMagnetAnchors';
      spaceId: string;
      magnetId: string;
      anchors: MagnetSpaceLayout['anchorsByMagnetId'][string];
    }
  | { kind: 'upsertSpacePreset'; spaceId: string; preset: MagnetSpacePreset }
  | { kind: 'deleteSpacePreset'; spaceId: string; presetId: string }
  | { kind: 'pushSpaceHistory'; spaceId: string; item: MagnetSpaceHistoryItem }
  | { kind: 'deleteSpaceHistoryItem'; spaceId: string; historyId: string }
  | { kind: 'clearSpaceHistory'; spaceId: string };

export type MagnetLayoutStoreApplyPatchRequest = {
  expectedRevision: number;
  patches: MagnetLayoutStorePatch[];
  reason?: string;
};

export type MagnetLayoutStoreApplyPatchResponse = {
  ok: boolean;
  state: MagnetLayoutStoreState;
  error: null | { code: string; message: string };
};

export function buildLegacyMagnetLayoutStoreBootstrapRequest(
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetLayoutStoreBootstrapRequest {
  const spacesRaw = readJson<unknown>(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState());
  const spaces = sanitizeMagnetSpacesState(spacesRaw);

  const layoutsBySpaceId: Record<string, MagnetSpaceLayout> = {};
  for (const space of spaces.spaces) {
    const { layout } = ensureMagnetSpaceLayout(space.id, { defaultActiveMagnetIds });
    layoutsBySpaceId[space.id] = layout;
  }

  return { spaces, layoutsBySpaceId };
}

export async function magnetLayoutStoreGetState(): Promise<MagnetLayoutStoreState | null> {
  if (!isTauriRuntime()) return null;
  try {
    return (await invoke('magnet_layout_store_get_state')) as MagnetLayoutStoreState;
  } catch (error) {
    console.warn('[magnets] Failed to get magnet layout store state', error);
    return null;
  }
}

export async function magnetLayoutStoreBootstrapFromLegacy(
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): Promise<MagnetLayoutStoreBootstrapResponse | null> {
  if (!isTauriRuntime()) return null;

  try {
    const request = buildLegacyMagnetLayoutStoreBootstrapRequest(defaultActiveMagnetIds);
    return (await invoke('magnet_layout_store_bootstrap', { request })) as MagnetLayoutStoreBootstrapResponse;
  } catch (error) {
    console.warn('[magnets] Failed to bootstrap magnet layout store', error);
    return null;
  }
}

export async function magnetLayoutStoreApplyPatch(
  request: MagnetLayoutStoreApplyPatchRequest
): Promise<MagnetLayoutStoreApplyPatchResponse | null> {
  if (!isTauriRuntime()) return null;

  try {
    return (await invoke('magnet_layout_store_apply_patch', { request })) as MagnetLayoutStoreApplyPatchResponse;
  } catch (error) {
    console.warn('[magnets] Failed to apply magnet layout store patch', error);
    return null;
  }
}

export type MagnetLayoutStoreApplyPatchFn = (
  request: MagnetLayoutStoreApplyPatchRequest
) => Promise<MagnetLayoutStoreApplyPatchResponse | null>;

export async function magnetLayoutStoreApplyPatchWithRetry(
  request: MagnetLayoutStoreApplyPatchRequest,
  options: { maxRetries?: number; applyPatch?: MagnetLayoutStoreApplyPatchFn } = {}
): Promise<MagnetLayoutStoreApplyPatchResponse | null> {
  const applyPatch = options.applyPatch ?? magnetLayoutStoreApplyPatch;
  const maxRetries = typeof options.maxRetries === 'number' && options.maxRetries >= 0 ? options.maxRetries : 1;
  const baseReason = request.reason ?? 'patch';

  let expectedRevision = request.expectedRevision;
  let response = await applyPatch(request);
  if (!response) return null;
  if (response.ok) return response;
  if (response.error?.code !== 'revisionConflict') return response;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const nextRevision = response.state.revision;
    if (nextRevision <= 0 || nextRevision === expectedRevision) return response;

    expectedRevision = nextRevision;
    response = await applyPatch({
      ...request,
      expectedRevision,
      reason: `${baseReason}:retry${attempt === 1 ? '' : attempt}`,
    });
    if (!response) return null;
    if (response.ok) return response;
    if (response.error?.code !== 'revisionConflict') return response;
  }

  return response;
}
