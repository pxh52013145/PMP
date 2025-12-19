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

  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
  }

  scheduledSaveTimeout = window.setTimeout(() => {
    scheduledSaveTimeout = null;
    const args = scheduledSaveArgs;
    scheduledSaveArgs = null;
    if (!args) return;
    try {
      saveMagnetConfig(args.magnetLibrary, args.activeMagnetIds, args.gridSize, args.defaultMagnetLibrary);
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
