import type { WorkbenchStateSnapshot, WorkbenchStore, WorkbenchSurfaceSpec } from '../../workbench';
import { createWorkbenchState, createWorkbenchStore } from '../../workbench';
import { AUDIO_VISUALIZER_SCENE_ID } from '../scenes';

export const VISUALIZER_WORKBENCH_SURFACE_IDS = {
  toolbar: 'visualizer-toolbar',
  transport: 'visualizer-transport',
  timeline: 'visualizer-timeline',
  outliner: 'visualizer-outliner',
  properties: 'visualizer-properties',
  assets: 'visualizer-assets',
  clipInspector: 'visualizer-clip-inspector',
  analysisInspector: 'visualizer-analysis-inspector',
} as const;

export type VisualizerWorkbenchSurfaceId =
  (typeof VISUALIZER_WORKBENCH_SURFACE_IDS)[keyof typeof VISUALIZER_WORKBENCH_SURFACE_IDS];

export const DEFAULT_VISUALIZER_WORKBENCH_SURFACES: readonly WorkbenchSurfaceSpec[] = [
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.toolbar,
    kind: 'toolbar',
    region: 'left',
    visible: true,
    order: 0,
    pinned: true,
    focusable: false,
    transparent: true,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.toolbar',
    width: 64,
    minWidth: 48,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.transport,
    kind: 'transport',
    region: 'bottom',
    visible: true,
    order: 0,
    pinned: true,
    focusable: true,
    transparent: true,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.transport',
    height: 56,
    minHeight: 44,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
    kind: 'timeline',
    region: 'bottom',
    visible: true,
    order: 1,
    pinned: true,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.timeline',
    height: 104,
    minHeight: 84,
    maxHeight: 160,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
    kind: 'outliner',
    region: 'right',
    visible: true,
    order: 0,
    pinned: true,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.outliner',
    width: 300,
    minWidth: 240,
    maxWidth: 480,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.properties,
    kind: 'properties',
    region: 'right',
    visible: true,
    order: 1,
    pinned: true,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.properties',
    width: 320,
    minWidth: 260,
    maxWidth: 520,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.assets,
    kind: 'assets',
    region: 'right',
    visible: false,
    order: 2,
    pinned: false,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.assets',
    width: 320,
    minWidth: 260,
    maxWidth: 520,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.clipInspector,
    kind: 'clip-inspector',
    region: 'right',
    visible: false,
    order: 3,
    pinned: false,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.clipInspector',
    width: 320,
    minWidth: 260,
    maxWidth: 520,
  },
  {
    id: VISUALIZER_WORKBENCH_SURFACE_IDS.analysisInspector,
    kind: 'analysis-inspector',
    region: 'right',
    visible: false,
    order: 4,
    pinned: false,
    focusable: true,
    transparent: false,
    pointerPolicy: 'capture-input',
    carrierHint: 'native',
    titleKey: 'visualizer.workbench.surface.analysisInspector',
    width: 340,
    minWidth: 280,
    maxWidth: 560,
  },
];

export interface CreateDefaultVisualizerWorkbenchStateOptions {
  projectId?: string | null;
  sceneId?: string | null;
  updatedAtMs?: number;
}

export function createDefaultVisualizerWorkbenchState(
  options: CreateDefaultVisualizerWorkbenchStateOptions = {}
): WorkbenchStateSnapshot {
  return createWorkbenchState({
    context: {
      domain: 'visualizer',
      projectId: options.projectId ?? null,
      sceneId: options.sceneId ?? AUDIO_VISUALIZER_SCENE_ID,
    },
    timeline: {
      snapMs: 1_000 / 24,
    },
    surfaces: [...DEFAULT_VISUALIZER_WORKBENCH_SURFACES],
    updatedAtMs: options.updatedAtMs ?? 0,
  });
}

export interface CreateDefaultVisualizerWorkbenchStoreOptions
  extends CreateDefaultVisualizerWorkbenchStateOptions {
  now?: () => number;
}

export function createDefaultVisualizerWorkbenchStore(
  options: CreateDefaultVisualizerWorkbenchStoreOptions = {}
): WorkbenchStore {
  const now = options.now ?? Date.now;
  return createWorkbenchStore({
    initialState: createDefaultVisualizerWorkbenchState({
      projectId: options.projectId,
      sceneId: options.sceneId,
      updatedAtMs: options.updatedAtMs ?? now(),
    }),
    now,
  });
}
