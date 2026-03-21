import { Magnet, PixelAnchor } from '../types/pixel';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from '../constants/magnets';
import { resolveMagnetPositions, detectConflicts } from './magnetPositionResolver';
import { readString, removeKey, writeString } from '../modules/storage';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

/**
 * 閰嶇疆鏂囦欢鏍煎紡
 */
export interface MagnetStateConfig {
  anchors: PixelAnchor[];
  isActive: boolean;
  renderer?: string;
  variant?: string;
  skinProps?: Record<string, unknown>;
  previewText?: string;
  boundsMode?: Magnet['boundsMode'];
  boundsDock?: Magnet['boundsDock'];
  boundsInset?: Magnet['boundsInset'];
  boundsOutset?: Magnet['boundsOutset'];
  boundsAlign?: Magnet['boundsAlign'];
  chromeEnabled?: boolean;
  chromeInset?: NonNullable<Magnet['chrome']>['inset'];
  styleOverride?: {
    style?: Magnet['style'];
    animation?: Magnet['animation'];
    content?: Magnet['content'];
  };
}

export interface MagnetConfig {
  version: string; // 閰嶇疆鐗堟湰锛岀敤浜庡吋瀹规€ф鏌?
  gridSize: {
    columns: number;
    rows: number;
  };
  magnets: Record<string, MagnetStateConfig>;
  customMagnets: Magnet[]; // 鑷畾涔?Magnet 鐨勫畬鏁村畾涔?
}

const CONFIG_VERSION = '1.2.0';
const CONFIG_KEY = 'pixel-matrix-player-config';
const telemetry = getTelemetryLogger('magnets', 'configManager');

const MAGNET_STATE_CONFIG_KEYS = [
  'anchors',
  'isActive',
  'renderer',
  'variant',
  'skinProps',
  'previewText',
  'boundsMode',
  'boundsDock',
  'boundsInset',
  'boundsOutset',
  'boundsAlign',
  'chromeEnabled',
  'chromeInset',
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
  'boundsMode',
  'boundsDock',
  'boundsInset',
  'boundsOutset',
  'boundsAlign',
  'content',
  'style',
  'chrome',
  'animation',
  'state',
  'interactions',
] as const;

const BOUNDS_DOCK_AXES = new Set<NonNullable<Magnet['boundsDock']>['x']>(['start', 'center', 'end']);
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SavedLayoutStateConfig = Pick<
  MagnetStateConfig,
  | 'boundsMode'
  | 'boundsDock'
  | 'boundsInset'
  | 'boundsOutset'
  | 'boundsAlign'
  | 'chromeEnabled'
  | 'chromeInset'
>;

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

function sanitizeFiniteInset(value: unknown): Magnet['boundsInset'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const nextInset: NonNullable<Magnet['boundsInset']> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const sideValue = value[side];
    if (typeof sideValue === 'number' && Number.isFinite(sideValue)) {
      nextInset[side] = sideValue;
    }
  }

  return Object.keys(nextInset).length > 0 ? nextInset : undefined;
}

function sanitizeBoundsDock(value: unknown): Magnet['boundsDock'] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const nextDock: NonNullable<Magnet['boundsDock']> = {};
  if (typeof value.x === 'string' && BOUNDS_DOCK_AXES.has(value.x as NonNullable<Magnet['boundsDock']>['x'])) {
    nextDock.x = value.x as NonNullable<Magnet['boundsDock']>['x'];
  }
  if (typeof value.y === 'string' && BOUNDS_DOCK_AXES.has(value.y as NonNullable<Magnet['boundsDock']>['y'])) {
    nextDock.y = value.y as NonNullable<Magnet['boundsDock']>['y'];
  }

  return Object.keys(nextDock).length > 0 ? nextDock : undefined;
}

