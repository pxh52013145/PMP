import { Magnet, PixelAnchor } from '../types/pixel';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from '../constants/magnets';
import { resolveMagnetPositions, detectConflicts } from './magnetPositionResolver';
import { readString, removeKey, writeString } from '../modules/storage';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

export interface MagnetStateConfig {
  anchors: PixelAnchor[];
  isActive: boolean;
  renderer?: string;
  variant?: string;
  skinProps?: Record<string, unknown>;
  previewText?: string;
  bounds: Magnet['bounds'];
  chrome?: Magnet['chrome'];
  styleOverride?: {
    style?: Magnet['style'];
    animation?: Magnet['animation'];
    content?: Magnet['content'];
  };
}

export interface MagnetConfig {
  version: string;
  gridSize: {
    columns: number;
    rows: number;
  };
  magnets: Record<string, MagnetStateConfig>;
  customMagnets: Magnet[];
}

const CONFIG_VERSION = '1.3.0';
const CONFIG_KEY = 'pixel-matrix-player-config';
const telemetry = getTelemetryLogger('magnets', 'configManager');

const MAGNET_STATE_CONFIG_KEYS = [
  'anchors',
  'isActive',
  'renderer',
  'variant',
  'skinProps',
  'previewText',
  'bounds',
  'chrome',
  'styleOverride',
] as const;

const CUSTOM_MAGNET_KEYS = [
  'id',
  'type',
  'name',
  'renderer',
  'previewText',
  'description',
  'tags',
  'variant',
  'skinProps',
  'anchors',
  'anchorType',
  'gridFootprint',
  'bounds',
  'content',
  'style',
  'chrome',
  'animation',
  'state',
  'interactions',
] as const;

const ANCHOR_TYPES = new Set<Magnet['anchorType']>(['single', 'horizontal', 'vertical', 'rectangular']);
const MAGNET_TYPES = new Set<Magnet['type']>([
  'window-control',
  'playback-control',
  'track-info',
  'drag-handle',
  'visualizer',
  'search-bar',
  'playlist',
  'progress-bar',
  'player',
  'navigation',
  'custom',
]);
const MAGNET_STATES = new Set<Magnet['state']>(['idle', 'hover', 'active', 'disabled']);
const BOUNDS_SOURCES = new Set<Magnet['bounds']['horizontal']['start']['source']>([
  'slot',
  'span',
  'band',
  'viewport',
  'magnet',
]);
const BOUNDS_EDGES = new Set<Magnet['bounds']['horizontal']['start']['edge']>(['start', 'center', 'end']);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SavedLayoutStateConfig = Pick<MagnetStateConfig, 'bounds' | 'chrome'>;
type SavedPresentationStateConfig = Pick<
  MagnetStateConfig,
  'renderer' | 'variant' | 'skinProps' | 'previewText' | 'styleOverride'
>;

function hasValue<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFiniteInset(value: unknown): NonNullable<Magnet['chrome']>['inset'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const nextInset: NonNullable<NonNullable<Magnet['chrome']>['inset']> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const sideValue = value[side];
    if (typeof sideValue === 'number' && Number.isFinite(sideValue)) {
      nextInset[side] = sideValue;
    }
  }

  return Object.keys(nextInset).length > 0 ? nextInset : undefined;
}

export function mergeMagnetChromeConfig(
  baseChrome: Magnet['chrome'] | undefined,
  overrideChrome: Magnet['chrome'] | undefined
): Magnet['chrome'] | undefined {
  if (!baseChrome) return overrideChrome;
  if (!overrideChrome) return baseChrome;

  const nextChrome: NonNullable<Magnet['chrome']> = {
    ...(baseChrome.enabled !== undefined ? { enabled: baseChrome.enabled } : {}),
    ...(overrideChrome.enabled !== undefined ? { enabled: overrideChrome.enabled } : {}),
  };

  const inset = overrideChrome.inset ?? baseChrome.inset;
  if (inset) {
    nextChrome.inset = inset;
  }

  const outset = overrideChrome.outset ?? baseChrome.outset;
  if (outset) {
    nextChrome.outset = outset;
  }

  return Object.keys(nextChrome).length > 0 ? nextChrome : undefined;
}

