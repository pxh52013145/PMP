/**
 * Magnet 相关常量
 * 统一管理内置 Magnet ID，避免在多处重复定义
 */

/**
 * 所有内置 Magnet 的 ID 列表
 * ⚠️ 添加新的内置 Magnet 时，只需在这里添加 ID 即可
 */
export const BUILTIN_MAGNET_ID_LIST = [
  'drag-handle',
  'btn-minimize',
  'btn-maximize',
  'btn-close',
  'btn-window-pin',
  'btn-play-pause',
  'btn-previous',
  'btn-next',
  'btn-mode',
  'btn-volume',
  'progress-bar',
  'track-info',
  'btn-editor',
  'btn-play-queue',
  'btn-playlists',
  'btn-music-library',
  'navigation-page',
  'btn-back',
  'btn-debug', // 调试按钮
] as const;

/**
 * 内置 Magnet ID 集合（用于快速查找）
 */
export const BUILTIN_MAGNET_IDS = new Set<string>(BUILTIN_MAGNET_ID_LIST);

/**
 * 检查给定 ID 是否为内置 Magnet
 */
export function isBuiltInMagnet(magnetId: string): boolean {
  return BUILTIN_MAGNET_IDS.has(magnetId);
}

/**
 * 默认激活的 Magnet ID 列表
 * 这些 Magnet 在首次加载时会被激活
 */
export const DEFAULT_ACTIVE_MAGNET_IDS = new Set<string>([
  'drag-handle',
  'btn-minimize',
  'btn-maximize',
  'btn-close',
  'btn-window-pin',
  'btn-editor',
  'btn-debug', // 调试按钮
  // 导航页面
  'navigation-page',
  'btn-back',
  // 独立播放控制按钮
  'btn-play-pause',
  'btn-previous',
  'btn-next',
  'btn-mode',
  'btn-volume',
  'progress-bar',
  'track-info',
  // 音乐功能按钮
  'btn-play-queue',
  'btn-playlists',
  'btn-music-library',
]);
