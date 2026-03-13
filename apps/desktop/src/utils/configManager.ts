import { Magnet, PixelAnchor } from '../types/pixel';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from '../constants/magnets';
import { resolveMagnetPositions, detectConflicts } from './magnetPositionResolver';
import { readString, removeKey, writeString } from '../modules/storage';

/**
 * 配置文件格式
 */
export interface MagnetStateConfig {
  anchors: PixelAnchor[];
  isActive: boolean;
  renderer?: string;
  variant?: string;
  variantConfig?: Record<string, unknown>;
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
  version: string; // 配置版本，用于兼容性检查
  gridSize: {
    columns: number;
    rows: number;
  };
  magnets: Record<string, MagnetStateConfig>;
  customMagnets: Magnet[]; // 自定义 Magnet 的完整定义
}

const CONFIG_VERSION = '1.2.0';
const CONFIG_KEY = 'pixel-matrix-player-config';
const PROCESS_PERF_MONITOR_MAGNET_ID = 'process-perf-monitor';
const LEGACY_PROCESS_PERF_MONITOR_TOP_INSET = 8;
const PROCESS_PERF_MONITOR_TOP_OUTSET = 9;

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
  'renderer' | 'variant' | 'variantConfig' | 'previewText' | 'styleOverride'
>;

function hasValue<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function omitInsetSide(
  inset: Magnet['boundsInset'] | undefined,
  side: keyof NonNullable<Magnet['boundsInset']>
): Magnet['boundsInset'] | undefined {
  if (!inset) return undefined;
  const nextInset = { ...inset };
  delete nextInset[side];
  return Object.keys(nextInset).length > 0 ? nextInset : undefined;
}

function normalizeSavedLayoutState(magnetId: string, savedConfig: SavedLayoutStateConfig): SavedLayoutStateConfig {
  const shouldMigrateLegacyPerfTopInset =
    magnetId === PROCESS_PERF_MONITOR_MAGNET_ID &&
    savedConfig.boundsOutset?.top === undefined &&
    savedConfig.boundsInset?.top === LEGACY_PROCESS_PERF_MONITOR_TOP_INSET;

  if (!shouldMigrateLegacyPerfTopInset) return savedConfig;

  return {
    ...savedConfig,
    boundsInset: omitInsetSide(savedConfig.boundsInset, 'top'),
    boundsOutset: {
      ...(savedConfig.boundsOutset ?? {}),
      top: PROCESS_PERF_MONITOR_TOP_OUTSET,
    },
  };
}

function normalizeConfigMigrations(config: MagnetConfig): { config: MagnetConfig; changed: boolean } {
  let changed = false;
  let nextConfig = config;

  const oldIds = ['btn-prev', 'song-info'];
  const hasOldIds = Object.keys(nextConfig.magnets).some((id) => oldIds.includes(id));
  if (hasOldIds) {
    nextConfig = migrateMagnetIds(nextConfig);
    changed = true;
  }

  const legacyLayoutMigration = migrateLegacyBuiltinLayoutConfig(nextConfig);
  if (legacyLayoutMigration.changed) {
    nextConfig = legacyLayoutMigration.config;
    changed = true;
  }

  return { config: nextConfig, changed };
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
    variantConfig: magnet.variantConfig,
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
    variantConfig: savedConfig.variantConfig ?? magnet.variantConfig,
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

function migrateLegacyBuiltinLayoutConfig(config: MagnetConfig): { config: MagnetConfig; changed: boolean } {
  let changed = false;
  const nextMagnets: MagnetConfig['magnets'] = {};

  for (const [magnetId, state] of Object.entries(config.magnets)) {
    const normalized = normalizeSavedLayoutState(magnetId, state);
    const didChange =
      normalized.boundsInset !== state.boundsInset ||
      normalized.boundsOutset !== state.boundsOutset ||
      normalized.boundsMode !== state.boundsMode ||
      normalized.boundsDock !== state.boundsDock ||
      normalized.chromeEnabled !== state.chromeEnabled ||
      normalized.chromeInset !== state.chromeInset;

    nextMagnets[magnetId] = didChange ? { ...state, ...normalized } : state;
    if (didChange) changed = true;
  }

  return changed ? { config: { ...config, magnets: nextMagnets }, changed: true } : { config, changed: false };
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
  const normalizedSavedConfig = normalizeSavedLayoutState(magnet.id, savedConfig);
  const nextMagnet = {
    ...magnet,
    boundsMode: normalizedSavedConfig.boundsMode ?? magnet.boundsMode,
    boundsDock: normalizedSavedConfig.boundsDock ?? magnet.boundsDock,
    boundsInset: normalizedSavedConfig.boundsInset ?? magnet.boundsInset,
    boundsOutset: normalizedSavedConfig.boundsOutset ?? magnet.boundsOutset,
    boundsAlign: normalizedSavedConfig.boundsAlign ?? magnet.boundsAlign,
  };

  if (
    typeof normalizedSavedConfig.chromeEnabled === 'boolean' ||
    normalizedSavedConfig.chromeInset !== undefined
  ) {
    nextMagnet.chrome = {
      ...(magnet.chrome ?? {}),
      ...(typeof normalizedSavedConfig.chromeEnabled === 'boolean'
        ? { enabled: normalizedSavedConfig.chromeEnabled }
        : {}),
      ...(normalizedSavedConfig.chromeInset !== undefined
        ? { inset: normalizedSavedConfig.chromeInset }
        : {}),
    };
  }

  return nextMagnet;
}

/**
 * 保存配置到 localStorage
 */
export function saveConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[], // 可选：默认 Magnet 库，用于对比检测修改
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

    // 保存所有 Magnet 的位置和激活状态
    magnetLibrary.forEach((magnet) => {
      const isActive = activeMagnetIds.has(magnet.id);
      const defaultMagnet = BUILTIN_MAGNET_IDS.has(magnet.id)
        ? defaultMagnetLibrary?.find((candidate) => candidate.id === magnet.id)
        : undefined;
      const magnetConfig = createMagnetStateConfig(magnet, isActive, defaultMagnet);

      config.magnets[magnet.id] = magnetConfig;
    });

    // 保存自定义 Magnet 的完整定义
    config.customMagnets = includeCustomMagnets
      ? magnetLibrary.filter((m) => !BUILTIN_MAGNET_IDS.has(m.id))
      : [];

    writeString(storageKey, JSON.stringify(config));
  } catch (error) {
    console.error('保存配置失败:', error);
  }
}

