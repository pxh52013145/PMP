import { Magnet } from '../../types/pixel';
import { DEFAULT_ACTIVE_MAGNET_IDS } from '../../constants/magnets';
import { detectConflicts, resolveMagnetPositions } from '../../utils/magnetPositionResolver';
import { applyMagnetConfig, loadMagnetConfig } from './config';

export interface MagnetStateSnapshot {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
}

export interface CreateInitialMagnetStateOptions {
  defaultActiveMagnetIds?: ReadonlySet<string>;
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
  const savedConfig = loadMagnetConfig();
  if (savedConfig) {
    const applied = applyMagnetConfig(savedConfig, defaultMagnetLibrary);
    return {
      magnetLibrary: applied.magnetLibrary,
      activeMagnetIds: new Set(applied.activeMagnetIds),
    };
  }

  const conflicts = detectConflicts(defaultMagnetLibrary);
  if (conflicts.length > 0) {
    console.warn(`🔧 首次加载检测到 ${conflicts.length} 个位置冲突，正在自动解决...`);
    conflicts.forEach((conflict) => {
      console.warn(
        `   - "${conflict.magnet1}" 与 "${conflict.magnet2}" 在 ${conflict.conflictPixels.length} 个像素位置冲突`
      );
    });
  }

  const resolvedMagnets = resolveMagnetPositions(defaultMagnetLibrary);
  return {
    magnetLibrary: resolvedMagnets,
    activeMagnetIds: new Set(options.defaultActiveMagnetIds ?? DEFAULT_ACTIVE_MAGNET_IDS),
  };
}
