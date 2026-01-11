import { describe, expect, it } from 'vitest';

import { REQUIRED_MAGNET_IDS } from '../../../constants/magnets';
import type { PixelAnchor } from '../../../types/pixel';
import type { MagnetSpaceLayout } from '../../../modules/magnets';
import { filterMagnetConfigSnapshotForImport, filterMagnetSpaceLayoutForImport } from '../profilePackApply';

describe('profile-pack apply filters', () => {
  it('filters magnet space layout to allowed ids while preserving required ids', () => {
    const anchors: PixelAnchor[] = [{ id: 'a', gridX: 0, gridY: 0, role: 'anchor' }];
    const layout: MagnetSpaceLayout = {
      version: 1,
      activeMagnetIds: ['btn-play-pause', 'custom-a', 'ghost', 'btn-play-pause'],
      anchorsByMagnetId: {
        'btn-play-pause': anchors,
        'custom-a': anchors,
        ghost: anchors,
        'drag-handle': anchors,
      },
    };

    const allowed = new Set<string>(['btn-play-pause', 'custom-a']);
    const filtered = filterMagnetSpaceLayoutForImport(layout, allowed);

    expect(filtered.activeMagnetIds).toContain('btn-play-pause');
    expect(filtered.activeMagnetIds).toContain('custom-a');
    expect(filtered.activeMagnetIds).not.toContain('ghost');

    for (const requiredId of REQUIRED_MAGNET_IDS) {
      expect(filtered.activeMagnetIds).toContain(requiredId);
    }

    expect(Object.keys(filtered.anchorsByMagnetId)).toContain('btn-play-pause');
    expect(Object.keys(filtered.anchorsByMagnetId)).toContain('custom-a');
    expect(Object.keys(filtered.anchorsByMagnetId)).toContain('drag-handle');
    expect(Object.keys(filtered.anchorsByMagnetId)).not.toContain('ghost');
  });

  it('filters config snapshots to allowed ids and strips embedded customMagnets', () => {
    const allowed = new Set<string>(['btn-play-pause', 'custom-a']);
    const filtered = filterMagnetConfigSnapshotForImport(
      {
        version: '1.1.0',
        magnets: {
          'btn-play-pause': { isActive: true },
          'custom-a': { isActive: true },
          ghost: { isActive: false },
          'drag-handle': { isActive: true },
        },
        customMagnets: [{ id: 'custom-a' }, { id: 'ghost' }],
        extra: { keep: true },
      },
      allowed
    );

    expect(filtered.customMagnets).toEqual([]);
    expect(filtered.extra).toEqual({ keep: true });

    const magnets = filtered.magnets as Record<string, unknown>;
    expect(Object.keys(magnets)).toContain('btn-play-pause');
    expect(Object.keys(magnets)).toContain('custom-a');
    expect(Object.keys(magnets)).toContain('drag-handle');
    expect(Object.keys(magnets)).not.toContain('ghost');
  });
});

