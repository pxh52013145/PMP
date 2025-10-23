import { invoke } from '@tauri-apps/api/tauri';

export type EditorWindowType =
  | 'control'
  | 'statistics'
  | 'library'
  | 'style'
  | 'help'
  | 'creator'
  | 'background'
  | 'custom-background';

export interface EditorWindowConfig {
  type: EditorWindowType;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 缓存窗口位置，避免重复计算
const windowPositionCache = new Map<
  EditorWindowType,
  { x: number; y: number; width: number; height: number; timestamp: number }
>();
const CACHE_DURATION = 5000; // 5 秒缓存

/**
 * 打开编辑器窗口
 */
export async function openEditorWindow(config: EditorWindowConfig): Promise<void> {
  try {
    await invoke('open_editor_window', {
      windowType: config.type,
      x: config.x,
      y: config.y,
      width: config.width,
      height: config.height,
    });
  } catch (error) {
    console.error(`Failed to open editor window (${config.type}):`, error);
    throw error;
  }
}

/**
 * 窗口层级关系定义
 * 当父窗口关闭时，其所有子窗口也应该关闭
 */
const WINDOW_HIERARCHY: Record<EditorWindowType, EditorWindowType[]> = {
  control: ['statistics', 'library', 'style', 'help', 'background'], // control 关闭时关闭所有主要窗口
  library: ['creator'], // library 关闭时关闭 creator
  background: ['custom-background'], // background 关闭时关闭 custom-background
  statistics: [],
  style: [],
  help: [],
  creator: [],
  'custom-background': [],
};

/**
 * 关闭编辑器窗口（包括其子窗口）
 */
export async function closeEditorWindow(type: EditorWindowType): Promise<void> {
  try {
    // 先关闭所有子窗口
    const childWindows = WINDOW_HIERARCHY[type] || [];
    for (const childType of childWindows) {
      await closeEditorWindow(childType); // 递归关闭子窗口及其子窗口
    }

    // 再关闭自己
    await invoke('close_editor_window', {
      windowType: type,
    });
    // 清除该窗口的位置缓存，下次打开时重新计算
    windowPositionCache.delete(type);
  } catch (error) {
    console.error(`Failed to close editor window (${type}):`, error);
    throw error;
  }
}

/**
 * 关闭所有编辑器窗口
 */
export async function closeAllEditorWindows(): Promise<void> {
  try {
    await invoke('close_all_editor_windows');
    // 清除所有窗口的位置缓存
    windowPositionCache.clear();
  } catch (error) {
    console.error('Failed to close all editor windows:', error);
    throw error;
  }
}

/**
 * 获取主窗口的位置和大小，用于计算子窗口位置
 */
export async function getMainWindowBounds(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}> {
  try {
    const { appWindow } = await import('@tauri-apps/api/window');
    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();
    const isMaximized = await appWindow.isMaximized();

    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      isMaximized,
    };
  } catch (error) {
    console.error('Failed to get main window bounds:', error);
    // 返回默认值
    return { x: 100, y: 100, width: 972, height: 720, isMaximized: false };
  }
}

/**
 * 计算编辑器窗口的默认位置（基于主窗口）
 * 所有窗口默认放在主窗口右下外边框处，从下往上堆叠
 */
export async function calculateWindowPosition(
  type: EditorWindowType
): Promise<{ x: number; y: number; width: number; height: number }> {
  // 检查缓存
  const cached = windowPositionCache.get(type);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return {
      x: cached.x,
      y: cached.y,
      width: cached.width,
      height: cached.height,
    };
  }

  const mainBounds = await getMainWindowBounds();

  // 默认窗口大小
  const windowSizes: Record<EditorWindowType, { width: number; height: number }> = {
    control: { width: 220, height: 450 }, // 可拖动控制面板 - 增加高度以适配新的拖动区域
    statistics: { width: 380, height: 500 },
    library: { width: 520, height: 680 },
    style: { width: 520, height: 720 },
    help: { width: 450, height: 650 },
    creator: { width: 900, height: 700 },
    background: { width: 480, height: 650 },
    'custom-background': { width: 600, height: 720 },
  };

  const size = windowSizes[type];

  // 获取屏幕尺寸
  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;

  // 主窗口右下角位置
  const mainRightX = mainBounds.x + mainBounds.width;
  const mainBottomY = mainBounds.y + mainBounds.height;

  let offsetX: number;
  let y: number;

  const GAP = 10; // 窗口之间的间距

  // 窗口垂直堆叠顺序（从下往上）
  const verticalOrder: Record<EditorWindowType, number> = {
    control: 0, // 最底部，紧贴主窗口底部
    statistics: 1,
    library: 2,
    style: 3,
    help: 4,
    creator: 5,
    background: 6,
    'custom-background': 7,
  };

  // 自定义背景窗口居中显示，其他窗口放在右下角
  if (type === 'custom-background') {
    // 居中显示，确保能被看到
    offsetX = Math.max(20, (screenWidth - size.width) / 2);
    y = Math.max(20, (screenHeight - size.height) / 2);
  } else {
    // 所有窗口放在主窗口右侧，紧贴主窗口右边框
    offsetX = mainRightX + GAP;

    // 从主窗口底部开始，向上堆叠窗口
    // control 窗口底部与主窗口底部对齐
    const order = verticalOrder[type];
    if (order === 0) {
      // control 窗口：底部对齐主窗口底部
      y = mainBottomY - size.height;
    } else {
      // 其他窗口：在 control 窗口上方依次堆叠
      // 需要计算之前所有窗口的总高度
      let accumulatedHeight = 0;
      const controlSize = windowSizes['control'];

      // control 窗口占据的高度
      accumulatedHeight = controlSize.height + GAP;

      // 根据顺序计算当前窗口应该堆叠的位置
      // 这里简化处理：每个窗口向上偏移固定距离
      const verticalOffset = order * 60; // 每个窗口向上偏移60px（部分重叠）

      y = mainBottomY - size.height - accumulatedHeight - verticalOffset;
    }

    // 确保窗口不会超出屏幕右侧
    if (offsetX + size.width > screenWidth) {
      // 如果右侧超出，放在主窗口左侧
      offsetX = Math.max(20, mainBounds.x - size.width - GAP);
    }

    // 确保窗口不会超出屏幕顶部
    if (y < 20) {
      y = 20;
    }
  }

  const position = {
    x: offsetX,
    y,
    ...size,
  };

  // 缓存结果
  windowPositionCache.set(type, {
    ...position,
    timestamp: Date.now(),
  });

  return position;
}

/**
 * 清除位置缓存（当主窗口移动时调用）
 */
export function clearPositionCache(): void {
  windowPositionCache.clear();
}
