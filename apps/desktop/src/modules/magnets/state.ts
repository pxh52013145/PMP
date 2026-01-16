import { Magnet } from '../../types/pixel';
import { DEFAULT_ACTIVE_MAGNET_IDS } from '../../constants/magnets';
import { applyMagnetConfig, loadMagnetConfig } from './config';
import { createDefaultMagnetSpaceLayout } from './layoutStorage';

export interface MagnetStateSnapshot {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
}

export interface CreateInitialMagnetStateOptions {
  defaultActiveMagnetIds?: ReadonlySet<string>;
  storageKey?: string;
}

/**
 * Computes initial magnet library + active ids.
 *
 * - If a persisted config exists, it is loaded and applied.
 * - Otherwise, the builtin library is conflict-resolved and default active ids are used.
 */
export function createInitialMagnetState(
  defaultMagnetLibrary: Magnet[],
  options: CreateInitialMagnetStateOptions = {}
): MagnetStateSnapshot {
  const savedConfig = loadMagnetConfig(options.storageKey);
  if (savedConfig) {
    const applied = applyMagnetConfig(savedConfig, defaultMagnetLibrary);
    return {
      magnetLibrary: applied.magnetLibrary,
      activeMagnetIds: new Set(applied.activeMagnetIds),
    };
  }

  const defaultActiveMagnetIds = options.defaultActiveMagnetIds ?? DEFAULT_ACTIVE_MAGNET_IDS;
  const layout = createDefaultMagnetSpaceLayout('space1', defaultActiveMagnetIds);

  const resolvedMagnets = defaultMagnetLibrary.map((magnet) => {
    const anchors = layout.anchorsByMagnetId[magnet.id];
    if (!Array.isArray(anchors) || anchors.length === 0) return magnet;
    return { ...magnet, anchors: anchors.map((a) => ({ ...a })) };
  });

  return { magnetLibrary: resolvedMagnets, activeMagnetIds: new Set(layout.activeMagnetIds) };
}
