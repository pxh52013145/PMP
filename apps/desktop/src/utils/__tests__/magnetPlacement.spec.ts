import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../types/pixel';
import {
  buildMagnetPlacementCandidates,
  findFirstMagnetPlacementCandidate,
  getOccupiedPixelKeys,
  magnetHasPlacementConflict,
} from '../magnetPlacement';

function createSingleMagnet(id: string, x: number, y: number): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchorType: 'single',
    anchors: [{ id: `${id}-anchor`, gridX: x, gridY: y, role: 'anchor' }],
    content: '',
    style: {},
    state: 'idle',
    interactions: { draggable: false, clickable: true },
  };
}

describe('magnetPlacement', () => {
  it('generates conflict-free candidates for a full-width horizontal magnet', () => {
    const magnet: Magnet = {
      id: 'progress-bar',
      type: 'progress-bar',
      name: 'ProgressBar',
      anchorType: 'horizontal',
      anchors: [
        { id: 'left', gridX: 0, gridY: 19, role: 'anchor' },
        { id: 'right', gridX: 26, gridY: 19, role: 'boundary' },
      ],
      content: '',
      style: {},
      state: 'idle',
      interactions: { draggable: false, clickable: true },
    };

    const occupied = getOccupiedPixelKeys([createSingleMagnet('block', 0, 19)]);
    expect(magnetHasPlacementConflict(magnet, occupied)).toBe(true);

    const candidates = buildMagnetPlacementCandidates(magnet, occupied, { maxCandidates: 6 });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].anchors[0].gridY).toBe(18);
    expect(candidates[0].footprintKeys).not.toContain('0,19');
  });

  it('avoids overlapping rectangle candidates and occupied pixels', () => {
    const magnet: Magnet = {
      id: 'rect',
      type: 'custom',
      name: 'Rect',
      anchorType: 'rectangular',
      anchors: [
        { id: 'top-left', gridX: 0, gridY: 0, role: 'anchor' },
        { id: 'top-right', gridX: 1, gridY: 0, role: 'boundary' },
        { id: 'bottom-left', gridX: 0, gridY: 1, role: 'boundary' },
        { id: 'bottom-right', gridX: 1, gridY: 1, role: 'boundary' },
      ],
      content: '',
      style: {},
      state: 'idle',
      interactions: { draggable: false, clickable: true },
    };

    const occupied = new Set<string>(['0,0', '1,0', '0,1', '1,1']);
    const candidates = buildMagnetPlacementCandidates(magnet, occupied, { maxCandidates: 6 });

    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const key of candidate.footprintKeys) {
        expect(occupied.has(key)).toBe(false);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('finds the first free placement candidate (row-major)', () => {
    const magnet = createSingleMagnet('single', 5, 5);
    const occupied = new Set<string>(['0,0', '1,0', '2,0']);
    const candidate = findFirstMagnetPlacementCandidate(magnet, occupied);
    expect(candidate?.anchors[0].gridX).toBe(3);
    expect(candidate?.anchors[0].gridY).toBe(0);
  });
});
