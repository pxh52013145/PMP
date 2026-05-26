import { describe, expect, it } from 'vitest';
import { AUDIO_VISUALIZER_SCENE_ID } from '../scenes';
import {
  createDefaultVisualizerWorkbenchStore,
  DEFAULT_VISUALIZER_WORKBENCH_SURFACES,
  VISUALIZER_WORKBENCH_SURFACE_IDS,
} from './defaultVisualizerWorkbench';

describe('defaultVisualizerWorkbench', () => {
  it('seeds the main visualizer workbench context and native dock surfaces', () => {
    const store = createDefaultVisualizerWorkbenchStore({ now: () => 42 });
    const snapshot = store.getSnapshot();

    expect(snapshot.context).toEqual({
      domain: 'visualizer',
      projectId: null,
      sceneId: AUDIO_VISUALIZER_SCENE_ID,
    });
    expect(snapshot.timeline.snapMs).toBeCloseTo(1_000 / 24, 5);
    expect(Object.keys(snapshot.surfaces)).toHaveLength(DEFAULT_VISUALIZER_WORKBENCH_SURFACES.length);
    expect(snapshot.surfaces[VISUALIZER_WORKBENCH_SURFACE_IDS.timeline]).toMatchObject({
      kind: 'timeline',
      region: 'bottom',
      visible: true,
      carrierHint: 'native',
    });
    expect(snapshot.surfaces[VISUALIZER_WORKBENCH_SURFACE_IDS.outliner]).toMatchObject({
      kind: 'outliner',
      region: 'right',
      visible: true,
      carrierHint: 'native',
    });
    expect(snapshot.surfaces[VISUALIZER_WORKBENCH_SURFACE_IDS.assets].visible).toBe(false);
  });
});

