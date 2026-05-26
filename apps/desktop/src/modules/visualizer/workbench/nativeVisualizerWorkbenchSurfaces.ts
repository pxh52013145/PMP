import {
  createWorkbenchNativeSurfaceManager,
  resolveWorkbenchNativeSurfaceOpenConfigs,
  type WorkbenchNativeSurfaceContent,
  type WorkbenchNativeSurfaceManager,
  type WorkbenchNativeSurfaceOpenConfig,
} from '../../workbench';
import type { WorkbenchStateSnapshot } from '../../workbench';
import { resolveVisualizerScene } from '../scenes';
import { createDefaultVisualizerWorkbenchState } from './defaultVisualizerWorkbench';
import { VISUALIZER_WORKBENCH_SURFACE_IDS } from './defaultVisualizerWorkbench';

export const DEFAULT_VISUALIZER_NATIVE_DOCK_SURFACE_IDS = [
  VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
  VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
] as const;

const DEFAULT_VISUALIZER_TIMELINE_DURATION_MS = 180_000;

const VISUALIZER_COMPONENT_LABELS: Record<string, string> = {
  phase: 'Phase',
  freq: 'Freq',
  chords: 'Chords',
  progress: 'Progress',
  particles: 'Particles',
  morse: 'Morse',
  center: 'Center',
  hud: 'Hud',
  'orbital-phase-scope': 'Phase Scope',
  'orbital-frequency-ring': 'Frequency Ring',
  'orbital-chord-wheel': 'Chord Wheel',
  'orbital-progress-orbit': 'Progress Orbit',
  'orbital-particle-flow': 'Particle Flow',
  'orbital-morse-telemetry': 'Morse Telemetry',
  'orbital-center-console': 'Center Console',
  'orbital-track-header': 'Track Header',
};

export interface ResolveDefaultVisualizerNativeDockSurfaceContentOptions {
  titleForKey?: (key: string) => string;
  durationMs?: number | null;
  playheadMs?: number | null;
  trackLabel?: string | null;
}

export interface WorkbenchNativeSurfaceContentUpdate {
  surfaceId: string;
  content: WorkbenchNativeSurfaceContent;
}

function positiveFiniteNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function resolveSurfaceTitle(
  snapshot: WorkbenchStateSnapshot,
  surfaceId: string,
  fallback: string,
  titleForKey?: (key: string) => string
): string {
  const surface = snapshot.surfaces[surfaceId];
  if (surface?.titleKey && titleForKey) {
    const title = titleForKey(surface.titleKey).trim();
    if (title) return title;
  }
  if (surface?.title?.trim()) return surface.title.trim();
  return fallback;
}

function resolveTimelineDurationMs(
  snapshot: WorkbenchStateSnapshot,
  explicitDurationMs: number | null | undefined,
  explicitPlayheadMs: number | null | undefined
): number {
  const playheadMs = positiveFiniteNumber(explicitPlayheadMs) ?? snapshot.timeline.playheadMs;
  const candidates = [
    positiveFiniteNumber(explicitDurationMs),
    positiveFiniteNumber(snapshot.timeline.clipRange?.endMs),
    positiveFiniteNumber(snapshot.timeline.loopRange?.endMs),
    positiveFiniteNumber(playheadMs),
    DEFAULT_VISUALIZER_TIMELINE_DURATION_MS,
  ];
  return Math.max(...candidates.filter((value): value is number => value !== null), 1);
}

function resolveComponentLabel(componentId: string): string {
  const mapped = VISUALIZER_COMPONENT_LABELS[componentId];
  if (mapped) return mapped;
  return componentId
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function resolveDefaultVisualizerNativeDockSurfaceContents(
  snapshot: WorkbenchStateSnapshot = createDefaultVisualizerWorkbenchState(),
  options: ResolveDefaultVisualizerNativeDockSurfaceContentOptions = {}
): WorkbenchNativeSurfaceContentUpdate[] {
  const selectedIds = new Set(snapshot.selection.ids);
  const scene = resolveVisualizerScene(snapshot.context.sceneId ?? '');
  const playheadMs = positiveFiniteNumber(options.playheadMs) ?? snapshot.timeline.playheadMs;
  const durationMs = resolveTimelineDurationMs(snapshot, options.durationMs, playheadMs);
  const timelineTitle = resolveSurfaceTitle(
    snapshot,
    VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
    'Timeline',
    options.titleForKey
  );
  const outlinerTitle = resolveSurfaceTitle(
    snapshot,
    VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
    'Outliner',
    options.titleForKey
  );

  return [
    {
      surfaceId: VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
      content: {
        kind: 'timeline',
        protocolVersion: 1,
        title: timelineTitle,
        trackLabel: options.trackLabel ?? scene.title ?? scene.id,
        durationMs,
        playheadMs,
        clipRange: snapshot.timeline.clipRange,
        loopRange: snapshot.timeline.loopRange,
        markers: [],
      },
    },
    {
      surfaceId: VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
      content: {
        kind: 'outliner',
        protocolVersion: 1,
        title: outlinerTitle,
        selectedIds: [...snapshot.selection.ids],
        items: [
          {
            id: scene.id,
            label: scene.title ?? scene.id,
            kind: 'scene',
            depth: 0,
            visible: true,
            selected: selectedIds.has(scene.id),
          },
          ...scene.components
            .slice()
            .sort((a, b) => (a.transform?.zIndex ?? 0) - (b.transform?.zIndex ?? 0) || a.id.localeCompare(b.id))
            .map((component) => {
              return {
                id: component.id,
                label: resolveComponentLabel(component.id),
                kind: 'component' as const,
                depth: 1,
                visible: component.transform?.visible ?? true,
                selected: selectedIds.has(component.id),
              };
            }),
        ],
      },
    },
  ];
}

export function resolveDefaultVisualizerNativeDockSurfaceConfigs(
  snapshot: WorkbenchStateSnapshot = createDefaultVisualizerWorkbenchState()
): WorkbenchNativeSurfaceOpenConfig[] {
  return resolveWorkbenchNativeSurfaceOpenConfigs(snapshot, {
    surfaceIds: DEFAULT_VISUALIZER_NATIVE_DOCK_SURFACE_IDS,
  });
}

export async function openDefaultVisualizerNativeDockSurfaces(options: {
  snapshot?: WorkbenchStateSnapshot;
  manager?: WorkbenchNativeSurfaceManager;
} = {}): Promise<WorkbenchNativeSurfaceOpenConfig[]> {
  const snapshot = options.snapshot ?? createDefaultVisualizerWorkbenchState();
  const manager = options.manager ?? createWorkbenchNativeSurfaceManager();
  return manager.openSurfaces(snapshot, {
    surfaceIds: DEFAULT_VISUALIZER_NATIVE_DOCK_SURFACE_IDS,
  });
}
