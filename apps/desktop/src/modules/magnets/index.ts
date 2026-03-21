/**
 * Magnets domain boundary (public API).
 *
 * App-level orchestration should depend on these exports instead of directly:
 * - assembling `data/builtin/*` magnet lists
 * - duplicating initial config/persistence logic
 *
 * This is intentionally small to enable incremental refactors.
 */
export { createDefaultMagnetLibrary } from './defaultLibrary';
export { createInitialMagnetState } from './state';
export type { MagnetStateSnapshot, CreateInitialMagnetStateOptions } from './state';
export { applyMagnetConfig, loadMagnetConfig, saveMagnetConfig } from './config';
export type { MagnetConfig, MagnetStateConfig } from './config';
export { resolveMagnetConfigStorageKey } from './config';
export type { MagnetSpace, MagnetSpacesState } from './spaces';
export {
  createDefaultMagnetSpacesState,
  createNextSpaceId,
  getNextSpaceId,
  sanitizeMagnetSpacesState,
} from './spaces';
export type { MagnetSpaceLayout, MagnetSpaceLayoutV1 } from './layout';
export { resolveMagnetLayoutStorageKey, sanitizeMagnetSpaceLayout } from './layout';
export type {
  MagnetLayoutStoreApplyPatchRequest,
  MagnetLayoutStoreApplyPatchResponse,
  MagnetLayoutStoreApplyPatchFn,
  MagnetLayoutStoreBootstrapRequest,
  MagnetLayoutStoreBootstrapResponse,
  MagnetLayoutStorePatch,
  MagnetLayoutStoreState,
  MagnetLayoutStoreStateV1,
  MagnetSpacePreset,
  MagnetSpacePresetV1,
  MagnetSpaceHistoryItem,
  MagnetSpaceHistoryItemV1,
} from './layoutStore';
export {
  buildMagnetLayoutStoreBootstrapRequest,
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
} from './layoutStore';
export type { MagnetCatalogState } from './catalog';
export {
  createDefaultMagnetCatalogState,
  ensureMagnetCatalogState,
  readMagnetCatalogState,
  removeMagnetCatalogMagnet,
  sanitizeMagnetCatalogState,
  upsertMagnetCatalogMagnet,
  writeMagnetCatalogState,
} from './catalog';
export {
  cancelScheduledMagnetSpaceLayoutSave,
  createDefaultMagnetSpaceLayout,
  ensureMagnetSpaceLayout,
  flushScheduledMagnetSpaceLayoutSave,
  loadMagnetSpaceLayout,
  saveMagnetSpaceLayout,
  scheduleSaveMagnetSpaceLayout,
} from './layoutStorage';
export {
  MagnetLibraryProvider,
  useMagnetConfig,
  type MagnetConfigContextValue,
  type MagnetLibraryProviderProps,
} from './MagnetLibraryProvider';
export type { MagnetChromeOverrideMode } from './chromeOverride';
export {
  readMagnetChromeOverrideMode,
  setMagnetChromeOverrideMode,
  useMagnetChromeOverrideMode,
} from './chromeOverride';