function sanitizeBoundsAlign(value: unknown): Magnet['boundsAlign'] | undefined {
  if (!isPlainObject(value) || typeof value.topToMagnetId !== 'string' || value.topToMagnetId.length < 1) {
    return undefined;
  }

  return {
    topToMagnetId: value.topToMagnetId,
  };
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

  let changed = Object.keys(value).some((key) => !MAGNET_STATE_CONFIG_KEYS.includes(key as (typeof MAGNET_STATE_CONFIG_KEYS)[number]));
  const anchors = sanitizeAnchors(value.anchors);

  if (typeof value.isActive !== 'boolean' || anchors.length === 0) {
    return { config: null, changed: true };
  }

  const nextConfig: MagnetStateConfig = {
    anchors,
    isActive: value.isActive,
  };

  if (typeof value.renderer === 'string') nextConfig.renderer = value.renderer;
  if (typeof value.variant === 'string') nextConfig.variant = value.variant;
  if (isPlainObject(value.skinProps)) nextConfig.skinProps = { ...value.skinProps };
  if (typeof value.previewText === 'string') nextConfig.previewText = value.previewText;
  if (value.boundsMode === 'centered' || value.boundsMode === 'docked') nextConfig.boundsMode = value.boundsMode;

  const boundsDock = sanitizeBoundsDock(value.boundsDock);
  if (boundsDock) nextConfig.boundsDock = boundsDock;

  const boundsInset = sanitizeFiniteInset(value.boundsInset);
  if (boundsInset) nextConfig.boundsInset = boundsInset;

  const boundsOutset = sanitizeFiniteInset(value.boundsOutset);
  if (boundsOutset) nextConfig.boundsOutset = boundsOutset;

  const boundsAlign = sanitizeBoundsAlign(value.boundsAlign);
  if (boundsAlign) nextConfig.boundsAlign = boundsAlign;

  if (typeof value.chromeEnabled === 'boolean') nextConfig.chromeEnabled = value.chromeEnabled;

  const chromeInset = sanitizeFiniteInset(value.chromeInset);
  if (chromeInset) nextConfig.chromeInset = chromeInset;

  const styleOverride = sanitizeStyleOverride(value.styleOverride);
  if (styleOverride) nextConfig.styleOverride = styleOverride;

  changed ||= JSON.stringify(nextConfig) !== JSON.stringify(value);
  return { config: nextConfig, changed };
}

function sanitizeCustomMagnet<TMagnet extends Magnet>(value: unknown): { magnet: TMagnet | null; changed: boolean } {
  if (!isPlainObject(value)) {
    return { magnet: null, changed: false };
  }

  let changed = Object.keys(value).some((key) => !CUSTOM_MAGNET_KEYS.includes(key as (typeof CUSTOM_MAGNET_KEYS)[number]));
  const anchors = sanitizeAnchors(value.anchors);

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
    anchors.length === 0 ||
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
  if (isPlainObject(value.gridFootprint)) {
    const width = value.gridFootprint.width;
    const height = value.gridFootprint.height;
    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      typeof height === 'number' &&
      Number.isFinite(height)
    ) {
      nextMagnet.gridFootprint = { width, height };
    }
  }
  if (value.boundsMode === 'centered' || value.boundsMode === 'docked') nextMagnet.boundsMode = value.boundsMode;

  const boundsDock = sanitizeBoundsDock(value.boundsDock);
  if (boundsDock) nextMagnet.boundsDock = boundsDock;

  const boundsInset = sanitizeFiniteInset(value.boundsInset);
  if (boundsInset) nextMagnet.boundsInset = boundsInset;

  const boundsOutset = sanitizeFiniteInset(value.boundsOutset);
  if (boundsOutset) nextMagnet.boundsOutset = boundsOutset;

  const boundsAlign = sanitizeBoundsAlign(value.boundsAlign);
  if (boundsAlign) nextMagnet.boundsAlign = boundsAlign;

  if (isPlainObject(value.chrome)) {
    const chrome: NonNullable<Magnet['chrome']> = {};
    if (typeof value.chrome.enabled === 'boolean') chrome.enabled = value.chrome.enabled;
    const chromeInset = sanitizeFiniteInset(value.chrome.inset);
    if (chromeInset) chrome.inset = chromeInset;
    if (Object.keys(chrome).length > 0) {
      nextMagnet.chrome = chrome;
    }
  }
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

function createLayoutStateConfig(magnet: Magnet): SavedLayoutStateConfig {
  return {
    boundsMode: magnet.boundsMode,
    boundsDock: magnet.boundsDock,
    boundsInset: magnet.boundsInset,
    boundsOutset: magnet.boundsOutset,
    boundsAlign: magnet.boundsAlign,
    chromeEnabled: magnet.chrome?.enabled,
    chromeInset: magnet.chrome?.inset,
  };
}

