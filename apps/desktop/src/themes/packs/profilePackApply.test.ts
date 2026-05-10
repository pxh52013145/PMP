import { describe, expect, it } from 'vitest';

import {
  filterMagnetConfigSnapshotForImportWithReport,
  filterMagnetSpaceLayoutForImport,
  filterMagnetSpaceLayoutForImportWithReport,
} from './profilePackApply';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { MagnetSpaceLayout } from '../../modules/magnets';

const anchor = { id: 'a1', gridX: 0, gridY: 0, role: 'anchor' as const };

describe('profilePackApply', () => {
  it('reports skipped layout magnets while preserving compatible output', () => {
    const layout: MagnetSpaceLayout = {
      version: 1,
      activeMagnetIds: ['known', 'missing-active', 'known'],
      anchorsByMagnetId: {
        known: [anchor],
        'missing-anchor': [anchor],
      },
    };
    const allowed = new Set(['known']);

    const result = filterMagnetSpaceLayoutForImportWithReport(layout, allowed);

    expect(result.layout.activeMagnetIds).toContain('known');
    expect(result.layout.activeMagnetIds).not.toContain('missing-active');
    expect(result.layout.anchorsByMagnetId).toEqual({ known: [anchor] });
    expect(result.report.skippedMagnetIds).toEqual(['missing-active', 'missing-anchor']);
    expect(result.report.skippedCustomMagnetIds).toEqual([]);
    expect(filterMagnetSpaceLayoutForImport(layout, allowed)).toEqual(result.layout);
  });

  it('preserves required magnets without reporting them when they are not explicitly allowed', () => {
    const requiredId = [...REQUIRED_MAGNET_IDS][0];
    const layout: MagnetSpaceLayout = {
      version: 1,
      activeMagnetIds: ['known', requiredId, 'missing'],
      anchorsByMagnetId: {
        [requiredId]: [anchor],
        missing: [anchor],
      },
    };

    const result = filterMagnetSpaceLayoutForImportWithReport(layout, new Set(['known']));

    expect(result.layout.activeMagnetIds).toEqual(['known', ...REQUIRED_MAGNET_IDS]);
    expect(result.layout.anchorsByMagnetId).toEqual({ [requiredId]: [anchor] });
    expect(result.report.skippedMagnetIds).toEqual(['missing']);
    expect(result.report.skippedCustomMagnetIds).toEqual([]);
  });

  it('reports skipped config magnets and clears embedded custom magnets', () => {
    const result = filterMagnetConfigSnapshotForImportWithReport(
      {
        magnets: {
          known: { value: 1 },
          missing: { value: 2 },
        },
        customMagnets: [{ id: 'embedded' }],
      },
      new Set(['known'])
    );

    expect(result.value).toEqual({
      magnets: {
        known: { value: 1 },
      },
      customMagnets: [],
    });
    expect(result.report.skippedMagnetIds).toEqual(['missing']);
    expect(result.report.skippedCustomMagnetIds).toEqual(['embedded']);
  });

  it('does not report skipped config magnets when config magnets are absent', () => {
    const result = filterMagnetConfigSnapshotForImportWithReport(
      {
        magnets: null,
        customMagnets: [{ id: 'embedded' }],
      },
      new Set(['known'])
    );

    expect(result.value).toEqual({
      magnets: null,
      customMagnets: [],
    });
    expect(result.report.skippedMagnetIds).toEqual([]);
    expect(result.report.skippedCustomMagnetIds).toEqual(['embedded']);
  });
});