/**
 * 迁移旧的 Magnet ID 到新 ID
 */
function migrateMagnetIds(config: MagnetConfig): MagnetConfig {
  const idMigrationMap: Record<string, string> = {
    'btn-prev': 'btn-previous',
    'song-info': 'track-info',
  };

  // 迁移 magnets 对象中的 key
  const migratedMagnets: MagnetConfig['magnets'] = {};
  Object.entries(config.magnets).forEach(([id, data]) => {
    const newId = idMigrationMap[id] || id;
    migratedMagnets[newId] = data;
  });

  // 迁移 customMagnets 中的 id
  const migratedCustomMagnets = config.customMagnets.map((magnet) => {
    const newId = idMigrationMap[magnet.id] || magnet.id;
    if (newId !== magnet.id) {
      return { ...magnet, id: newId };
    }
    return magnet;
  });

  return {
    ...config,
    magnets: migratedMagnets,
    customMagnets: migratedCustomMagnets,
  };
}

/**
 * 从 localStorage 加载配置
 */
export function loadConfig(storageKey: string = CONFIG_KEY): MagnetConfig | null {
  try {
    const configStr = readString(storageKey);
    if (!configStr) {
      return null;
    }

    let config: MagnetConfig = JSON.parse(configStr);
    let shouldPersist = false;

    // ???????
    if (config.version !== CONFIG_VERSION) {
      console.warn(`???????: ${config.version} !== ${CONFIG_VERSION}`);
      config.version = CONFIG_VERSION;
      shouldPersist = true;
    }

    const migrationResult = normalizeConfigMigrations(config);
    if (migrationResult.changed) {
      config = migrationResult.config;
      shouldPersist = true;
    }

    if (shouldPersist) {
      writeString(storageKey, JSON.stringify(config));
    }

    return config;
  } catch (error) {
    console.error('加载配置失败:', error);
    return null;
  }
}

/**
 * 导出配置到 JSON 文件
 */
export function exportConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[]
): string {
  // 复用 saveConfig 的逻辑
  const config: MagnetConfig = {
    version: CONFIG_VERSION,
    gridSize,
    magnets: {},
    customMagnets: [],
  };

  // 保存所有 Magnet 的位置和激活状态
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

  config.customMagnets = magnetLibrary.filter((m) => !BUILTIN_MAGNET_IDS.has(m.id));

  return JSON.stringify(config, null, 2);
}

/**
 * 导入配置从 JSON 字符串
 */
export function importConfig(jsonStr: string): MagnetConfig | null {
  try {
    let config: MagnetConfig = JSON.parse(jsonStr);

    // 验证必要字段
    if (!config.version || !config.gridSize || !config.magnets) {
      throw new Error('配置格式不正确');
    }

    // 检查版本兼容性
    if (config.version !== CONFIG_VERSION) {
      console.warn(`配置版本不匹配: ${config.version} !== ${CONFIG_VERSION}`);
      config.version = CONFIG_VERSION;
    }

    const migrationResult = normalizeConfigMigrations(config);
    if (migrationResult.changed) {
      config = migrationResult.config;
    }

    return config;
  } catch (error) {
    console.error('导入配置失败:', error);
    return null;
  }
}

