import { Magnet, PixelAnchor } from '../../types/pixel';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import {
  applyConfig,
  loadConfig,
  saveConfig,
  mergeMagnetChromeConfig,
  type MagnetConfig,
  type MagnetStateConfig,
} from '../../utils/configManager';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  STANDARD_PANEL_CHROME_INSET,
  createBoundsReference,
  createControlBleedOffsets,
  createControlBleedOutset,
  createFixedAxisBounds,
  createMagnetEdgeReference,
  type HorizontalBarLayoutPresetOptions,
  type MagnetBoundsOffsetConfig,
  type PanelLayoutPresetOptions,
} from './layoutPresets';

export type { MagnetConfig, MagnetStateConfig };

export interface ScheduleSaveMagnetConfigOptions {
  debounceMs?: number;
  afterSave?: () => void | Promise<void>;
  storageKey?: string;
  includeCustomMagnets?: boolean;
}

let scheduledSaveTimeout: number | null = null;
let scheduledSaveArgs:
  | {
      magnetLibrary: Magnet[];
      activeMagnetIds: Set<string>;
      gridSize: { columns: number; rows: number };
      defaultMagnetLibrary?: Magnet[];
      storageKey?: string;
      includeCustomMagnets?: boolean;
    }
  | null = null;
let scheduledAfterSave: null | (() => void | Promise<void>) = null;
const telemetry = getTelemetryLogger('magnets', 'config');
type LegacyBoundsEdgeKey = 'left' | 'right' | 'top' | 'bottom';
type BoundsAxisKey = keyof Magnet['bounds'];
type BoundsAxis = Magnet['bounds'][BoundsAxisKey];

function applyLegacyReferenceOffset(reference: Magnet['bounds']['horizontal']['start'], offset = 0) {
  if (offset === 0) return reference;
  return {
    ...reference,
    offset: (reference.offset ?? 0) + offset,
  };
}

function applyLegacyEdgeOffsets(
  edges: Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>,
  offsets?: MagnetBoundsOffsetConfig
): Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']> {
  return {
    left: applyLegacyReferenceOffset(edges.left, offsets?.left ?? 0),
    right: applyLegacyReferenceOffset(edges.right, offsets?.right ?? 0),
    top: applyLegacyReferenceOffset(edges.top, offsets?.top ?? 0),
    bottom: applyLegacyReferenceOffset(edges.bottom, offsets?.bottom ?? 0),
  };
}

function applyLegacyEdgeOverrides(
  edges: Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>,
  overrides?: Partial<Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>>
): Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']> {
  if (!overrides) return edges;

  return {
    left: overrides.left ?? edges.left,
    right: overrides.right ?? edges.right,
    top: overrides.top ?? edges.top,
    bottom: overrides.bottom ?? edges.bottom,
  };
}

function createLegacyBoundsSpec(edges: Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>): Magnet['bounds'] {
  return {
    horizontal: {
      start: edges.left,
      end: edges.right,
    },
    vertical: {
      start: edges.top,
      end: edges.bottom,
    },
  };
}

