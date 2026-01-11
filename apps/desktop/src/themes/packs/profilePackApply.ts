import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { MagnetSpaceLayout } from '../../modules/magnets';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function filterMagnetSpaceLayoutForImport(
  layout: MagnetSpaceLayout,
  allowedMagnetIds: ReadonlySet<string>
): MagnetSpaceLayout {
  const activeMagnetIds: string[] = [];
  const seen = new Set<string>();

  for (const magnetId of layout.activeMagnetIds) {
    if (!allowedMagnetIds.has(magnetId)) continue;
    if (seen.has(magnetId)) continue;
    seen.add(magnetId);
    activeMagnetIds.push(magnetId);
  }

  for (const requiredId of REQUIRED_MAGNET_IDS) {
    if (seen.has(requiredId)) continue;
    seen.add(requiredId);
    activeMagnetIds.push(requiredId);
  }

  const anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {};
  for (const [magnetId, anchors] of Object.entries(layout.anchorsByMagnetId)) {
    if (!allowedMagnetIds.has(magnetId) && !REQUIRED_MAGNET_IDS.has(magnetId)) continue;
    anchorsByMagnetId[magnetId] = anchors;
  }

  return { ...layout, activeMagnetIds, anchorsByMagnetId };
}

export function filterMagnetConfigSnapshotForImport(
  value: Record<string, unknown>,
  allowedMagnetIds: ReadonlySet<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };

  const rawMagnets = result.magnets;
  if (isPlainObject(rawMagnets)) {
    const filtered: Record<string, unknown> = {};
    for (const [magnetId, magnetState] of Object.entries(rawMagnets)) {
      if (!allowedMagnetIds.has(magnetId) && !REQUIRED_MAGNET_IDS.has(magnetId)) continue;
      filtered[magnetId] = magnetState;
    }
    result.magnets = filtered;
  }

  result.customMagnets = [];
  return result;
}