function applySavedLayoutState<TMagnet extends Magnet>(
  magnet: TMagnet,
  savedConfig: SavedLayoutStateConfig
): TMagnet {
  const nextMagnet = {
    ...magnet,
    boundsMode: savedConfig.boundsMode ?? magnet.boundsMode,
    boundsDock: savedConfig.boundsDock ?? magnet.boundsDock,
    boundsInset: savedConfig.boundsInset ?? magnet.boundsInset,
    boundsOutset: savedConfig.boundsOutset ?? magnet.boundsOutset,
    boundsAlign: savedConfig.boundsAlign ?? magnet.boundsAlign,
  };

  if (typeof savedConfig.chromeEnabled === 'boolean' || savedConfig.chromeInset !== undefined) {
    nextMagnet.chrome = {
      ...(magnet.chrome ?? {}),
      ...(typeof savedConfig.chromeEnabled === 'boolean' ? { enabled: savedConfig.chromeEnabled } : {}),
      ...(savedConfig.chromeInset !== undefined ? { inset: savedConfig.chromeInset } : {}),
    };
  }

  return nextMagnet;
}

/**
 * 淇濆瓨閰嶇疆鍒?localStorage
 */
export function saveConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[], // 鍙€夛細榛樿 Magnet 搴擄紝鐢ㄤ簬瀵规瘮妫€娴嬩慨鏀?
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

    // 淇濆瓨鎵€鏈?Magnet 鐨勪綅缃拰婵€娲荤姸鎬?
    magnetLibrary.forEach((magnet) => {
      const isActive = activeMagnetIds.has(magnet.id);
      const defaultMagnet = BUILTIN_MAGNET_IDS.has(magnet.id)
        ? defaultMagnetLibrary?.find((candidate) => candidate.id === magnet.id)
        : undefined;
      const magnetConfig = createMagnetStateConfig(magnet, isActive, defaultMagnet);

      config.magnets[magnet.id] = magnetConfig;
    });

    // 淇濆瓨鑷畾涔?Magnet 鐨勫畬鏁村畾涔?
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

/**
 * 杩佺Щ鏃х殑 Magnet ID 鍒版柊 ID
 */
function parseStoredConfig(text: string): { config: MagnetConfig; changed: boolean } {
  return sanitizeConfigForPersistence(JSON.parse(text) as MagnetConfig);

  // 杩佺Щ magnets 瀵硅薄涓殑 key

  // 杩佺Щ customMagnets 涓殑 id

}

/**
 * 浠?localStorage 鍔犺浇閰嶇疆
 */
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

/**
 * 瀵煎嚭閰嶇疆鍒?JSON 鏂囦欢
 */
export function exportConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[]
): string {
  // 澶嶇敤 saveConfig 鐨勯€昏緫
  const config: MagnetConfig = {
    version: CONFIG_VERSION,
    gridSize,
    magnets: {},
    customMagnets: [],
  };

  // 淇濆瓨鎵€鏈?Magnet 鐨勪綅缃拰婵€娲荤姸鎬?
  magnetLibrary.forEach((magnet) => {
    const defaultMagnet = BUILTIN_MAGNET_IDS.has(magnet.id)
      ? defaultMagnetLibrary?.find((candidate) => candidate.id === magnet.id)
      : undefined;
    const magnetConfig = createMagnetStateConfig(
      magnet,
      activeMagnetIds.has(magnet.id),
      defaultMagnet
    );

    config.magnets[magnet.id] = magnetConfig;
  });

  config.customMagnets = magnetLibrary
    .filter((m) => !BUILTIN_MAGNET_IDS.has(m.id))
    .map((magnet) => sanitizeCustomMagnet(magnet).magnet)
    .filter((magnet): magnet is Magnet => magnet !== null);

  return JSON.stringify(config, null, 2);
}

/**
 * 瀵煎叆閰嶇疆浠?JSON 瀛楃涓?
 */
