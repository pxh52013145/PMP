import { Magnet } from '../../types/pixel';
import {
  applyConfig,
  loadConfig,
  saveConfig,
  type MagnetConfig,
  type MagnetStateConfig,
} from '../../utils/configManager';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type { MagnetConfig, MagnetStateConfig };

export interface ScheduleSaveMagnetConfigOptions {
  debounceMs?: number;
  afterSave?: () => void | Promise<void>;
  storageKey?: string;
}

let scheduledSaveTimeout: number | null = null;
let scheduledSaveArgs:
  | {
      magnetLibrary: Magnet[];
      activeMagnetIds: Set<string>;
      gridSize: { columns: number; rows: number };
      defaultMagnetLibrary?: Magnet[];
      storageKey?: string;
    }
  | null = null;
let scheduledAfterSave: null | (() => void | Promise<void>) = null;

/**
 * Magnets persistence/config public API.
 *
 * This module is the stable import surface for magnet config:
 * - load/save from storage
 * - apply config onto a default magnet library
 *
 * Under the hood it currently delegates to `utils/configManager.ts`.
 */
export function loadMagnetConfig(storageKey?: string): MagnetConfig | null {
  return loadConfig(storageKey);
}

export function saveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  storageKey?: string
): void {
  saveConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, storageKey);
}

export function scheduleSaveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  options: ScheduleSaveMagnetConfigOptions = {}
): void {
  const debounceMs = options.debounceMs ?? 300;
  const storageKey = options.storageKey;

  scheduledSaveArgs = { magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, storageKey };
  scheduledAfterSave = options.afterSave ?? null;

  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
  }

  scheduledSaveTimeout = window.setTimeout(() => {
    scheduledSaveTimeout = null;
    const args = scheduledSaveArgs;
    scheduledSaveArgs = null;
    const afterSave = scheduledAfterSave;
    scheduledAfterSave = null;
    if (!args) return;
    try {
      saveMagnetConfig(
        args.magnetLibrary,
        args.activeMagnetIds,
        args.gridSize,
        args.defaultMagnetLibrary,
        args.storageKey
      );
      if (afterSave) {
        Promise.resolve(afterSave()).catch((error) => {
          console.warn('[magnets] afterSave callback failed', error);
        });
      }
    } catch (error) {
      console.warn('[magnets] Failed to save config (scheduled)', error);
    }
  }, debounceMs);
}

export function cancelScheduledMagnetConfigSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }
  scheduledSaveArgs = null;
  scheduledAfterSave = null;
}

export function flushScheduledMagnetConfigSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }

  const args = scheduledSaveArgs;
  scheduledSaveArgs = null;
  const afterSave = scheduledAfterSave;
  scheduledAfterSave = null;

  if (!args) return;

  try {
    saveMagnetConfig(
      args.magnetLibrary,
      args.activeMagnetIds,
      args.gridSize,
      args.defaultMagnetLibrary,
      args.storageKey
    );
    if (afterSave) {
      Promise.resolve(afterSave()).catch((error) => {
        console.warn('[magnets] afterSave callback failed', error);
      });
    }
  } catch (error) {
    console.warn('[magnets] Failed to save config (flush)', error);
  }
}

export function applyMagnetConfig(
  config: MagnetConfig,
  defaultMagnetLibrary: Magnet[]
): {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
} {
  return applyConfig(config, defaultMagnetLibrary);
}

export const MATRIX2_MAGNET_CONFIG_STORAGE_KEY = `${STORAGE_KEYS.CONFIG}:matrix2`;

export function resolveMagnetConfigStorageKey(
  workbenchLayoutId: string | null | undefined
): string {
  return workbenchLayoutId === 'matrix2' ? MATRIX2_MAGNET_CONFIG_STORAGE_KEY : STORAGE_KEYS.CONFIG;
}
