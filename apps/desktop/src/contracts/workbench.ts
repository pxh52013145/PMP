export type WorkbenchDomain = 'visualizer' | 'editor' | 'custom';

export type WorkbenchMode = 'compose' | 'preview' | 'inspect';

export type WorkbenchSurfaceRegion = 'left' | 'right' | 'top' | 'bottom' | 'floating';

export type WorkbenchSurfaceKind =
  | 'timeline'
  | 'outliner'
  | 'properties'
  | 'assets'
  | 'clip-inspector'
  | 'analysis-inspector'
  | 'toolbar'
  | 'transport'
  | 'custom';

export type WorkbenchSurfaceCarrierHint = 'native' | 'webview' | 'hybrid';

export type WorkbenchSurfacePointerPolicy = 'capture-input' | 'passthrough' | 'hybrid';

export type WorkbenchSelectionScope =
  | 'none'
  | 'scene'
  | 'component'
  | 'resource'
  | 'clip'
  | 'track'
  | 'custom';

export interface WorkbenchTimeRange {
  startMs: number;
  endMs: number;
}

export interface WorkbenchSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkbenchSurfaceSpec {
  id: string;
  kind: WorkbenchSurfaceKind;
  region: WorkbenchSurfaceRegion;
  visible: boolean;
  order: number;
  pinned: boolean;
  focusable: boolean;
  transparent: boolean;
  pointerPolicy: WorkbenchSurfacePointerPolicy;
  carrierHint: WorkbenchSurfaceCarrierHint;
  title?: string;
  titleKey?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  floatingBounds?: WorkbenchSurfaceBounds | null;
}

export interface WorkbenchContextState {
  domain: WorkbenchDomain;
  projectId: string | null;
  sceneId: string | null;
}

export interface WorkbenchTimelineState {
  playheadMs: number;
  clipRange: WorkbenchTimeRange | null;
  loopRange: WorkbenchTimeRange | null;
  isScrubbing: boolean;
  snapMs: number | null;
}

export interface WorkbenchNativeTimelineMarker {
  id: string;
  label: string;
  timeMs: number;
  color?: string | null;
}

export interface WorkbenchNativeTimelineSurfaceContent {
  kind: 'timeline';
  protocolVersion: 1;
  title: string;
  trackLabel?: string | null;
  durationMs: number;
  playheadMs: number;
  clipRange: WorkbenchTimeRange | null;
  loopRange: WorkbenchTimeRange | null;
  markers: WorkbenchNativeTimelineMarker[];
}

export type WorkbenchNativeOutlinerItemKind =
  | 'scene'
  | 'component'
  | 'resource'
  | 'clip'
  | 'track'
  | 'group'
  | 'custom';

export interface WorkbenchNativeOutlinerItem {
  id: string;
  label: string;
  kind: WorkbenchNativeOutlinerItemKind;
  depth: number;
  visible: boolean;
  selected: boolean;
}

export interface WorkbenchNativeOutlinerSurfaceContent {
  kind: 'outliner';
  protocolVersion: 1;
  title: string;
  items: WorkbenchNativeOutlinerItem[];
  selectedIds: string[];
}

export type WorkbenchNativeSurfaceContent =
  | WorkbenchNativeTimelineSurfaceContent
  | WorkbenchNativeOutlinerSurfaceContent;

export const WORKBENCH_NATIVE_SURFACE_EVENT = 'workbench-native-surface-event';

export type WorkbenchNativeSurfaceEvent =
  | {
      kind: 'timeline.seek';
      surfaceId: string;
      playheadMs: number;
    }
  | {
      kind: 'timeline.clip.set';
      surfaceId: string;
      range: WorkbenchTimeRange;
      isFinal: boolean;
    }
  | {
      kind: 'timeline.loop.set';
      surfaceId: string;
      range: WorkbenchTimeRange;
      isFinal: boolean;
    }
  | {
      kind: 'outliner.select';
      surfaceId: string;
      itemId: string;
    }
  | {
      kind: 'outliner.visibility.toggle';
      surfaceId: string;
      itemId: string;
    };

export interface WorkbenchSelectionState {
  scope: WorkbenchSelectionScope;
  ids: string[];
  primaryId: string | null;
}

export interface WorkbenchStateSnapshot {
  version: 1;
  revision: number;
  mode: WorkbenchMode;
  context: WorkbenchContextState;
  timeline: WorkbenchTimelineState;
  selection: WorkbenchSelectionState;
  surfaces: Record<string, WorkbenchSurfaceSpec>;
  focusedSurfaceId: string | null;
  updatedAtMs: number;
}

export interface WorkbenchSurfaceLayoutPatch {
  region?: WorkbenchSurfaceRegion;
  order?: number;
  width?: number;
  height?: number;
  floatingBounds?: WorkbenchSurfaceBounds | null;
}

export type WorkbenchCommand =
  | {
      type: 'context.set';
      context: Partial<WorkbenchContextState>;
    }
  | {
      type: 'mode.set';
      mode: WorkbenchMode;
    }
  | {
      type: 'timeline.playhead.set';
      playheadMs: number;
      isScrubbing?: boolean;
    }
  | {
      type: 'timeline.clip.set';
      range: WorkbenchTimeRange | null;
    }
  | {
      type: 'timeline.loop.set';
      range: WorkbenchTimeRange | null;
    }
  | {
      type: 'selection.set';
      scope: WorkbenchSelectionScope;
      ids: string[];
      primaryId?: string | null;
    }
  | {
      type: 'selection.clear';
    }
  | {
      type: 'surface.upsert';
      surface: WorkbenchSurfaceSpec;
    }
  | {
      type: 'surface.remove';
      surfaceId: string;
    }
  | {
      type: 'surface.visibility.set';
      surfaceId: string;
      visible: boolean;
    }
  | {
      type: 'surface.toggle';
      surfaceId: string;
    }
  | {
      type: 'surface.layout.update';
      surfaceId: string;
      patch: WorkbenchSurfaceLayoutPatch;
    }
  | {
      type: 'surface.focus';
      surfaceId: string | null;
    }
  | {
      type: 'layout.reset';
    };
