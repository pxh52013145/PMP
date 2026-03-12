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

function createLayoutStateConfig(magnet: Magnet): Pick<
  MagnetStateConfig,
  'boundsMode' | 'boundsDock' | 'boundsInset' | 'chromeEnabled' | 'chromeInset'
> {
  return {
    boundsMode: magnet.boundsMode,
    boundsDock: magnet.boundsDock,
    boundsInset: magnet.boundsInset,
    chromeEnabled: magnet.chrome?.enabled,
    chromeInset: magnet.chrome?.inset,
  };
}

function applySavedLayoutState<TMagnet extends Magnet>(
  magnet: TMagnet,
  savedConfig: Pick<
    MagnetStateConfig,
    'boundsMode' | 'boundsDock' | 'boundsInset' | 'chromeEnabled' | 'chromeInset'
  >
): TMagnet {
  const nextMagnet = {
    ...magnet,
    boundsMode: savedConfig.boundsMode ?? magnet.boundsMode,
    boundsDock: savedConfig.boundsDock ?? magnet.boundsDock,
    boundsInset: savedConfig.boundsInset ?? magnet.boundsInset,
  };

  if (typeof savedConfig.chromeEnabled === 'boolean' || savedConfig.chromeInset !== undefined) {
    nextMagnet.chrome = {
      ...(magnet.chrome ?? {}),
      ...(typeof savedConfig.chromeEnabled === 'boolean'
        ? { enabled: savedConfig.chromeEnabled }
        : {}),
      ...(savedConfig.chromeInset !== undefined ? { inset: savedConfig.chromeInset } : {}),
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
      const magnetConfig: MagnetStateConfig = {
        anchors: magnet.anchors,
        isActive,
        renderer: magnet.renderer,
        variant: magnet.variant,
        variantConfig: magnet.variantConfig,
        previewText: magnet.previewText,
        ...createLayoutStateConfig(magnet),
      };

      // 对于内置 Magnet，检查样式是否被修改
      if (BUILTIN_MAGNET_IDS.has(magnet.id) && defaultMagnetLibrary) {
        const defaultMagnet = defaultMagnetLibrary.find((m) => m.id === magnet.id);

        if (defaultMagnet) {
          const styleOverride: NonNullable<MagnetStateConfig['styleOverride']> = {};
          let hasOverride = false;

          // 检查 style 是否修改
          if (JSON.stringify(magnet.style) !== JSON.stringify(defaultMagnet.style)) {
            styleOverride.style = magnet.style;
            hasOverride = true;
          }

          // 检查 animation 是否修改
          if (JSON.stringify(magnet.animation) !== JSON.stringify(defaultMagnet.animation)) {
            styleOverride.animation = magnet.animation;
            hasOverride = true;
          }

          // 检查 content 是否修改
          if (JSON.stringify(magnet.content) !== JSON.stringify(defaultMagnet.content)) {
            styleOverride.content = magnet.content;
            hasOverride = true;
          }

          // 如果有修改，保存样式覆盖
          if (hasOverride) {
            magnetConfig.styleOverride = styleOverride;
          }
        }
      }

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

    // 检查版本兼容性
    if (config.version !== CONFIG_VERSION) {
      console.warn(`配置版本不匹配: ${config.version} !== ${CONFIG_VERSION}`);
      // 尝试迁移配置
      config = migrateMagnetIds(config);
      config.version = CONFIG_VERSION;

      // 保存迁移后的配置
      writeString(storageKey, JSON.stringify(config));
    } else {
      // 即使版本相同，也检查是否有旧 ID 需要迁移
      const oldIds = ['btn-prev', 'song-info'];
      const hasOldIds = Object.keys(config.magnets).some((id) => oldIds.includes(id));

        if (hasOldIds) {
          config = migrateMagnetIds(config);
          writeString(storageKey, JSON.stringify(config));
        }
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
    const magnetConfig: MagnetStateConfig = {
      anchors: magnet.anchors,
      isActive: activeMagnetIds.has(magnet.id),
      renderer: magnet.renderer,
      variant: magnet.variant,
      variantConfig: magnet.variantConfig,
      previewText: magnet.previewText,
      ...createLayoutStateConfig(magnet),
    };

    // 对于内置 Magnet，检查样式是否被修改
    if (BUILTIN_MAGNET_IDS.has(magnet.id) && defaultMagnetLibrary) {
      const defaultMagnet = defaultMagnetLibrary.find((m) => m.id === magnet.id);

      if (defaultMagnet) {
        const styleOverride: NonNullable<MagnetStateConfig['styleOverride']> = {};
        let hasOverride = false;

        if (JSON.stringify(magnet.style) !== JSON.stringify(defaultMagnet.style)) {
          styleOverride.style = magnet.style;
          hasOverride = true;
        }

        if (JSON.stringify(magnet.animation) !== JSON.stringify(defaultMagnet.animation)) {
          styleOverride.animation = magnet.animation;
          hasOverride = true;
        }

        if (JSON.stringify(magnet.content) !== JSON.stringify(defaultMagnet.content)) {
          styleOverride.content = magnet.content;
          hasOverride = true;
        }

        if (hasOverride) {
          magnetConfig.styleOverride = styleOverride;
        }
      }
    }

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
    const config: MagnetConfig = JSON.parse(jsonStr);

    // 验证必要字段
    if (!config.version || !config.gridSize || !config.magnets) {
      throw new Error('配置格式不正确');
    }

    // 检查版本兼容性
    if (config.version !== CONFIG_VERSION) {
      console.warn(`配置版本不匹配: ${config.version} !== ${CONFIG_VERSION}`);
      // 可以选择性地接受或拒绝
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
      const appliedMagnet: Magnet = {
        ...defaultMagnet,
        anchors: savedConfig.anchors,
      };

      // 应用样式覆盖（如果有）
      if (savedConfig.styleOverride) {
        if (savedConfig.styleOverride.style !== undefined) {
          appliedMagnet.style = savedConfig.styleOverride.style;
        }
        if (savedConfig.styleOverride.animation !== undefined) {
          appliedMagnet.animation = savedConfig.styleOverride.animation;
        }
        if (savedConfig.styleOverride.content !== undefined) {
          appliedMagnet.content = savedConfig.styleOverride.content;
        }
      }

      // 保持 interactions 使用默认定义（功能不可修改）
      appliedMagnet.interactions = defaultMagnet.interactions;
      appliedMagnet.renderer = savedConfig.renderer ?? appliedMagnet.renderer;
      appliedMagnet.variant = savedConfig.variant ?? appliedMagnet.variant;
      appliedMagnet.variantConfig = savedConfig.variantConfig ?? appliedMagnet.variantConfig;
      appliedMagnet.previewText = savedConfig.previewText ?? appliedMagnet.previewText;
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
        // 使用保存的锚点位置
        const nextMagnet: Magnet = {
          ...customMagnet,
          anchors: savedConfig.anchors,
          renderer: savedConfig.renderer ?? customMagnet.renderer,
          variant: savedConfig.variant ?? customMagnet.variant,
          variantConfig: savedConfig.variantConfig ?? customMagnet.variantConfig,
          previewText: savedConfig.previewText ?? customMagnet.previewText,
        };

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
