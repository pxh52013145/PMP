import { describe, expect, it } from 'vitest';
import type { WorkbenchSurfaceSpec } from '../../contracts/workbench';
import { createWorkbenchState, createWorkbenchStore } from './workbenchStore';

const timelineSurface: WorkbenchSurfaceSpec = {
  id: 'timeline',
  kind: 'timeline',
  region: 'bottom',
  visible: true,
  order: 0,
  pinned: true,
  focusable: true,
  transparent: false,
  pointerPolicy: 'capture-input',
  carrierHint: 'native',
  height: 200,
};

const outlinerSurface: WorkbenchSurfaceSpec = {
  id: 'outliner',
  kind: 'outliner',
  region: 'right',
  visible: true,
  order: 1,
  pinned: true,
  focusable: true,
  transparent: false,
  pointerPolicy: 'capture-input',
  carrierHint: 'native',
  width: 300,
};

describe('workbenchStore', () => {
  it('updates dock surface visibility and publishes snapshots', () => {
    let now = 100;
    const store = createWorkbenchStore({
      initialState: createWorkbenchState({
        surfaces: [timelineSurface, outlinerSurface],
        updatedAtMs: now,
      }),
      now: () => {
        now += 1;
        return now;
      },
    });
    const revisions: number[] = [];
    const unsubscribe = store.subscribe((snapshot) => {
      revisions.push(snapshot.revision);
    });

    store.dispatch({
      type: 'surface.visibility.set',
      surfaceId: 'timeline',
      visible: false,
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.surfaces.timeline.visible).toBe(false);
    expect(snapshot.surfaces.outliner.visible).toBe(true);
    expect(snapshot.updatedAtMs).toBe(101);
    expect(revisions).toEqual([1]);

    unsubscribe();
    store.dispatch({ type: 'surface.toggle', surfaceId: 'timeline' });
    expect(revisions).toEqual([1]);
  });

  it('normalizes clip ranges and playhead commands', () => {
    const store = createWorkbenchStore({
      initialState: createWorkbenchState({ surfaces: [timelineSurface] }),
      now: () => 1,
    });

    store.dispatch({
      type: 'timeline.clip.set',
      range: { startMs: 5_000, endMs: 1_000 },
    });
    store.dispatch({
      type: 'timeline.playhead.set',
      playheadMs: -10,
      isScrubbing: true,
    });

    expect(store.getSnapshot().timeline).toMatchObject({
      playheadMs: 0,
      clipRange: { startMs: 1_000, endMs: 5_000 },
      isScrubbing: true,
    });
  });

  it('deduplicates selection ids and tracks a primary id', () => {
    const store = createWorkbenchStore({
      initialState: createWorkbenchState(),
      now: () => 1,
    });

    store.dispatch({
      type: 'selection.set',
      scope: 'component',
      ids: ['ring', 'ring', 'particles'],
      primaryId: 'particles',
    });

    expect(store.getSnapshot().selection).toEqual({
      scope: 'component',
      ids: ['ring', 'particles'],
      primaryId: 'particles',
    });

    store.dispatch({
      type: 'selection.set',
      scope: 'component',
      ids: [],
    });

    expect(store.getSnapshot().selection).toEqual({
      scope: 'none',
      ids: [],
      primaryId: null,
    });
  });

  it('resets dock layout without dropping timeline and selection state', () => {
    const store = createWorkbenchStore({
      initialState: createWorkbenchState({
        surfaces: [timelineSurface],
      }),
      now: () => 1,
    });

    store.dispatch({
      type: 'surface.layout.update',
      surfaceId: 'timeline',
      patch: { height: 320, region: 'floating' },
    });
    store.dispatch({
      type: 'timeline.clip.set',
      range: { startMs: 10, endMs: 20 },
    });
    store.dispatch({ type: 'layout.reset' });

    const snapshot = store.getSnapshot();
    expect(snapshot.surfaces.timeline).toMatchObject({
      region: 'bottom',
      height: 200,
    });
    expect(snapshot.timeline.clipRange).toEqual({ startMs: 10, endMs: 20 });
  });
});

