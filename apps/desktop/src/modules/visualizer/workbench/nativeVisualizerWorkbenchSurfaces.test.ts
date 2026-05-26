import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerWorkbenchState } from './defaultVisualizerWorkbench';
import {
  resolveDefaultVisualizerNativeDockSurfaceContents,
  resolveDefaultVisualizerNativeDockSurfaceConfigs,
} from './nativeVisualizerWorkbenchSurfaces';
import { VISUALIZER_WORKBENCH_SURFACE_IDS } from './defaultVisualizerWorkbench';

describe('nativeVisualizerWorkbenchSurfaces', () => {
  it('builds timeline and outliner content for the default native docks', () => {
    const snapshot = createDefaultVisualizerWorkbenchState({
      sceneId: 'audio-visualizer',
    });
    const updates = resolveDefaultVisualizerNativeDockSurfaceContents(snapshot, {
      titleForKey: (key) => `i18n:${key}`,
      durationMs: 240_000,
      playheadMs: 42_000,
      trackLabel: 'Current Track',
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      surfaceId: VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
      content: {
        kind: 'timeline',
        protocolVersion: 1,
        title: 'i18n:visualizer.workbench.surface.timeline',
        trackLabel: 'Current Track',
        durationMs: 240_000,
        playheadMs: 42_000,
      },
    });
    expect(updates[1]?.content).toMatchObject({
      kind: 'outliner',
      protocolVersion: 1,
      title: 'i18n:visualizer.workbench.surface.outliner',
    });
    if (updates[1]?.content.kind !== 'outliner') {
      throw new Error('expected outliner content');
    }
    expect(updates[1].content.items.map((item) => item.id)).toContain('audio-visualizer');
    expect(updates[1].content.items.map((item) => item.label)).toContain('Phase');
  });

  it('keeps the config resolver focused on bottom timeline and right outliner docks', () => {
    const configs = resolveDefaultVisualizerNativeDockSurfaceConfigs();

    expect(configs.map((config) => config.surfaceId)).toEqual([
      VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
      VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
    ]);
  });
});
