import { Magnet } from '../../types/pixel';
import {
  applyConfig,
  loadConfig,
  saveConfig,
  type MagnetConfig,
  type MagnetStateConfig,
} from '../../utils/configManager';

export type { MagnetConfig, MagnetStateConfig };

export interface ScheduleSaveMagnetConfigOptions {
  debounceMs?: number;
  afterSave?: () => void | Promise<void>;
}

let scheduledSaveTimeout: number | null = null;
let scheduledSaveArgs:
  | {
      magnetLibrary: Magnet[];
      activeMagnetIds: Set<string>;
      gridSize: { columns: number; rows: number };
      defaultMagnetLibrary?: Magnet[];
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
export function loadMagnetConfig(): MagnetConfig | null {
  return loadConfig();
}

export function saveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[]
): void {
  saveConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary);
}

export function scheduleSaveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  options: ScheduleSaveMagnetConfigOptions = {}
): void {
  const debounceMs = options.debounceMs ?? 300;

  scheduledSaveArgs = { magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary };
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
      saveMagnetConfig(args.magnetLibrary, args.activeMagnetIds, args.gridSize, args.defaultMagnetLibrary);
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
    saveMagnetConfig(args.magnetLibrary, args.activeMagnetIds, args.gridSize, args.defaultMagnetLibrary);
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
