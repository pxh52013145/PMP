import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { MagnetSpaceLayout } from '../../modules/magnets';

export type MagnetProfileImportFilterReport = {
  skippedMagnetIds: string[];
  skippedCustomMagnetIds: string[];
};

export type MagnetSpaceLayoutImportFilterResult = {
  layout: MagnetSpaceLayout;
  report: MagnetProfileImportFilterReport;
};

export type MagnetConfigSnapshotImportFilterResult = {
  value: Record<string, unknown>;
  report: MagnetProfileImportFilterReport;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function filterMagnetSpaceLayoutForImportWithReport(
  layout: MagnetSpaceLayout,
  allowedMagnetIds: ReadonlySet<string>
): MagnetSpaceLayoutImportFilterResult {
  const activeMagnetIds: string[] = [];
  const skippedMagnetIds = new Set<string>();
  const seen = new Set<string>();

  for (const magnetId of layout.activeMagnetIds) {
    if (!allowedMagnetIds.has(magnetId)) {
      if (!REQUIRED_MAGNET_IDS.has(magnetId)) {
        skippedMagnetIds.add(magnetId);
      }
      continue;
    }
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
    if (!allowedMagnetIds.has(magnetId) && !REQUIRED_MAGNET_IDS.has(magnetId)) {
      skippedMagnetIds.add(magnetId);
      continue;
    }
    anchorsByMagnetId[magnetId] = anchors;
  }

  return {
    layout: { ...layout, activeMagnetIds, anchorsByMagnetId },
    report: { skippedMagnetIds: [...skippedMagnetIds].sort(), skippedCustomMagnetIds: [] },
  };
}

export function filterMagnetSpaceLayoutForImport(
  layout: MagnetSpaceLayout,
  allowedMagnetIds: ReadonlySet<string>
): MagnetSpaceLayout {
  return filterMagnetSpaceLayoutForImportWithReport(layout, allowedMagnetIds).layout;
}

export function filterMagnetConfigSnapshotForImportWithReport(
  value: Record<string, unknown>,
  allowedMagnetIds: ReadonlySet<string>
): MagnetConfigSnapshotImportFilterResult {
  const result: Record<string, unknown> = { ...value };
  const skippedMagnetIds = new Set<string>();
  const skippedCustomMagnetIds = new Set<string>();

  const rawMagnets = result.magnets;
  if (isPlainObject(rawMagnets)) {
    const filtered: Record<string, unknown> = {};
    for (const [magnetId, magnetState] of Object.entries(rawMagnets)) {
      if (!allowedMagnetIds.has(magnetId) && !REQUIRED_MAGNET_IDS.has(magnetId)) {
        skippedMagnetIds.add(magnetId);
        continue;
      }
      filtered[magnetId] = magnetState;
    }
    result.magnets = filtered;
  }

  const rawCustomMagnets = result.customMagnets;
  if (Array.isArray(rawCustomMagnets)) {
    for (const entry of rawCustomMagnets) {
      if (!isPlainObject(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id) skippedCustomMagnetIds.add(id);
    }
  }

  result.customMagnets = [];
  return {
    value: result,
    report: {
      skippedMagnetIds: [...skippedMagnetIds].sort(),
      skippedCustomMagnetIds: [...skippedCustomMagnetIds].sort(),
    },
  };
}

export function filterMagnetConfigSnapshotForImport(
  value: Record<string, unknown>,
  allowedMagnetIds: ReadonlySet<string>
): Record<string, unknown> {
  return filterMagnetConfigSnapshotForImportWithReport(value, allowedMagnetIds).value;
}

