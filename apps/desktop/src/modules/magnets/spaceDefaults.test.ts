import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultMagnetSpaceLayout,
  createInitialMagnetSpaceLayout,
  ensureMagnetSpaceLayout,
} from './layoutStorage';
import { resolveMagnetLayoutStorageKey } from './layout';
import { createDefaultMagnetSpacesState, sanitizeMagnetSpacesState } from './spaces';
import {
  getSystemAnchorsByMagnetId,
  MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS,
  PLUGIN_DEVELOPMENT_WORKSPACE_DEFAULT_ANCHORS,
} from './systemLayouts';

describe('magnet space defaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates three initial space instances with seed templates', () => {
    const spaces = createDefaultMagnetSpacesState(1_710_000_000_000);

    expect(spaces.spaces.map((space) => space.id)).toEqual(['space1', 'space2', 'space3']);
    expect(spaces.spaces.map((space) => space.seedTemplateId)).toEqual([
      'main',
      'music-tag-workbench',
      'plugin-development-workspace',
    ]);
  });

  it('does not treat arbitrary non-space1 layouts as initial templates', () => {
    const layout = createDefaultMagnetSpaceLayout('space2');
    const systemAnchors = getSystemAnchorsByMagnetId('space2');

    expect(layout.activeMagnetIds).toEqual(
      expect.arrayContaining([
        'drag-handle',
        'btn-minimize',
        'btn-maximize',
        'btn-close',
        'btn-window-pin',
        'btn-matrix-change',
        'btn-editor',
      ])
    );
    expect(layout.activeMagnetIds).not.toContain('music-tag-workbench');
    expect(layout.activeMagnetIds).not.toContain('plugin-development-workspace');
    expect(systemAnchors['music-tag-workbench']).toBeUndefined();
    expect(systemAnchors['plugin-development-workspace']).toBeUndefined();
  });

  it('uses the initial music workbench template only through initial-space seeding', () => {
    const layout = createInitialMagnetSpaceLayout('space2');

    expect(layout.activeMagnetIds).toEqual(expect.arrayContaining(['music-tag-workbench']));
    expect(layout.activeMagnetIds).not.toContain('navigation-page');
    expect(layout.anchorsByMagnetId['music-tag-workbench']).toEqual(
      MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS
    );
  });

  it('uses the initial plugin workspace template only through initial-space seeding', () => {
    const layout = createInitialMagnetSpaceLayout('space3');

    expect(layout.activeMagnetIds).toEqual(
      expect.arrayContaining(['plugin-development-workspace'])
    );
    expect(layout.anchorsByMagnetId['plugin-development-workspace']).toEqual(
      PLUGIN_DEVELOPMENT_WORKSPACE_DEFAULT_ANCHORS
    );
  });

  it('does not re-add removed non-main spaces during sanitize', () => {
    const spaces = createDefaultMagnetSpacesState(1_710_000_000_000);
    const sanitized = sanitizeMagnetSpacesState({
      ...spaces,
      spaces: spaces.spaces.filter((space) => space.id !== 'space3'),
    });

    expect(sanitized.spaces.map((space) => space.id)).toEqual(['space1', 'space2']);
  });

  it('repairs legacy MusicTag layouts by shape instead of space id', () => {
    const storageKey = resolveMagnetLayoutStorageKey('workbench-space');
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        activeMagnetIds: ['btn-back', 'navigation-page', 'music-tag-workbench'],
        anchorsByMagnetId: {
          'music-tag-workbench': [
            { id: 'top-left', gridX: 0, gridY: 1, role: 'anchor' },
            { id: 'top-right', gridX: 5, gridY: 1, role: 'boundary' },
            { id: 'bottom-left', gridX: 0, gridY: 7, role: 'boundary' },
            { id: 'bottom-right', gridX: 5, gridY: 7, role: 'boundary' },
          ],
          'navigation-page': [
            { id: 'top-left', gridX: 6, gridY: 1, role: 'anchor' },
            { id: 'top-right', gridX: 26, gridY: 1, role: 'boundary' },
            { id: 'bottom-left', gridX: 6, gridY: 17, role: 'boundary' },
            { id: 'bottom-right', gridX: 26, gridY: 17, role: 'boundary' },
          ],
          'btn-back': [{ id: 'anchor', gridX: 6, gridY: 0, role: 'anchor' }],
        },
      })
    );

    const { layout, didCreate } = ensureMagnetSpaceLayout('workbench-space');

    expect(didCreate).toBe(false);
    expect(layout.activeMagnetIds).toEqual(expect.arrayContaining(['music-tag-workbench']));
    expect(layout.activeMagnetIds).not.toContain('btn-back');
    expect(layout.activeMagnetIds).not.toContain('navigation-page');
    expect(layout.anchorsByMagnetId['music-tag-workbench']).toEqual(
      MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS
    );
    expect(layout.anchorsByMagnetId['navigation-page']).toBeUndefined();
    expect(layout.anchorsByMagnetId['btn-back']).toBeUndefined();
  });
});
