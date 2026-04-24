import { describe, expect, it } from 'vitest';
import { createDefaultMagnetSpaceLayout } from './layoutStorage';
import { createDefaultMagnetSpacesState } from './spaces';
import { getSystemAnchorsByMagnetId } from './systemLayouts';

describe('magnet space defaults', () => {
  it('includes the plugin development workspace space by default', () => {
    const spaces = createDefaultMagnetSpacesState(1_710_000_000_000);

    expect(spaces.spaces.map((space) => space.id)).toEqual(['space1', 'space2', 'space3']);
    expect(spaces.spaces[2]).toMatchObject({
      id: 'space3',
      order: 3,
    });
  });

  it('activates Plugin Development Workspace in the default space3 layout', () => {
    const layout = createDefaultMagnetSpaceLayout('space3');
    const systemAnchors = getSystemAnchorsByMagnetId('space3');

    expect(layout.activeMagnetIds).toEqual(
      expect.arrayContaining([
        'drag-handle',
        'btn-minimize',
        'btn-maximize',
        'btn-close',
        'btn-window-pin',
        'btn-matrix-change',
        'btn-editor',
        'plugin-development-workspace',
      ])
    );
    expect(layout.anchorsByMagnetId['plugin-development-workspace']).toEqual(
      systemAnchors['plugin-development-workspace']
    );
  });
});