function createLegacyPanelBounds(options: PanelLayoutPresetOptions = {}): Magnet['bounds'] {
  const defaultEdges = {
    left: createBoundsReference('span', 'start'),
    right: createBoundsReference('span', 'end'),
    top: createBoundsReference('span', 'start'),
    bottom: createBoundsReference('span', 'end'),
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

function createLegacyHorizontalBarBounds(options: HorizontalBarLayoutPresetOptions): Magnet['bounds'] {
  const vertical = createFixedAxisBounds({
    source: 'slot',
    edge: options.dock?.y ?? 'center',
    size: options.height,
  });

  const defaultEdges = {
    left: createBoundsReference('span', 'start'),
    right: createBoundsReference('span', 'end'),
    top: vertical.start,
    bottom: vertical.end,
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

function createLegacySpanHorizontalBarBounds(options: HorizontalBarLayoutPresetOptions): Magnet['bounds'] {
  const vertical = createFixedAxisBounds({
    source: 'span',
    edge: options.dock?.y ?? 'center',
    size: options.height,
  });

  const defaultEdges = {
    left: createBoundsReference('span', 'start'),
    right: createBoundsReference('span', 'end'),
    top: vertical.start,
    bottom: vertical.end,
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

function createBandPanelBounds(options: PanelLayoutPresetOptions = {}): Magnet['bounds'] {
  const defaultEdges = {
    left: createBoundsReference('band', 'start'),
    right: createBoundsReference('band', 'end'),
    top: createBoundsReference('band', 'start'),
    bottom: createBoundsReference('band', 'end'),
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

function createBandSpanPanelBounds(options: PanelLayoutPresetOptions = {}): Magnet['bounds'] {
  const defaultEdges = {
    left: createBoundsReference('band', 'start'),
    right: createBoundsReference('band', 'end'),
    top: createBoundsReference('span', 'start'),
    bottom: createBoundsReference('span', 'end'),
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

function createBandHorizontalBarBounds(options: HorizontalBarLayoutPresetOptions): Magnet['bounds'] {
  const vertical = createFixedAxisBounds({
    source: 'slot',
    edge: options.dock?.y ?? 'center',
    size: options.height,
  });

  const defaultEdges = {
    left: createBoundsReference('band', 'start'),
    right: createBoundsReference('band', 'end'),
    top: vertical.start,
    bottom: vertical.end,
  } satisfies Record<LegacyBoundsEdgeKey, Magnet['bounds']['horizontal']['start']>;

  return createLegacyBoundsSpec(
    applyLegacyEdgeOffsets(applyLegacyEdgeOverrides(defaultEdges, options.edgeOverrides), options.edgeOffsets)
  );
}

const TRANSITIONAL_BUILTIN_BOUNDS_CANDIDATES_BY_MAGNET_ID: Partial<Record<string, Magnet['bounds'][]>> = {
  'navigation-page': [
    createBandSpanPanelBounds(),
    createBandPanelBounds(),
    createLegacyPanelBounds(),
    createLegacyPanelBounds({
      edgeOffsets: createControlBleedOffsets({
        left: true,
        right: true,
      }),
    }),
  ],
  navigator: [
    createBandSpanPanelBounds(),
    createBandPanelBounds(),
    createLegacyPanelBounds(),
    createLegacyPanelBounds({
      edgeOffsets: createControlBleedOffsets({
        left: true,
        right: true,
      }),
    }),
  ],
  'platform-magnet': [
    createBandSpanPanelBounds(),
    createBandPanelBounds(),
    createLegacyPanelBounds(),
    createLegacyPanelBounds({
      edgeOffsets: createControlBleedOffsets({
        left: true,
        right: true,
      }),
    }),
  ],
  'audio-visualizer': [createBandSpanPanelBounds(), createBandPanelBounds(), createLegacyPanelBounds()],
  'track-info': [createBandSpanPanelBounds(), createBandPanelBounds(), createLegacyPanelBounds()],
  'process-perf-monitor': [
    createBandSpanPanelBounds({
      edgeOverrides: {
        top: createBoundsReference('slot', 'end', { offset: -36 }),
      },
    }),
    createBandPanelBounds({
      edgeOverrides: {
        top: createBoundsReference('slot', 'end', { offset: -36 }),
      },
    }),
    createLegacyPanelBounds(),
    createLegacyPanelBounds({
      edgeOffsets: createControlBleedOffsets({ top: true }),
    }),
    createLegacyPanelBounds({
      edgeOverrides: {
        top: createMagnetEdgeReference('btn-back', 'start'),
      },
    }),
    createLegacyPanelBounds({
      edgeOverrides: {
        top: createBoundsReference('slot', 'end', { offset: -36 }),
      },
    }),
  ],
  'progress-bar': [
    createBandHorizontalBarBounds({ height: 24 }),
    createLegacyHorizontalBarBounds({ height: 24 }),
    createLegacySpanHorizontalBarBounds({ height: 24 }),
  ],
  'btn-matrix-change': [
    createBandHorizontalBarBounds({ height: 36 }),
    createLegacyHorizontalBarBounds({ height: 36 }),
    createLegacySpanHorizontalBarBounds({ height: 36 }),
  ],
  'dsp-vst': [
    createBandHorizontalBarBounds({ height: 36 }),
    createLegacyHorizontalBarBounds({ height: 36 }),
    createLegacySpanHorizontalBarBounds({ height: 36 }),
  ],
  'drag-handle': [
    createBandHorizontalBarBounds({
      height: 40,
      dock: { y: 'end' },
    }),
    createLegacyHorizontalBarBounds({ height: 40 }),
    createLegacySpanHorizontalBarBounds({ height: 40 }),
    createLegacyHorizontalBarBounds({
      height: 40,
      dock: { y: 'end' },
    }),
    createLegacySpanHorizontalBarBounds({
      height: 40,
      dock: { y: 'end' },
    }),
    createBandHorizontalBarBounds({
      height: 36,
      dock: { y: 'end' },
    }),
    createLegacyHorizontalBarBounds({ height: 36 }),
    createLegacySpanHorizontalBarBounds({ height: 36 }),
    createLegacyHorizontalBarBounds({
      height: 36,
      dock: { y: 'end' },
    }),
    createLegacySpanHorizontalBarBounds({
      height: 36,
      dock: { y: 'end' },
    }),
  ],
};
const TRANSITIONAL_HORIZONTAL_OUTSET = createControlBleedOutset({
  left: true,
  right: true,
});
const TRANSITIONAL_FULL_OUTSET = createControlBleedOutset({
  left: true,
  right: true,
  top: true,
  bottom: true,
});
const TRANSITIONAL_BUILTIN_CHROME_OUTSET_CANDIDATES_BY_MAGNET_ID: Partial<
  Record<string, Array<NonNullable<NonNullable<Magnet['chrome']>['outset']>>>
> = {
  'navigation-page': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  navigator: [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'platform-magnet': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'process-perf-monitor': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'audio-visualizer': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'track-info': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'progress-bar': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'btn-matrix-change': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'dsp-vst': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
  'drag-handle': [TRANSITIONAL_HORIZONTAL_OUTSET, TRANSITIONAL_FULL_OUTSET],
};
const TRANSITIONAL_BUILTIN_CHROME_INSET_CANDIDATES_BY_MAGNET_ID: Partial<
  Record<string, Array<NonNullable<NonNullable<Magnet['chrome']>['inset']>>>
> = {
  'process-perf-monitor': [STANDARD_PANEL_CHROME_INSET],
  'navigation-page': [STANDARD_PANEL_CHROME_INSET],
  'platform-magnet': [STANDARD_PANEL_CHROME_INSET],
  navigator: [STANDARD_PANEL_CHROME_INSET],
};

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFiniteOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

function areBoundsReferencesEqual(
  left: Magnet['bounds']['horizontal']['start'],
  right: Magnet['bounds']['horizontal']['start']
): boolean {
  if (left.source !== right.source) {
    return false;
  }

  if (left.edge !== right.edge) {
    return false;
  }

  if ((left.magnetId ?? null) !== (right.magnetId ?? null)) {
    return false;
  }

  return normalizeFiniteOffset(left.offset) === normalizeFiniteOffset(right.offset);
}

function boundsContainSource(
  bounds: Magnet['bounds'],
  source: Magnet['bounds']['horizontal']['start']['source']
): boolean {
  return (
    bounds.horizontal.start.source === source ||
    bounds.horizontal.end.source === source ||
    bounds.vertical.start.source === source ||
    bounds.vertical.end.source === source
  );
}

function areMagnetBoundsEqual(left: Magnet['bounds'], right: Magnet['bounds']): boolean {
  return (
    areBoundsReferencesEqual(left.horizontal.start, right.horizontal.start) &&
    areBoundsReferencesEqual(left.horizontal.end, right.horizontal.end) &&
    areBoundsReferencesEqual(left.vertical.start, right.vertical.start) &&
    areBoundsReferencesEqual(left.vertical.end, right.vertical.end)
  );
}

function nearlyEqual(left: number, right: number, epsilon = 0.001): boolean {
  return Math.abs(left - right) <= epsilon;
}

function inferFixedAxisSize(axis: BoundsAxis): number | null {
  const startOffset = normalizeFiniteOffset(axis.start.offset);
  const endOffset = normalizeFiniteOffset(axis.end.offset);

  if (axis.start.edge === 'center' && axis.end.edge === 'center') {
    return Math.abs(startOffset) + Math.abs(endOffset);
  }

  if (axis.start.edge === axis.end.edge) {
    return Math.abs(endOffset - startOffset);
  }

  return null;
}

function migrateBuiltinBarThicknessAxis(
  magnet: Magnet,
  persistedBounds: Magnet['bounds']
): Magnet['bounds'] | undefined {
  if (boundsContainSource(persistedBounds, 'band')) {
    return undefined;
  }

  if (magnet.anchorType !== 'horizontal' && magnet.anchorType !== 'vertical') {
    return undefined;
  }

  const thicknessAxisKey: BoundsAxisKey = magnet.anchorType === 'horizontal' ? 'vertical' : 'horizontal';
  const persistedAxis = persistedBounds[thicknessAxisKey];
  const defaultAxis = magnet.bounds[thicknessAxisKey];

  if (defaultAxis.start.source !== 'span' || defaultAxis.end.source !== 'span') {
    return undefined;
  }

  const thicknessSize = inferFixedAxisSize(defaultAxis);
  if (!thicknessSize) {
    return undefined;
  }

  const persistedSize = inferFixedAxisSize(persistedAxis);
  if (!persistedSize) {
    return undefined;
  }

  const persistedSource = persistedAxis.start.source;
  if (persistedSource !== persistedAxis.end.source) {
    return undefined;
  }

  if (persistedAxis.start.magnetId || persistedAxis.end.magnetId) {
    return undefined;
  }

  const matchesLegacySlotAxis =
    persistedSource === 'slot' && nearlyEqual(persistedSize, thicknessSize, 4.001);
  const matchesLegacySpanAxis =
    persistedSource === 'span' && nearlyEqual(persistedSize, thicknessSize, 4.001);

  if (!matchesLegacySlotAxis && !matchesLegacySpanAxis) {
    return undefined;
  }

  return {
    ...persistedBounds,
    [thicknessAxisKey]: defaultAxis,
  };
}

function areMagnetInsetsEqual(
  left: NonNullable<NonNullable<Magnet['chrome']>['outset']> | undefined,
  right: NonNullable<NonNullable<Magnet['chrome']>['outset']> | undefined
): boolean {
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if ((left?.[side] ?? 0) !== (right?.[side] ?? 0)) {
      return false;
    }
  }

  return true;
}

function migrateBuiltinBoundsTransition(
  magnet: Magnet,
  persistedBounds: Magnet['bounds'] | undefined
): Magnet['bounds'] | undefined {
  if (!persistedBounds) {
    return undefined;
  }

  if (!BUILTIN_MAGNET_IDS.has(magnet.id)) {
    return persistedBounds;
  }

  const transitionalBoundsCandidates = TRANSITIONAL_BUILTIN_BOUNDS_CANDIDATES_BY_MAGNET_ID[magnet.id];
  if (!transitionalBoundsCandidates || transitionalBoundsCandidates.length === 0) {
    const persistedHasBand = boundsContainSource(persistedBounds, 'band');
    const defaultHasBand = boundsContainSource(magnet.bounds, 'band');
    return persistedHasBand && !defaultHasBand ? magnet.bounds : persistedBounds;
  }

  const matchesTransition = transitionalBoundsCandidates.some((candidate) =>
    areMagnetBoundsEqual(persistedBounds, candidate)
  );

  if (matchesTransition) {
    return magnet.bounds;
  }

  const migratedThicknessAxis = migrateBuiltinBarThicknessAxis(magnet, persistedBounds);
  if (migratedThicknessAxis) {
    return migratedThicknessAxis;
  }

  const persistedHasBand = boundsContainSource(persistedBounds, 'band');
  const defaultHasBand = boundsContainSource(magnet.bounds, 'band');
  return persistedHasBand && !defaultHasBand ? magnet.bounds : persistedBounds;
}

function migrateBuiltinChromeTransition(
  magnet: Magnet,
  persistedChrome: Magnet['chrome'] | undefined
): Magnet['chrome'] | undefined {
  if (!persistedChrome) {
    return undefined;
  }

  if (!BUILTIN_MAGNET_IDS.has(magnet.id)) {
    return persistedChrome;
  }

  let changed = false;
  const nextChrome: NonNullable<Magnet['chrome']> = { ...persistedChrome };

  const transitionalOutsets = TRANSITIONAL_BUILTIN_CHROME_OUTSET_CANDIDATES_BY_MAGNET_ID[magnet.id];
  const matchesOutsetTransition = transitionalOutsets?.some((candidate) =>
    areMagnetInsetsEqual(persistedChrome.outset, candidate)
  );
  if (matchesOutsetTransition) {
    if (magnet.chrome?.outset) {
      nextChrome.outset = magnet.chrome.outset;
    } else {
      delete nextChrome.outset;
    }
    changed = true;
  }

  const transitionalInsets = TRANSITIONAL_BUILTIN_CHROME_INSET_CANDIDATES_BY_MAGNET_ID[magnet.id];
  const matchesInsetTransition = transitionalInsets?.some((candidate) =>
    areMagnetInsetsEqual(persistedChrome.inset, candidate)
  );
  if (matchesInsetTransition) {
    if (magnet.chrome?.inset) {
      nextChrome.inset = magnet.chrome.inset;
    } else {
      delete nextChrome.inset;
    }
    changed = true;
  }

  if (!changed) {
    return persistedChrome;
  }

  return Object.keys(nextChrome).length > 0 ? nextChrome : undefined;
}

function normalizeBuiltinMagnet(magnet: Magnet, defaultMagnet: Magnet | undefined): Magnet {
  if (!defaultMagnet) {
    return magnet;
  }

  const nextBounds = migrateBuiltinBoundsTransition(defaultMagnet, magnet.bounds) ?? magnet.bounds;
  const migratedChrome = migrateBuiltinChromeTransition(defaultMagnet, magnet.chrome);

  return {
    ...magnet,
    bounds: nextBounds,
    chrome: mergeMagnetChromeConfig(defaultMagnet.chrome, migratedChrome),
  };
}

/**
 * Magnets persistence/config public API.
 *
 * This module is the stable import surface for magnet config:
 * - load/save from storage
 * - apply config onto a default magnet library
 *
 * Under the hood it currently delegates to `utils/configManager.ts`.
 */
export function loadMagnetConfig(storageKey?: string): MagnetConfig | null {
  return loadConfig(storageKey);
}

export function saveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  storageKey?: string,
  options: { includeCustomMagnets?: boolean } = {}
): void {
  const includeCustomMagnets = options.includeCustomMagnets ?? false;
  saveConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, storageKey, {
    includeCustomMagnets,
  });
}

export function scheduleSaveMagnetConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  options: ScheduleSaveMagnetConfigOptions = {}
): void {
  const debounceMs = options.debounceMs ?? 300;
  const storageKey = options.storageKey;
  const includeCustomMagnets = options.includeCustomMagnets;

  scheduledSaveArgs = {
    magnetLibrary,
    activeMagnetIds,
    gridSize,
    defaultMagnetLibrary,
    storageKey,
    includeCustomMagnets,
  };
  scheduledAfterSave = options.afterSave ?? null;

  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
  }

  scheduledSaveTimeout = window.setTimeout(() => {
    scheduledSaveTimeout = null;
    const args = scheduledSaveArgs;
    scheduledSaveArgs = null;
    const afterSave = scheduledAfterSave;
    scheduledAfterSave = null;
    if (!args) return;
    try {
      saveMagnetConfig(
        args.magnetLibrary,
        args.activeMagnetIds,
        args.gridSize,
        args.defaultMagnetLibrary,
        args.storageKey,
        { includeCustomMagnets: args.includeCustomMagnets }
      );
      if (afterSave) {
        Promise.resolve(afterSave()).catch((error) => {
          telemetry.warn('config.after_save.failed', {
            message: readErrorMessage(error),
            fields: {
              mode: 'scheduled',
            },
          });
        });
      }
    } catch (error) {
      telemetry.warn('config.save_scheduled.failed', {
        message: readErrorMessage(error),
        fields: {
          storageKey: args.storageKey ?? null,
        },
      });
    }
  }, debounceMs);
}

export function cancelScheduledMagnetConfigSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }
  scheduledSaveArgs = null;
  scheduledAfterSave = null;
}

export function flushScheduledMagnetConfigSave(): void {
  if (scheduledSaveTimeout !== null) {
    window.clearTimeout(scheduledSaveTimeout);
    scheduledSaveTimeout = null;
  }

  const args = scheduledSaveArgs;
  scheduledSaveArgs = null;
  const afterSave = scheduledAfterSave;
  scheduledAfterSave = null;

  if (!args) return;

  try {
    saveMagnetConfig(
      args.magnetLibrary,
      args.activeMagnetIds,
      args.gridSize,
      args.defaultMagnetLibrary,
      args.storageKey,
      { includeCustomMagnets: args.includeCustomMagnets }
    );
    if (afterSave) {
      Promise.resolve(afterSave()).catch((error) => {
        telemetry.warn('config.after_save.failed', {
          message: readErrorMessage(error),
          fields: {
            mode: 'flush',
          },
        });
      });
    }
  } catch (error) {
    telemetry.warn('config.save_flush.failed', {
      message: readErrorMessage(error),
      fields: {
        storageKey: args.storageKey ?? null,
      },
    });
  }
}

export function applyMagnetConfig(
  config: MagnetConfig,
  defaultMagnetLibrary: Magnet[]
): {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
} {
  const applied = applyConfig(config, defaultMagnetLibrary);
  const defaultsById = Object.fromEntries(defaultMagnetLibrary.map((magnet) => [magnet.id, magnet])) as Record<
    string,
    Magnet
  >;

  return {
    ...applied,
    magnetLibrary: applied.magnetLibrary.map((magnet) => normalizeBuiltinMagnet(magnet, defaultsById[magnet.id])),
  };
}

export function resolveMagnetConfigStorageKey(
  activeSpaceId: string | null | undefined
): string {
  const normalized = typeof activeSpaceId === 'string' ? activeSpaceId.trim() : '';
  if (!normalized || normalized === 'space1') return STORAGE_KEYS.CONFIG;
  return `${STORAGE_KEYS.CONFIG}:${normalized}`;
}

export function patchMagnetStateConfigWithLayoutSnapshot(args: {
  magnets: Magnet[];
  currentStates: Record<string, MagnetStateConfig>;
  anchorsByMagnetId: Record<string, PixelAnchor[] | undefined>;
  activeMagnetIds: Set<string>;
}): Record<string, MagnetStateConfig> {
  const patchedStates: Record<string, MagnetStateConfig> = { ...args.currentStates };

  for (const magnet of args.magnets) {
    const existing = patchedStates[magnet.id];
    const nextBounds = migrateBuiltinBoundsTransition(magnet, existing?.bounds) ?? magnet.bounds;
    const migratedChrome = migrateBuiltinChromeTransition(magnet, existing?.chrome);

    patchedStates[magnet.id] = {
      ...(existing ?? { anchors: magnet.anchors, isActive: false, bounds: nextBounds }),
      anchors: args.anchorsByMagnetId[magnet.id] ?? existing?.anchors ?? magnet.anchors,
      isActive: args.activeMagnetIds.has(magnet.id),
      bounds: nextBounds,
      chrome: mergeMagnetChromeConfig(magnet.chrome, migratedChrome),
    };
  }

  return patchedStates;
}
