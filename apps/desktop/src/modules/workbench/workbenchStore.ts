import type {
  WorkbenchCommand,
  WorkbenchContextState,
  WorkbenchSelectionScope,
  WorkbenchSelectionState,
  WorkbenchStateSnapshot,
  WorkbenchSurfaceBounds,
  WorkbenchSurfaceLayoutPatch,
  WorkbenchSurfaceSpec,
  WorkbenchTimeRange,
  WorkbenchTimelineState,
} from '../../contracts/workbench';

export type WorkbenchStoreListener = (snapshot: WorkbenchStateSnapshot) => void;

export interface CreateWorkbenchStateOptions {
  context?: Partial<WorkbenchContextState>;
  surfaces?: WorkbenchSurfaceSpec[];
  timeline?: Partial<WorkbenchTimelineState>;
  selection?: Partial<WorkbenchSelectionState>;
  updatedAtMs?: number;
}

export interface CreateWorkbenchStoreOptions {
  initialState?: WorkbenchStateSnapshot;
  now?: () => number;
}

export interface WorkbenchStore {
  getSnapshot(): WorkbenchStateSnapshot;
  subscribe(listener: WorkbenchStoreListener): () => void;
  dispatch(command: WorkbenchCommand): void;
  reset(): void;
}

const EMPTY_SELECTION: WorkbenchSelectionState = {
  scope: 'none',
  ids: [],
  primaryId: null,
};

const DEFAULT_TIMELINE: WorkbenchTimelineState = {
  playheadMs: 0,
  clipRange: null,
  loopRange: null,
  isScrubbing: false,
  snapMs: null,
};

function positiveNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function normalizedOrder(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function normalizeTimeRange(range: WorkbenchTimeRange | null): WorkbenchTimeRange | null {
  if (!range) return null;
  const start = positiveNumber(range.startMs) ?? 0;
  const end = positiveNumber(range.endMs) ?? start;
  return {
    startMs: Math.min(start, end),
    endMs: Math.max(start, end),
  };
}

function cloneBounds(bounds: WorkbenchSurfaceBounds | null | undefined): WorkbenchSurfaceBounds | null | undefined {
  if (bounds === null) return null;
  if (!bounds) return undefined;
  return {
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: positiveNumber(bounds.width) ?? 0,
    height: positiveNumber(bounds.height) ?? 0,
  };
}

export function cloneSurface(surface: WorkbenchSurfaceSpec): WorkbenchSurfaceSpec {
  return {
    ...surface,
    order: normalizedOrder(surface.order),
    width: positiveNumber(surface.width),
    height: positiveNumber(surface.height),
    minWidth: positiveNumber(surface.minWidth),
    minHeight: positiveNumber(surface.minHeight),
    maxWidth: positiveNumber(surface.maxWidth),
    maxHeight: positiveNumber(surface.maxHeight),
    floatingBounds: cloneBounds(surface.floatingBounds),
  };
}

function cloneSurfaces(
  surfaces: Record<string, WorkbenchSurfaceSpec>
): Record<string, WorkbenchSurfaceSpec> {
  const next: Record<string, WorkbenchSurfaceSpec> = {};
  for (const [id, surface] of Object.entries(surfaces)) {
    next[id] = cloneSurface(surface);
  }
  return next;
}

export function cloneWorkbenchState(state: WorkbenchStateSnapshot): WorkbenchStateSnapshot {
  return {
    version: 1,
    revision: state.revision,
    mode: state.mode,
    context: { ...state.context },
    timeline: {
      playheadMs: positiveNumber(state.timeline.playheadMs) ?? 0,
      clipRange: normalizeTimeRange(state.timeline.clipRange),
      loopRange: normalizeTimeRange(state.timeline.loopRange),
      isScrubbing: state.timeline.isScrubbing,
      snapMs: state.timeline.snapMs === null ? null : positiveNumber(state.timeline.snapMs) ?? null,
    },
    selection: {
      scope: state.selection.scope,
      ids: [...state.selection.ids],
      primaryId: state.selection.primaryId,
    },
    surfaces: cloneSurfaces(state.surfaces),
    focusedSurfaceId: state.focusedSurfaceId,
    updatedAtMs: positiveNumber(state.updatedAtMs) ?? 0,
  };
}

export function createWorkbenchState(options: CreateWorkbenchStateOptions = {}): WorkbenchStateSnapshot {
  const surfaces: Record<string, WorkbenchSurfaceSpec> = {};
  for (const surface of options.surfaces ?? []) {
    surfaces[surface.id] = cloneSurface(surface);
  }

  return {
    version: 1,
    revision: 0,
    mode: 'compose',
    context: {
      domain: options.context?.domain ?? 'custom',
      projectId: options.context?.projectId ?? null,
      sceneId: options.context?.sceneId ?? null,
    },
    timeline: {
      playheadMs: positiveNumber(options.timeline?.playheadMs) ?? DEFAULT_TIMELINE.playheadMs,
      clipRange: normalizeTimeRange(options.timeline?.clipRange ?? DEFAULT_TIMELINE.clipRange),
      loopRange: normalizeTimeRange(options.timeline?.loopRange ?? DEFAULT_TIMELINE.loopRange),
      isScrubbing: options.timeline?.isScrubbing ?? DEFAULT_TIMELINE.isScrubbing,
      snapMs: options.timeline?.snapMs === undefined ? DEFAULT_TIMELINE.snapMs : positiveNumber(options.timeline.snapMs) ?? null,
    },
    selection: normalizeSelection(
      options.selection?.scope ?? EMPTY_SELECTION.scope,
      options.selection?.ids ?? EMPTY_SELECTION.ids,
      options.selection?.primaryId ?? EMPTY_SELECTION.primaryId
    ),
    surfaces,
    focusedSurfaceId: null,
    updatedAtMs: options.updatedAtMs ?? 0,
  };
}

export function normalizeSelection(
  scope: WorkbenchSelectionScope,
  ids: string[],
  primaryId?: string | null
): WorkbenchSelectionState {
  if (scope === 'none') return { ...EMPTY_SELECTION };

  const normalizedIds = Array.from(
    new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  );
  if (normalizedIds.length === 0) return { ...EMPTY_SELECTION };

  const normalizedPrimary = primaryId && normalizedIds.includes(primaryId) ? primaryId : normalizedIds[0];
  return {
    scope,
    ids: normalizedIds,
    primaryId: normalizedPrimary,
  };
}

function updateSurfaceLayout(
  surface: WorkbenchSurfaceSpec,
  patch: WorkbenchSurfaceLayoutPatch
): WorkbenchSurfaceSpec {
  return {
    ...surface,
    region: patch.region ?? surface.region,
    order: patch.order === undefined ? surface.order : normalizedOrder(patch.order),
    width: patch.width === undefined ? surface.width : positiveNumber(patch.width),
    height: patch.height === undefined ? surface.height : positiveNumber(patch.height),
    floatingBounds:
      patch.floatingBounds === undefined ? cloneBounds(surface.floatingBounds) : cloneBounds(patch.floatingBounds),
  };
}

function reduceWorkbenchState(
  state: WorkbenchStateSnapshot,
  command: WorkbenchCommand,
  initialState: WorkbenchStateSnapshot
): WorkbenchStateSnapshot {
  switch (command.type) {
    case 'context.set':
      return {
        ...state,
        context: {
          ...state.context,
          ...command.context,
        },
      };
    case 'mode.set':
      return {
        ...state,
        mode: command.mode,
      };
    case 'timeline.playhead.set':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          playheadMs: positiveNumber(command.playheadMs) ?? 0,
          isScrubbing: command.isScrubbing ?? state.timeline.isScrubbing,
        },
      };
    case 'timeline.clip.set':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          clipRange: normalizeTimeRange(command.range),
        },
      };
    case 'timeline.loop.set':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          loopRange: normalizeTimeRange(command.range),
        },
      };
    case 'selection.set':
      return {
        ...state,
        selection: normalizeSelection(command.scope, command.ids, command.primaryId),
      };
    case 'selection.clear':
      return {
        ...state,
        selection: { ...EMPTY_SELECTION },
      };
    case 'surface.upsert':
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [command.surface.id]: cloneSurface(command.surface),
        },
      };
    case 'surface.remove': {
      if (!state.surfaces[command.surfaceId]) return state;
      const nextSurfaces = { ...state.surfaces };
      delete nextSurfaces[command.surfaceId];
      return {
        ...state,
        surfaces: nextSurfaces,
        focusedSurfaceId: state.focusedSurfaceId === command.surfaceId ? null : state.focusedSurfaceId,
      };
    }
    case 'surface.visibility.set': {
      const surface = state.surfaces[command.surfaceId];
      if (!surface) return state;
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [command.surfaceId]: {
            ...surface,
            visible: command.visible,
          },
        },
      };
    }
    case 'surface.toggle': {
      const surface = state.surfaces[command.surfaceId];
      if (!surface) return state;
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [command.surfaceId]: {
            ...surface,
            visible: !surface.visible,
          },
        },
      };
    }
    case 'surface.layout.update': {
      const surface = state.surfaces[command.surfaceId];
      if (!surface) return state;
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [command.surfaceId]: updateSurfaceLayout(surface, command.patch),
        },
      };
    }
    case 'surface.focus':
      return {
        ...state,
        focusedSurfaceId:
          command.surfaceId && state.surfaces[command.surfaceId] ? command.surfaceId : null,
      };
    case 'layout.reset':
      return {
        ...state,
        surfaces: cloneSurfaces(initialState.surfaces),
        focusedSurfaceId: null,
      };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function createWorkbenchStore(options: CreateWorkbenchStoreOptions = {}): WorkbenchStore {
  const now = options.now ?? Date.now;
  const initialState = cloneWorkbenchState(options.initialState ?? createWorkbenchState({ updatedAtMs: now() }));
  let state = cloneWorkbenchState(initialState);
  const listeners = new Set<WorkbenchStoreListener>();

  const publish = () => {
    const snapshot = cloneWorkbenchState(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const commit = (nextState: WorkbenchStateSnapshot) => {
    if (nextState === state) return;
    state = {
      ...cloneWorkbenchState(nextState),
      revision: state.revision + 1,
      updatedAtMs: now(),
    };
    publish();
  };

  return {
    getSnapshot: () => cloneWorkbenchState(state),
    subscribe: (listener: WorkbenchStoreListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (command: WorkbenchCommand) => {
      commit(reduceWorkbenchState(state, command, initialState));
    },
    reset: () => {
      commit(initialState);
    },
  };
}
