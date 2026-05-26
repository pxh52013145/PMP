import { describe, expect, it } from 'vitest';
import { createWorkbenchState } from './workbenchStore';
import { resolveWorkbenchNativeSurfaceOpenConfigs } from './nativeSurfaceManager';

describe('nativeSurfaceManager', () => {
  it('resolves only supported visualizer dock surfaces', () => {
    const snapshot = createWorkbenchState({
      surfaces: [
        {
          id: 'visualizer-timeline',
          kind: 'timeline',
          region: 'bottom',
          visible: true,
          order: 1,
          pinned: true,
          focusable: true,
          transparent: false,
          pointerPolicy: 'capture-input',
          carrierHint: 'native',
          width: 320,
          height: 210,
        },
        {
          id: 'visualizer-outliner',
          kind: 'outliner',
          region: 'right',
          visible: true,
          order: 0,
          pinned: true,
          focusable: true,
          transparent: false,
          pointerPolicy: 'capture-input',
          carrierHint: 'native',
          width: 300,
        },
        {
          id: 'visualizer-assets',
          kind: 'assets',
          region: 'right',
          visible: true,
          order: 2,
          pinned: false,
          focusable: true,
          transparent: false,
          pointerPolicy: 'capture-input',
          carrierHint: 'native',
          width: 280,
        },
        {
          id: 'visualizer-web',
          kind: 'timeline',
          region: 'bottom',
          visible: true,
          order: 3,
          pinned: true,
          focusable: true,
          transparent: false,
          pointerPolicy: 'capture-input',
          carrierHint: 'webview',
          width: 200,
        },
      ],
    });

    expect(resolveWorkbenchNativeSurfaceOpenConfigs(snapshot)).toEqual([
      {
        surfaceId: 'visualizer-outliner',
        region: 'right',
        width: 300,
        height: 1,
        title: null,
      },
      {
        surfaceId: 'visualizer-timeline',
        region: 'bottom',
        width: 320,
        height: 210,
        title: null,
      },
    ]);
  });
});

