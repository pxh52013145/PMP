import { Magnet, PixelAnchor } from '../types/pixel';

/**
 * 配置文件格式
 */
export interface MagnetConfig {
  version: string; // 配置版本，用于兼容性检查
  gridSize: {
    columns: number;
    rows: number;
  };
  magnets: {
    [magnetId: string]: {
      anchors: PixelAnchor[]; // 位置信息
      isActive: boolean; // 是否激活（显示在点阵上）
      // 内置 Magnet 的样式覆盖（可选）
      styleOverride?: {
        style?: any;
        animation?: any;
        content?: any;
      };
    };
  };
  customMagnets: Magnet[]; // 自定义 Magnet 的完整定义
}

const CONFIG_VERSION = '1.0.0';
const CONFIG_KEY = 'pixel-matrix-player-config';

/**
 * 保存配置到 localStorage
 */
export function saveConfig(
  magnetLibrary: Magnet[],
  activeMagnetIds: Set<string>,
  gridSize: { columns: number; rows: number },
  defaultMagnetLibrary?: Magnet[] // 可选：默认 Magnet 库，用于对比检测修改
): void {
  try {
    const config: MagnetConfig = {
      version: CONFIG_VERSION,
      gridSize,
      magnets: {},
      customMagnets: [],
    };

    const builtInIds = new Set([
      'drag-handle',
      'btn-minimize',
      'btn-maximize',
      'btn-close',
      'btn-play-pause',
      'btn-previous',
      'btn-next',
      'btn-mode',
      'btn-volume',
      'progress-bar',
      'track-info',
      'btn-editor',
    ]);

    // 保存所有 Magnet 的位置和激活状态
    magnetLibrary.forEach((magnet) => {
      const isActive = activeMagnetIds.has(magnet.id);
      const magnetConfig: any = {
        anchors: magnet.anchors,
        isActive: isActive,
      };

      // 对于内置 Magnet，检查样式是否被修改
      if (builtInIds.has(magnet.id) && defaultMagnetLibrary) {
        const defaultMagnet = defaultMagnetLibrary.find((m) => m.id === magnet.id);

        if (defaultMagnet) {
          const styleOverride: any = {};
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
    config.customMagnets = magnetLibrary.filter((m) => !builtInIds.has(m.id));

    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    console.log('配置已保存:', config);
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
      console.log(`迁移 Magnet ID: ${magnet.id} → ${newId}`);
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
export function loadConfig(): MagnetConfig | null {
  try {
    const configStr = localStorage.getItem(CONFIG_KEY);
    if (!configStr) {
      console.log('未找到保存的配置');
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
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      console.log('配置已迁移到新版本');
    } else {
      // 即使版本相同，也检查是否有旧 ID 需要迁移
      const oldIds = ['btn-prev', 'song-info'];
      const hasOldIds = Object.keys(config.magnets).some((id) => oldIds.includes(id));

      if (hasOldIds) {
        console.log('检测到旧的 Magnet ID，正在迁移...');
        config = migrateMagnetIds(config);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        console.log('配置已迁移');
      }
    }

    console.log('配置已加载:', config);
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

  const builtInIds = new Set([
    'drag-handle',
    'btn-minimize',
    'btn-maximize',
    'btn-close',
    'btn-play-pause',
    'btn-previous',
    'btn-next',
    'btn-mode',
    'btn-volume',
    'progress-bar',
    'track-info',
    'btn-editor',
  ]);

  // 保存所有 Magnet 的位置和激活状态
  magnetLibrary.forEach((magnet) => {
    const magnetConfig: any = {
      anchors: magnet.anchors,
      isActive: activeMagnetIds.has(magnet.id),
    };

    // 对于内置 Magnet，检查样式是否被修改
    if (builtInIds.has(magnet.id) && defaultMagnetLibrary) {
      const defaultMagnet = defaultMagnetLibrary.find((m) => m.id === magnet.id);

      if (defaultMagnet) {
        const styleOverride: any = {};
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

  config.customMagnets = magnetLibrary.filter((m) => !builtInIds.has(m.id));

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
    localStorage.removeItem(CONFIG_KEY);
    console.log('配置已清除');
  } catch (error) {
    console.error('清除配置失败:', error);
  }
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
  const magnetLibrary: Magnet[] = [];
  const activeMagnetIds = new Set<string>();

  // 1. 首先处理内置 Magnet
  defaultMagnetLibrary.forEach((defaultMagnet) => {
    const savedConfig = config.magnets[defaultMagnet.id];

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

      magnetLibrary.push(appliedMagnet);

      // 恢复激活状态
      if (savedConfig.isActive) {
        activeMagnetIds.add(defaultMagnet.id);
      }
    } else {
      // 使用默认配置
      magnetLibrary.push(defaultMagnet);
      // 默认激活（除了某些特定 Magnet）
      activeMagnetIds.add(defaultMagnet.id);
    }
  });

  // 2. 添加自定义 Magnet
  if (config.customMagnets) {
    config.customMagnets.forEach((customMagnet) => {
      const savedConfig = config.magnets[customMagnet.id];

      if (savedConfig) {
        // 使用保存的锚点位置
        magnetLibrary.push({
          ...customMagnet,
          anchors: savedConfig.anchors,
        });

        // 恢复激活状态
        if (savedConfig.isActive) {
          activeMagnetIds.add(customMagnet.id);
        }
      } else {
        // 使用原始配置
        magnetLibrary.push(customMagnet);
      }
    });
  }

  return { magnetLibrary, activeMagnetIds };
}
