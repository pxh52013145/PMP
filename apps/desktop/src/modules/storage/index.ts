/**
 * Storage domain boundary (public API).
 *
 * Prefer importing these helpers instead of calling `localStorage` directly in UI code.
 * This enables incremental improvements like batching, migration, or swapping storage backends.
 */
export {
  readString,
  readJson,
  writeString,
  writeJson,
  flushStorageWrites,
  type StorageWriteMode,
  type StorageWriteOptions,
} from './localStorage';
export { usePersistentSetting } from './usePersistentSetting';
export type { UsePersistentSettingOptions, PersistentFormat } from './usePersistentSetting';

