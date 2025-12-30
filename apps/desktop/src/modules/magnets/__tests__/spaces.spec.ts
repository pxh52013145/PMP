import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultMagnetSpacesState,
  createNextSpaceId,
  getNextSpaceId,
  sanitizeMagnetSpacesState,
  type MagnetSpacesState,
} from '../spaces';

beforeEach(() => {
  localStorage.clear();
});

describe('magnet spaces', () => {
  it('creates a default state with space1/space2', () => {
    const state = createDefaultMagnetSpacesState(123);
    expect(state.version).toBe(1);
    expect(state.activeSpaceId).toBe('space1');
    expect(state.spaces.map((s) => s.id)).toEqual(['space1', 'space2']);
  });

  it('sanitizes invalid input to default', () => {
    const state = sanitizeMagnetSpacesState(null, 456);
    expect(state.activeSpaceId).toBe('space1');
    expect(state.spaces.map((s) => s.id)).toEqual(['space1', 'space2']);
  });

  it('ensures space1 and space2 exist', () => {
    const raw: MagnetSpacesState = {
      version: 1,
      activeSpaceId: 'custom',
      spaces: [{ id: 'custom', name: 'Custom', order: 3, createdAt: 1 }],
    };
    const state = sanitizeMagnetSpacesState(raw, 999);
    expect(state.spaces.map((s) => s.id)).toEqual(['space1', 'space2', 'custom']);
    expect(state.activeSpaceId).toBe('custom');
  });

  it('drops duplicate spaces and normalizes active space', () => {
    const raw = {
      version: 1,
      activeSpaceId: 'missing',
      spaces: [
        { id: 'space1', name: 'A', order: 1, createdAt: 1 },
        { id: 'space1', name: 'B', order: 2, createdAt: 2 },
        { id: ' space2 ', name: ' ', order: 0, createdAt: 0 },
      ],
    };
    const state = sanitizeMagnetSpacesState(raw, 1000);
    expect(state.spaces.map((s) => s.id)).toEqual(['space1', 'space2']);
    expect(state.activeSpaceId).toBe('space1');
  });

  it('creates next space id based on existing ids', () => {
    const base = createDefaultMagnetSpacesState(1);
    expect(createNextSpaceId(base)).toBe('space3');

    const withHole: MagnetSpacesState = {
      ...base,
      spaces: [{ id: 'space1', name: '空间1', order: 1, createdAt: 1 }],
    };
    expect(createNextSpaceId(withHole)).toBe('space2');
  });

  it('gets next space id in a stable cycle', () => {
    const base = createDefaultMagnetSpacesState(1);
    expect(getNextSpaceId(base, 'space1')).toBe('space2');
    expect(getNextSpaceId(base, 'space2')).toBe('space1');
    expect(getNextSpaceId(base, 'missing')).toBe('space1');
  });
});