function sanitizeBoundsReference(
  value: unknown
): Magnet['bounds']['horizontal']['start'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (
    typeof value.source !== 'string' ||
    typeof value.edge !== 'string' ||
    !BOUNDS_SOURCES.has(value.source as Magnet['bounds']['horizontal']['start']['source']) ||
    !BOUNDS_EDGES.has(value.edge as Magnet['bounds']['horizontal']['start']['edge'])
  ) {
    return undefined;
  }

  const nextReference: Magnet['bounds']['horizontal']['start'] = {
    source: value.source as Magnet['bounds']['horizontal']['start']['source'],
    edge: value.edge as Magnet['bounds']['horizontal']['start']['edge'],
  };

  if (nextReference.source === 'magnet') {
    if (typeof value.magnetId !== 'string' || value.magnetId.length < 1) {
      return undefined;
    }

    nextReference.magnetId = value.magnetId;
  }

  if (typeof value.offset === 'number' && Number.isFinite(value.offset) && value.offset !== 0) {
    nextReference.offset = value.offset;
  }

  return nextReference;
}

function sanitizeBoundsAxis(
  value: unknown
): Magnet['bounds']['horizontal'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const start = sanitizeBoundsReference(value.start);
  const end = sanitizeBoundsReference(value.end);
  if (!start || !end) {
    return undefined;
  }

  return { start, end };
}

function sanitizeBounds(value: unknown): Magnet['bounds'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const horizontal = sanitizeBoundsAxis(value.horizontal);
  const vertical = sanitizeBoundsAxis(value.vertical);
  if (!horizontal || !vertical) {
    return undefined;
  }

  return { horizontal, vertical };
}

function sanitizeChrome(value: unknown): Magnet['chrome'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const nextChrome: NonNullable<Magnet['chrome']> = {};
  if (typeof value.enabled === 'boolean') {
    nextChrome.enabled = value.enabled;
  }

  const inset = sanitizeFiniteInset(value.inset);
  if (inset) {
    nextChrome.inset = inset;
  }

  const outset = sanitizeFiniteInset(value.outset);
  if (outset) {
    nextChrome.outset = outset;
  }

  return Object.keys(nextChrome).length > 0 ? nextChrome : undefined;
}

function sanitizePixelAnchor(anchor: unknown): PixelAnchor | null {
  if (!isPlainObject(anchor)) {
    return null;
  }
  if (
    typeof anchor.id !== 'string' ||
    typeof anchor.gridX !== 'number' ||
    !Number.isFinite(anchor.gridX) ||
    typeof anchor.gridY !== 'number' ||
    !Number.isFinite(anchor.gridY) ||
    (anchor.role !== 'anchor' && anchor.role !== 'boundary')
  ) {
    return null;
  }

  return {
    id: anchor.id,
    gridX: anchor.gridX,
    gridY: anchor.gridY,
    role: anchor.role,
  };
}

function sanitizeAnchors(value: unknown): PixelAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((anchor) => sanitizePixelAnchor(anchor))
    .filter((anchor): anchor is PixelAnchor => anchor !== null);
}

