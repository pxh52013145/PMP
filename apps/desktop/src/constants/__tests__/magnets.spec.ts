import { describe, it, expect } from 'vitest';
import { BUILTIN_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../magnets';

describe('magnets constants', () => {
  it('keeps required magnets stable and builtin', () => {
    const expected = [
      'drag-handle',
      'btn-minimize',
      'btn-maximize',
      'btn-close',
      'btn-window-pin',
      'btn-matrix-change',
      'btn-editor',
    ];

    expect([...REQUIRED_MAGNET_IDS]).toEqual(expected);
    for (const id of REQUIRED_MAGNET_IDS) {
      expect(BUILTIN_MAGNET_IDS.has(id)).toBe(true);
    }
  });
});