/**
 * 清除保存的配置
 */
export function clearConfig(): void {
  try {
    removeKey(CONFIG_KEY);
  } catch (error) {
    console.error('清除配置失败:', error);
  }
}

/**
 * 去重 Magnet 数组（按 ID）
 */
function deduplicateMagnets(magnets: Magnet[]): Magnet[] {
  const seen = new Set<string>();
  const result: Magnet[] = [];

  for (const magnet of magnets) {
    if (!seen.has(magnet.id)) {
      seen.add(magnet.id);
      result.push(magnet);
    } else {
      console.warn(`警告：发现重复的 Magnet ID: ${magnet.id}，已跳过`);
    }
  }

  return result;
}

/**
 * 验证 Magnet 配置
 */
function validateMagnet(magnet: Magnet): boolean {
  if (!magnet.id || typeof magnet.id !== 'string') {
    console.error('无效的 Magnet：缺少 id', magnet);
    return false;
  }

  if (!magnet.anchors || !Array.isArray(magnet.anchors) || magnet.anchors.length === 0) {
    console.error(`无效的 Magnet ${magnet.id}：缺少有效的 anchors`, magnet);
    return false;
  }

  return true;
}

/**
 * 清理配置中的重复和无效数据
 */
function sanitizeConfig(config: MagnetConfig): MagnetConfig {
  const sanitized = { ...config };

  // 清理 customMagnets 中的内置 magnet
  if (sanitized.customMagnets) {
    sanitized.customMagnets = sanitized.customMagnets.filter((m) => {
      if (BUILTIN_MAGNET_IDS.has(m.id)) {
        console.warn(`清理：从 customMagnets 中移除内置 magnet: ${m.id}`);
        return false;
      }
      return validateMagnet(m);
    });

    // 去重
    sanitized.customMagnets = deduplicateMagnets(sanitized.customMagnets);
  }

  return sanitized;
}

/**
 * 合并配置到现有库（用于应用加载的配置）
 */
export function applyConfig(
  config: MagnetConfig,
  defaultMagnetLibrary: Magnet[]
): {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
} {
  // 清理配置
  const cleanConfig = sanitizeConfig(config);

  const magnetLibrary: Magnet[] = [];
  const activeMagnetIds = new Set<string>();

  // 用于去重的集合
  const addedIds = new Set<string>();

  // 1. 首先处理内置 Magnet
  defaultMagnetLibrary.forEach((defaultMagnet) => {
    if (addedIds.has(defaultMagnet.id)) {
      console.warn(`跳过重复的内置 magnet: ${defaultMagnet.id}`);
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

      // 恢复激活状态
      if (savedConfig.isActive) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    } else {
      // 使用默认配置
      magnetLibrary.push(defaultMagnet);
      addedIds.add(defaultMagnet.id);
      // 默认激活（仅对“默认激活集合”中的内置 Magnet）
      if (DEFAULT_ACTIVE_MAGNET_IDS.has(defaultMagnet.id)) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    }
  });

  // 2. 添加自定义 Magnet（排除内置 magnet 和已添加的）
  if (cleanConfig.customMagnets) {
    cleanConfig.customMagnets.forEach((customMagnet) => {
      // 跳过已添加的和内置的
      if (addedIds.has(customMagnet.id) || BUILTIN_MAGNET_IDS.has(customMagnet.id)) {
        console.warn(`跳过重复或内置的自定义 magnet: ${customMagnet.id}`);
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

        // 恢复激活状态
        if (savedConfig.isActive) {
          activeMagnetIds.add(customMagnet.id);
        }
      } else {
        // 使用原始配置
        magnetLibrary.push(customMagnet);
        addedIds.add(customMagnet.id);
      }
    });
  }

  // 仅对“激活的 magnets”进行冲突检测/自动解决：
  // - 未激活 magnets 不参与占用，不需要为其耗时解析位置
  // - 只有在确实检测到冲突时才运行 resolve（避免每次都做全量解析）
  const activeMagnets = magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
  const conflicts = detectConflicts(activeMagnets);
  if (conflicts.length === 0) {
    return { magnetLibrary, activeMagnetIds };
  }

  console.warn(`⚠️ 检测到 ${conflicts.length} 个激活 Magnet 位置冲突，正在自动解决...`);
  conflicts.forEach((conflict) => {
    console.warn(
      `   - "${conflict.magnet1}" 与 "${conflict.magnet2}" 在 ${conflict.conflictPixels.length} 个像素位置冲突`
    );
  });

  const resolvedActive = resolveMagnetPositions(activeMagnets);
  const resolvedById = new Map(resolvedActive.map((m) => [m.id, m]));
  const resolvedMagnetLibrary = magnetLibrary.map((m) => resolvedById.get(m.id) ?? m);

  return { magnetLibrary: resolvedMagnetLibrary, activeMagnetIds };
}