function sanitizeStyleOverride(value: unknown): MagnetStateConfig['styleOverride'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const next: NonNullable<MagnetStateConfig['styleOverride']> = {};
  if (isPlainObject(value.style)) {
    next.style = { ...value.style } as Magnet['style'];
  }
  if (isPlainObject(value.animation)) {
    next.animation = { ...value.animation } as Magnet['animation'];
  }
  if (Object.prototype.hasOwnProperty.call(value, 'content')) {
    next.content = value.content as Magnet['content'];
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeMagnetStateConfig(value: unknown): { config: MagnetStateConfig | null; changed: boolean } {
  if (!isPlainObject(value)) {
    return { config: null, changed: false };
  }

  let changed = Object.keys(value).some(
    (key) => !MAGNET_STATE_CONFIG_KEYS.includes(key as (typeof MAGNET_STATE_CONFIG_KEYS)[number])
  );
  const anchors = sanitizeAnchors(value.anchors);
  const bounds = sanitizeBounds(value.bounds);

  if (typeof value.isActive !== 'boolean' || anchors.length === 0 || !bounds) {
    return { config: null, changed: true };
  }

  const nextConfig: MagnetStateConfig = {
    anchors,
    isActive: value.isActive,
    bounds,
  };

  if (typeof value.renderer === 'string') nextConfig.renderer = value.renderer;
  if (typeof value.variant === 'string') nextConfig.variant = value.variant;
  if (isPlainObject(value.skinProps)) nextConfig.skinProps = { ...value.skinProps };
  if (typeof value.previewText === 'string') nextConfig.previewText = value.previewText;

  const chrome = sanitizeChrome(value.chrome);
  if (chrome) nextConfig.chrome = chrome;

  const styleOverride = sanitizeStyleOverride(value.styleOverride);
  if (styleOverride) nextConfig.styleOverride = styleOverride;

  changed ||= JSON.stringify(nextConfig) !== JSON.stringify(value);
  return { config: nextConfig, changed };
}

function sanitizeCustomMagnet<TMagnet extends Magnet>(value: unknown): { magnet: TMagnet | null; changed: boolean } {
  if (!isPlainObject(value)) {
    return { magnet: null, changed: false };
  }

  let changed = Object.keys(value).some(
    (key) => !CUSTOM_MAGNET_KEYS.includes(key as (typeof CUSTOM_MAGNET_KEYS)[number])
  );
  const anchors = sanitizeAnchors(value.anchors);
  const bounds = sanitizeBounds(value.bounds);
  const gridFootprint = isPlainObject(value.gridFootprint)
    ? (() => {
        const width = value.gridFootprint.width;
        const height = value.gridFootprint.height;
        if (
          typeof width === 'number' &&
          Number.isFinite(width) &&
          typeof height === 'number' &&
          Number.isFinite(height)
        ) {
          return { width, height };
        }
        return undefined;
      })()
    : undefined;
  const hasPlacementShape = anchors.length > 0 || Boolean(gridFootprint);

  if (
    typeof value.id !== 'string' ||
    value.id.length < 1 ||
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    !MAGNET_TYPES.has(value.type as Magnet['type']) ||
    !ANCHOR_TYPES.has(value.anchorType as Magnet['anchorType']) ||
    !MAGNET_STATES.has(value.state as Magnet['state']) ||
    !isPlainObject(value.style) ||
    !isPlainObject(value.interactions) ||
    typeof value.interactions.draggable !== 'boolean' ||
    typeof value.interactions.clickable !== 'boolean' ||
    !hasPlacementShape ||
    !bounds ||
    !Object.prototype.hasOwnProperty.call(value, 'content')
  ) {
    return { magnet: null, changed: true };
  }

  const nextMagnet: Magnet = {
    id: value.id,
    type: value.type as Magnet['type'],
    name: value.name,
    anchors,
    anchorType: value.anchorType as Magnet['anchorType'],
    bounds,
    content: value.content as Magnet['content'],
    style: { ...value.style } as Magnet['style'],
    state: value.state as Magnet['state'],
    interactions: {
      draggable: value.interactions.draggable,
      clickable: value.interactions.clickable,
    },
  };

  if (typeof value.renderer === 'string') nextMagnet.renderer = value.renderer;
  if (typeof value.previewText === 'string') nextMagnet.previewText = value.previewText;
  if (typeof value.description === 'string') nextMagnet.description = value.description;
  if (Array.isArray(value.tags)) {
    nextMagnet.tags = value.tags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof value.variant === 'string') nextMagnet.variant = value.variant;
  if (isPlainObject(value.skinProps)) nextMagnet.skinProps = { ...value.skinProps };
  if (gridFootprint) nextMagnet.gridFootprint = gridFootprint;

  const chrome = sanitizeChrome(value.chrome);
  if (chrome) nextMagnet.chrome = chrome;

  if (isPlainObject(value.animation)) {
    nextMagnet.animation = { ...value.animation } as Magnet['animation'];
  }

  changed ||= JSON.stringify(nextMagnet) !== JSON.stringify(value);
  return { magnet: nextMagnet as TMagnet, changed };
}

function sanitizeConfigForPersistence(config: MagnetConfig): { config: MagnetConfig; changed: boolean } {
  if (
    !config ||
    typeof config !== 'object' ||
    !config.gridSize ||
    typeof config.gridSize.columns !== 'number' ||
    !Number.isFinite(config.gridSize.columns) ||
    typeof config.gridSize.rows !== 'number' ||
    !Number.isFinite(config.gridSize.rows) ||
    !isPlainObject(config.magnets)
  ) {
    throw new Error('Invalid config file: missing required fields');
  }

  let changed = Object.keys(config as unknown as Record<string, unknown>).some(
    (key) => !['version', 'gridSize', 'magnets', 'customMagnets'].includes(key)
  );

  const magnets: MagnetConfig['magnets'] = {};
  for (const [magnetId, state] of Object.entries(config.magnets)) {
    const result = sanitizeMagnetStateConfig(state);
    changed ||= result.changed;
    if (result.config) {
      magnets[magnetId] = result.config;
    }
  }

  const rawCustomMagnets = Array.isArray(config.customMagnets) ? config.customMagnets : [];
  if (!Array.isArray(config.customMagnets)) {
    changed = true;
  }

  const customMagnets = rawCustomMagnets
    .map((magnet) => sanitizeCustomMagnet(magnet))
    .reduce<Magnet[]>((accumulator, result) => {
      changed ||= result.changed;
      if (result.magnet) {
        accumulator.push(result.magnet);
      }
      return accumulator;
    }, []);

  return {
    config: {
      version: typeof config.version === 'string' ? config.version : CONFIG_VERSION,
      gridSize: {
        columns: config.gridSize.columns,
        rows: config.gridSize.rows,
      },
      magnets,
      customMagnets,
    },
    changed,
  };
}

function createStyleOverrideConfig(
  magnet: Magnet,
  defaultMagnet: Magnet | undefined
): NonNullable<MagnetStateConfig['styleOverride']> | undefined {
  if (!defaultMagnet) return undefined;

  const styleOverride: NonNullable<MagnetStateConfig['styleOverride']> = {};

  if (JSON.stringify(magnet.style) !== JSON.stringify(defaultMagnet.style)) {
    styleOverride.style = magnet.style;
  }

  if (JSON.stringify(magnet.animation) !== JSON.stringify(defaultMagnet.animation)) {
    styleOverride.animation = magnet.animation;
  }

  if (JSON.stringify(magnet.content) !== JSON.stringify(defaultMagnet.content)) {
    styleOverride.content = magnet.content;
  }

  return Object.keys(styleOverride).length > 0 ? styleOverride : undefined;
}

function createLayoutStateConfig(magnet: Magnet): SavedLayoutStateConfig {
  return {
    bounds: magnet.bounds,
    ...(magnet.chrome ? { chrome: magnet.chrome } : {}),
  };
}

function createMagnetStateConfig(
  magnet: Magnet,
  isActive: boolean,
  defaultMagnet?: Magnet
): MagnetStateConfig {
  const styleOverride = createStyleOverrideConfig(magnet, defaultMagnet);

  return {
    anchors: magnet.anchors,
    isActive,
    renderer: magnet.renderer,
    variant: magnet.variant,
    skinProps: magnet.skinProps,
    previewText: magnet.previewText,
    ...createLayoutStateConfig(magnet),
    ...(hasValue(styleOverride) ? { styleOverride } : {}),
  };
}

function applySavedPresentationState<TMagnet extends Magnet>(
  magnet: TMagnet,
  savedConfig: SavedPresentationStateConfig,
  options: { keepInteractions?: Magnet['interactions'] } = {}
): TMagnet {
  const nextMagnet: TMagnet = {
    ...magnet,
    renderer: savedConfig.renderer ?? magnet.renderer,
    variant: savedConfig.variant ?? magnet.variant,
    skinProps: savedConfig.skinProps ?? magnet.skinProps,
    previewText: savedConfig.previewText ?? magnet.previewText,
  };

  if (savedConfig.styleOverride?.style !== undefined) {
    nextMagnet.style = savedConfig.styleOverride.style;
  }

  if (savedConfig.styleOverride?.animation !== undefined) {
    nextMagnet.animation = savedConfig.styleOverride.animation;
  }

  if (savedConfig.styleOverride?.content !== undefined) {
    nextMagnet.content = savedConfig.styleOverride.content;
  }

  if (options.keepInteractions) {
    nextMagnet.interactions = options.keepInteractions;
  }

  return nextMagnet;
}

function applySavedLayoutState<TMagnet extends Magnet>(
  magnet: TMagnet,
  savedConfig: SavedLayoutStateConfig
): TMagnet {
  return {
    ...magnet,
    bounds: savedConfig.bounds ?? magnet.bounds,
    chrome: mergeMagnetChromeConfig(magnet.chrome, savedConfig.chrome),
  };
}

export function saveConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[],
  storageKey: string = CONFIG_KEY,
  options: { includeCustomMagnets?: boolean } = {}
): void {
  try {
    const includeCustomMagnets = options.includeCustomMagnets ?? true;
    const config: MagnetConfig = {
      version: CONFIG_VERSION,
      gridSize,
      magnets: {},
      customMagnets: [],
    };

    magnetLibrary.forEach((magnet) => {
      const isActive = activeMagnetIds.has(magnet.id);
      const defaultMagnet = BUILTIN_MAGNET_IDS.has(magnet.id)
        ? defaultMagnetLibrary?.find((candidate) => candidate.id === magnet.id)
        : undefined;
      const magnetConfig = createMagnetStateConfig(magnet, isActive, defaultMagnet);

      config.magnets[magnet.id] = magnetConfig;
    });

    config.customMagnets = includeCustomMagnets
      ? magnetLibrary
          .filter((m) => !BUILTIN_MAGNET_IDS.has(m.id))
          .map((magnet) => sanitizeCustomMagnet(magnet).magnet)
          .filter((magnet): magnet is Magnet => magnet !== null)
      : [];

    writeString(storageKey, JSON.stringify(config));
  } catch (error) {
    telemetry.error('config.save.failed', {
      message: readErrorMessage(error),
      fields: {
        storageKey,
      },
    });
  }
}

function parseStoredConfig(text: string): { config: MagnetConfig; changed: boolean } {
  return sanitizeConfigForPersistence(JSON.parse(text) as MagnetConfig);
}

export function loadConfig(storageKey: string = CONFIG_KEY): MagnetConfig | null {
  try {
    const configStr = readString(storageKey);
    if (!configStr) {
      return null;
    }

    const sanitizedResult = parseStoredConfig(configStr);
    let config = sanitizedResult.config;
    let shouldPersist = false;

    if (config.version !== CONFIG_VERSION) {
      telemetry.warn('config.load.version_mismatch', {
        message: 'Persisted config version mismatch. Updating to current version.',
        fields: {
          storageKey,
          fromVersion: config.version,
          targetVersion: CONFIG_VERSION,
        },
      });
      config = { ...config, version: CONFIG_VERSION };
      shouldPersist = true;
    }
    shouldPersist ||= sanitizedResult.changed;

    if (shouldPersist) {
      writeString(storageKey, JSON.stringify(config));
    }

    return config;
  } catch (error) {
    telemetry.error('config.load.failed', {
      message: readErrorMessage(error),
      fields: {
        storageKey,
      },
    });
    return null;
  }
}

export function clearConfig(): void {
  try {
    removeKey(CONFIG_KEY);
  } catch (error) {
    telemetry.error('config.clear.failed', {
      message: readErrorMessage(error),
      fields: {
        storageKey: CONFIG_KEY,
      },
    });
  }
}

function deduplicateMagnets(magnets: Magnet[]): Magnet[] {
  const seen = new Set<string>();
  const result: Magnet[] = [];

  for (const magnet of magnets) {
    if (!seen.has(magnet.id)) {
      seen.add(magnet.id);
      result.push(magnet);
    } else {
      telemetry.warn('config.magnet.duplicate_id', {
        message: 'Duplicate magnet id detected. Skipping duplicate entry.',
        fields: {
          magnetId: magnet.id,
        },
      });
    }
  }

  return result;
}

function validateMagnet(magnet: Magnet): boolean {
  if (!magnet.id || typeof magnet.id !== 'string') {
    telemetry.error('config.magnet.invalid_missing_id', {
      message: 'Invalid magnet: missing id.',
      fields: {
        hasAnchors: Array.isArray(magnet.anchors),
      },
    });
    return false;
  }

  const hasAnchors = Array.isArray(magnet.anchors) && magnet.anchors.length > 0;
  const hasGridFootprint =
    magnet.gridFootprint &&
    typeof magnet.gridFootprint.width === 'number' &&
    Number.isFinite(magnet.gridFootprint.width) &&
    magnet.gridFootprint.width > 0 &&
    typeof magnet.gridFootprint.height === 'number' &&
    Number.isFinite(magnet.gridFootprint.height) &&
    magnet.gridFootprint.height > 0;

  if (!hasAnchors && !hasGridFootprint) {
    telemetry.error('config.magnet.invalid_anchors', {
      message: 'Invalid magnet: missing anchors or grid footprint.',
      fields: {
        magnetId: magnet.id,
        anchorCount: Array.isArray(magnet.anchors) ? magnet.anchors.length : 0,
        hasGridFootprint: Boolean(hasGridFootprint),
      },
    });
    return false;
  }

  if (!magnet.bounds) {
    telemetry.error('config.magnet.invalid_bounds', {
      message: 'Invalid magnet: missing bounds.',
      fields: {
        magnetId: magnet.id,
      },
    });
    return false;
  }

  return true;
}

function sanitizeConfig(config: MagnetConfig): MagnetConfig {
  const sanitized = sanitizeConfigForPersistence(config).config;

  if (sanitized.customMagnets) {
    sanitized.customMagnets = sanitized.customMagnets
      .map((magnet) => sanitizeCustomMagnet(magnet).magnet)
      .filter((magnet): magnet is Magnet => magnet !== null)
      .filter((m) => {
        if (BUILTIN_MAGNET_IDS.has(m.id)) {
          telemetry.warn('config.sanitize.remove_builtin_custom', {
            message: 'Removing builtin magnet from customMagnets.',
            fields: {
              magnetId: m.id,
            },
          });
          return false;
        }
        return validateMagnet(m);
      });

    sanitized.customMagnets = deduplicateMagnets(sanitized.customMagnets);
  }

  return sanitized;
}

export function applyConfig(
  config: MagnetConfig,
  defaultMagnetLibrary: Magnet[]
): {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
} {
  const cleanConfig = sanitizeConfig(config);

  const magnetLibrary: Magnet[] = [];
  const activeMagnetIds = new Set<string>();
  const addedIds = new Set<string>();

  defaultMagnetLibrary.forEach((defaultMagnet) => {
    if (addedIds.has(defaultMagnet.id)) {
      telemetry.warn('config.apply.skip_duplicate_builtin', {
        message: 'Skipping duplicate builtin magnet.',
        fields: {
          magnetId: defaultMagnet.id,
        },
      });
      return;
    }

    const savedConfig = cleanConfig.magnets[defaultMagnet.id];

    if (savedConfig) {
      const appliedMagnet = applySavedPresentationState(
        {
          ...defaultMagnet,
          anchors: savedConfig.anchors,
        },
        savedConfig,
        { keepInteractions: defaultMagnet.interactions }
      );
      const layoutAppliedMagnet = applySavedLayoutState(appliedMagnet, savedConfig);

      magnetLibrary.push(layoutAppliedMagnet);
      addedIds.add(defaultMagnet.id);

      if (savedConfig.isActive) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    } else {
      magnetLibrary.push(defaultMagnet);
      addedIds.add(defaultMagnet.id);
      if (DEFAULT_ACTIVE_MAGNET_IDS.has(defaultMagnet.id)) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    }
  });

  if (cleanConfig.customMagnets) {
    cleanConfig.customMagnets.forEach((customMagnet) => {
      if (addedIds.has(customMagnet.id) || BUILTIN_MAGNET_IDS.has(customMagnet.id)) {
        telemetry.warn('config.apply.skip_duplicate_or_builtin_custom', {
          message: 'Skipping duplicate or builtin custom magnet.',
          fields: {
            magnetId: customMagnet.id,
            isBuiltin: BUILTIN_MAGNET_IDS.has(customMagnet.id),
          },
        });
        return;
      }

      if (!validateMagnet(customMagnet)) {
        return;
      }

      const savedConfig = cleanConfig.magnets[customMagnet.id];

      if (savedConfig) {
        const nextMagnet = applySavedPresentationState(
          {
            ...customMagnet,
            anchors: savedConfig.anchors,
          },
          savedConfig
        );

        const layoutAppliedMagnet = applySavedLayoutState(nextMagnet, savedConfig);

        magnetLibrary.push(layoutAppliedMagnet);
        addedIds.add(customMagnet.id);

        if (savedConfig.isActive) {
          activeMagnetIds.add(customMagnet.id);
        }
      } else {
        magnetLibrary.push(customMagnet);
        addedIds.add(customMagnet.id);
      }
    });
  }

  const activeMagnets = magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
  const conflicts = detectConflicts(activeMagnets);
  if (conflicts.length === 0) {
    return { magnetLibrary, activeMagnetIds };
  }

  telemetry.warn('config.apply.conflicts_detected', {
    message: 'Detected active magnet layout conflicts. Auto resolving.',
    fields: {
      conflictCount: conflicts.length,
    },
  });
  conflicts.forEach((conflict) => {
    telemetry.warn('config.apply.conflict_detail', {
      message: 'Active magnet layout conflict detail.',
      fields: {
        magnetId1: conflict.magnet1,
        magnetId2: conflict.magnet2,
        overlapPixelCount: conflict.conflictPixels.length,
      },
    });
  });

  const resolvedActive = resolveMagnetPositions(activeMagnets);
  const resolvedById = new Map(resolvedActive.map((m) => [m.id, m]));
  const resolvedMagnetLibrary = magnetLibrary.map((m) => resolvedById.get(m.id) ?? m);

  return { magnetLibrary: resolvedMagnetLibrary, activeMagnetIds };
}