export function importConfig(jsonStr: string): MagnetConfig | null {
  try {
    const sanitizedResult = parseStoredConfig(jsonStr);
    let config = sanitizedResult.config;

    // 楠岃瘉蹇呰瀛楁
    if (!config.version || !config.gridSize || !config.magnets) {
      throw new Error('Invalid config file: missing required fields');
    }

    if (config.version !== CONFIG_VERSION) {
      telemetry.warn('config.import.version_mismatch', {
        message: 'Imported config version mismatch. Updating to current version.',
        fields: {
          fromVersion: config.version,
          targetVersion: CONFIG_VERSION,
        },
      });
      config = { ...config, version: CONFIG_VERSION };
    }

    return config;
  } catch (error) {
    telemetry.error('config.import.failed', {
      message: readErrorMessage(error),
    });
    return null;
  }
}

/**
 * 娓呴櫎淇濆瓨鐨勯厤缃?
 */
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

/**
 * 鍘婚噸 Magnet 鏁扮粍锛堟寜 ID锛?
 */
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

/**
 * 楠岃瘉 Magnet 閰嶇疆
 */
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

  if (!magnet.anchors || !Array.isArray(magnet.anchors) || magnet.anchors.length === 0) {
    telemetry.error('config.magnet.invalid_anchors', {
      message: 'Invalid magnet: missing anchors.',
      fields: {
        magnetId: magnet.id,
        anchorCount: Array.isArray(magnet.anchors) ? magnet.anchors.length : 0,
      },
    });
    return false;
  }

  return true;
}

/**
 * 娓呯悊閰嶇疆涓殑閲嶅鍜屾棤鏁堟暟鎹?
 */
function sanitizeConfig(config: MagnetConfig): MagnetConfig {
  const sanitized = sanitizeConfigForPersistence(config).config;

  // 娓呯悊 customMagnets 涓殑鍐呯疆 magnet
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

    // 鍘婚噸
    sanitized.customMagnets = deduplicateMagnets(sanitized.customMagnets);
  }

  return sanitized;
}

/**
 * 鍚堝苟閰嶇疆鍒扮幇鏈夊簱锛堢敤浜庡簲鐢ㄥ姞杞界殑閰嶇疆锛?
 */
export function applyConfig(
  config: MagnetConfig,
  defaultMagnetLibrary: Magnet[]
): {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
} {
  // 娓呯悊閰嶇疆
  const cleanConfig = sanitizeConfig(config);

  const magnetLibrary: Magnet[] = [];
  const activeMagnetIds = new Set<string>();

  // 鐢ㄤ簬鍘婚噸鐨勯泦鍚?
  const addedIds = new Set<string>();

  // 1. 棣栧厛澶勭悊鍐呯疆 Magnet
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

      // 鎭㈠婵€娲荤姸鎬?
      if (savedConfig.isActive) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    } else {
      // 浣跨敤榛樿閰嶇疆
      magnetLibrary.push(defaultMagnet);
      addedIds.add(defaultMagnet.id);
      // 榛樿婵€娲伙紙浠呭鈥滈粯璁ゆ縺娲婚泦鍚堚€濅腑鐨勫唴缃?Magnet锛?
      if (DEFAULT_ACTIVE_MAGNET_IDS.has(defaultMagnet.id)) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    }
  });

  // 2. 娣诲姞鑷畾涔?Magnet锛堟帓闄ゅ唴缃?magnet 鍜屽凡娣诲姞鐨勶級
  if (cleanConfig.customMagnets) {
    cleanConfig.customMagnets.forEach((customMagnet) => {
      // 璺宠繃宸叉坊鍔犵殑鍜屽唴缃殑
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

        // 鎭㈠婵€娲荤姸鎬?
        if (savedConfig.isActive) {
          activeMagnetIds.add(customMagnet.id);
        }
      } else {
        // 浣跨敤鍘熷閰嶇疆
        magnetLibrary.push(customMagnet);
        addedIds.add(customMagnet.id);
      }
    });
  }

  // 浠呭鈥滄縺娲荤殑 magnets鈥濊繘琛屽啿绐佹娴?鑷姩瑙ｅ喅锛?
  // - 鏈縺娲?magnets 涓嶅弬涓庡崰鐢紝涓嶉渶瑕佷负鍏惰€楁椂瑙ｆ瀽浣嶇疆
  // - 鍙湁鍦ㄧ‘瀹炴娴嬪埌鍐茬獊鏃舵墠杩愯 resolve锛堥伩鍏嶆瘡娆￠兘鍋氬叏閲忚В鏋愶級
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
