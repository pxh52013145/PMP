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
export {
  MagnetLibraryProvider,
  useMagnetConfig,
  type MagnetConfigContextValue,
  type MagnetLibraryProviderProps,
} from './MagnetLibraryProvider';
