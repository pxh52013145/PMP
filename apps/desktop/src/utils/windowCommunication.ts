/**
 * 窗口间通信工具
 * 统一管理主窗口和编辑器窗口之间的数据同步
 */

import { emit, listen, UnlistenFn } from '@tauri-apps/api/event';

/**
 * localStorage 数据 key 定义
 */
export const STORAGE_KEYS = {
  // === 配置数据（主要数据源） ===
  CONFIG: 'pixel-matrix-player-config', // 主配置文件（包含 magnet、grid、styleOverride）

  // === 运行时数据（辅助/缓存） ===
  MAGNET_LIBRARY: 'pixel-matrix-magnet-library', // Magnet 库（兼容旧版）
  ACTIVE_MAGNETS: 'pixel-matrix-active-magnets', // 激活的 Magnet ID
  BUILTIN_MAGNETS: 'pixel-matrix-builtin-magnets', // 内置 Magnet ID
  BACKGROUND_SETTINGS: 'pixel-matrix-background-settings', // 背景设置
  BACKGROUND_HISTORY: 'pixel-matrix-background-history', // 背景历史
  IS_MAXIMIZED: 'pixel-matrix-is-maximized', // 窗口最大化状态

  // === Pixel 渲染配置 ===
  PIXEL_SHAPE: 'pixel-matrix-pixel-shape', // Pixel 形状
  PIXEL_SIZE: 'pixel-matrix-pixel-size', // Pixel 尺寸
  PIXEL_OPACITY: 'pixel-matrix-pixel-opacity', // Pixel 透明度

  // === 窗口效果配置 ===
  BACKGROUND_EFFECT: 'pixel-matrix-background-effect', // 背景效果
  BORDER_EFFECT: 'pixel-matrix-border-effect', // 边框效果
  BACKGROUND_THEME_COLOR: 'pixel-matrix-background-theme-color', // 背景效果主题颜色
  BORDER_THEME_COLOR: 'pixel-matrix-border-theme-color', // 边框效果主题颜色

  // === 编辑器临时数据 ===
  MAGNET_EDITOR_DATA: 'magnet-editor-data', // 编辑中的 Magnet 数据
  MAGNET_EDITOR_MODE: 'magnet-editor-mode', // 编辑模式（create/edit）
  CREATOR_WINDOW_OPEN: 'magnet-creator-window-open', // Creator 窗口是否打开
} as const;

/**
 * Tauri 事件名称定义
 */
export const TAURI_EVENTS = {
  // Magnet 相关
  MAGNET_LIBRARY_UPDATED: 'magnet-library-updated',
  MAGNET_ACTIVATED: 'magnet-activated',
  MAGNET_DEACTIVATED: 'magnet-deactivated',

  // 背景相关
  BACKGROUND_UPDATED: 'background-updated',

  // Pixel 渲染相关
  PIXEL_SHAPE_UPDATED: 'pixel-shape-updated',
  PIXEL_SIZE_UPDATED: 'pixel-size-updated',
  PIXEL_OPACITY_UPDATED: 'pixel-opacity-updated',

  // 窗口效果相关
  BACKGROUND_EFFECT_UPDATED: 'background-effect-updated',
  BORDER_EFFECT_UPDATED: 'border-effect-updated',
  BACKGROUND_THEME_COLOR_UPDATED: 'background-theme-color-updated',
  BORDER_THEME_COLOR_UPDATED: 'border-theme-color-updated',

  // 编辑器相关
  EDITOR_EXIT: 'editor-exit',
  EDITOR_STYLE_APPLY: 'editor-style-apply',
  CREATOR_WINDOW_OPENED: 'creator-window-opened',
  CREATOR_WINDOW_CLOSED: 'creator-window-closed',
} as const;

/**
 * 发送数据更新（双重机制：localStorage + Tauri 事件）
 */
export async function broadcastDataUpdate<T>(
  storageKey: string,
  data: T,
  tauriEvent?: string
): Promise<void> {
  try {
    // 1. 更新 localStorage
    localStorage.setItem(storageKey, JSON.stringify(data));

    // 2. 发送 Tauri 事件（如果提供）
    if (tauriEvent) {
      await emit(tauriEvent, { timestamp: Date.now(), key: storageKey });
      console.log(`Broadcasted: ${storageKey} via ${tauriEvent}`);
    } else {
      console.log(`Saved to localStorage: ${storageKey}`);
    }
  } catch (error) {
    console.error(`Failed to broadcast data update (${storageKey}):`, error);
    throw error;
  }
}

/**
 * 发送信号（只触发事件，不存储数据）
 */
export async function broadcastSignal(tauriEvent: string): Promise<void> {
  try {
    await emit(tauriEvent, { timestamp: Date.now() });
    console.log(`Signal broadcasted: ${tauriEvent}`);
  } catch (error) {
    console.error(`Failed to broadcast signal (${tauriEvent}):`, error);
    throw error;
  }
}

/**
 * 从 localStorage 读取数据
 */
export function readData<T>(storageKey: string): T | null {
  try {
    const data = localStorage.getItem(storageKey);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Failed to read data (${storageKey}):`, error);
    return null;
  }
}

/**
 * 设置 localStorage 事件监听器
 */
export function setupStorageListener(
  keys: string[],
  callback: (key: string, newValue: any) => void
): () => void {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key && keys.includes(e.key) && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        callback(e.key, parsed);
      } catch (error) {
        console.error(`Failed to parse storage event (${e.key}):`, error);
      }
    }
  };

  window.addEventListener('storage', handleStorageChange);
  return () => window.removeEventListener('storage', handleStorageChange);
}

/**
 * 设置 Tauri 事件监听器
 */
export async function setupTauriListener(
  eventName: string,
  callback: () => void
): Promise<UnlistenFn> {
  try {
    const unlisten = await listen(eventName, () => {
      console.log(`Tauri event received: ${eventName}`);
      callback();
    });
    return unlisten;
  } catch (error) {
    console.error(`Failed to setup Tauri listener (${eventName}):`, error);
    throw error;
  }
}

/**
 * 设置双重监听器（localStorage + Tauri 事件）
 */
export async function setupDualListener(
  storageKeys: string[],
  tauriEvents: string[],
  callback: () => void
): Promise<() => void> {
  // 设置 localStorage 监听
  const unlistenStorage = setupStorageListener(storageKeys, () => {
    console.log('Storage event triggered, calling callback');
    callback();
  });

  // 设置 Tauri 事件监听
  const tauriUnlisteners: UnlistenFn[] = [];
  for (const eventName of tauriEvents) {
    try {
      const unlisten = await setupTauriListener(eventName, callback);
      tauriUnlisteners.push(unlisten);
    } catch (error) {
      console.error(`Failed to setup listener for ${eventName}:`, error);
    }
  }

  // 返回统一的清理函数
  return () => {
    unlistenStorage();
    tauriUnlisteners.forEach((unlisten) => unlisten());
  };
}

/**
 * 通用的配置重新加载函数类型
 */
export type ConfigReloadFn = () => void;

/**
 * 创建配置同步 Hook 的工具函数
 * 用于在主窗口和编辑器窗口中复用相同的同步逻辑
 */
export async function setupConfigSync(
  storageKeys: string[],
  tauriEvents: string[],
  reloadCallback: ConfigReloadFn
): Promise<() => void> {
  return setupDualListener(storageKeys, tauriEvents, reloadCallback);
}
