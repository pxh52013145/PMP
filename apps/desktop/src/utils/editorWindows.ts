import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from './tauriRuntime';

export type EditorWindowType =
  | 'control'
  | 'statistics'
  | 'library'
  | 'style'
  | 'style-pixel'
  | 'style-cover-color'
  | 'style-background-effect'
  | 'style-border-effect'
  | 'creator'
  | 'background'
  | 'custom-background'
  | 'theme'
  | 'debug';

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
  if (!isTauriRuntime()) {
    throw new Error('Editor windows require the Tauri runtime (use `pnpm dev:tauri`).');
  }
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
  control: ['statistics', 'library', 'style', 'background', 'theme', 'debug'], // control 关闭时关闭所有主要窗口
  library: ['creator'], // library 关闭时关闭 creator
  background: ['custom-background'], // background 关闭时关闭 custom-background
  statistics: [],
  style: ['style-pixel', 'style-cover-color', 'style-background-effect', 'style-border-effect'],
  'style-pixel': [],
  'style-cover-color': [],
  'style-background-effect': [],
  'style-border-effect': [],
  creator: [],
  'custom-background': [],
  theme: ['debug'],
  debug: [],
};

/**
 * 关闭编辑器窗口（包括其子窗口）
 */
export async function closeEditorWindow(type: EditorWindowType): Promise<void> {
  try {
    // 先关闭所有子窗口
    if (!isTauriRuntime()) return;

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
    if (!isTauriRuntime()) return;
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
type PositionLike = { x: number; y: number };
type SizeLike = { width: number; height: number };

function toLogicalPosition(position: PositionLike, scaleFactor: number): PositionLike {
  const record = position as unknown as { toLogical?: (scaleFactor: number) => PositionLike };
  return typeof record.toLogical === 'function'
    ? record.toLogical(scaleFactor)
    : { x: position.x / scaleFactor, y: position.y / scaleFactor };
}

function toLogicalSize(size: SizeLike, scaleFactor: number): SizeLike {
  const record = size as unknown as { toLogical?: (scaleFactor: number) => SizeLike };
  return typeof record.toLogical === 'function'
    ? record.toLogical(scaleFactor)
    : { width: size.width / scaleFactor, height: size.height / scaleFactor };
}

export async function getMainWindowBounds(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  scaleFactor: number;
}> {
  try {
    const { appWindow } = await import('@tauri-apps/api/window');
    const scaleFactor = await appWindow.scaleFactor();
    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();
    const isMaximized = await appWindow.isMaximized();

    const logicalPosition = toLogicalPosition(position, scaleFactor);
    const logicalSize = toLogicalSize(size, scaleFactor);

    return {
      x: logicalPosition.x,
      y: logicalPosition.y,
      width: logicalSize.width,
      height: logicalSize.height,
      isMaximized,
      scaleFactor,
    };
  } catch (error) {
    console.error('Failed to get main window bounds:', error);
    // Best-effort fallback for web/dev mode.
    return {
      x: 100,
      y: 100,
      width: 972,
      height: 720,
      isMaximized: false,
      scaleFactor: window.devicePixelRatio || 1,
    };
  }
}

type WindowRect = { x: number; y: number; width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  if (!isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function rectsOverlap(a: WindowRect, b: WindowRect, padding = 12): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

async function getVisibleEditorWindowRects(
  excludeType: EditorWindowType,
  scaleFactor: number
): Promise<WindowRect[]> {
  if (!isTauriRuntime()) return [];

  try {
    const { getAll } = await import('@tauri-apps/api/window');
    const excludeLabel = `editor-${excludeType}`;
    const windows = getAll().filter(
      (win) => win.label.startsWith('editor-') && win.label !== excludeLabel
    );

    const rects = await Promise.all(
      windows.map(async (win) => {
        const visible = await win.isVisible().catch(() => false);
        if (!visible) return null;

        const [pos, size] = await Promise.all([
          win.outerPosition().catch(() => null),
          win.outerSize().catch(() => null),
        ]);
        if (!pos || !size) return null;

        const logicalPos = toLogicalPosition(pos, scaleFactor);
        const logicalSize = toLogicalSize(size, scaleFactor);

        return {
          x: logicalPos.x,
          y: logicalPos.y,
          width: logicalSize.width,
          height: logicalSize.height,
        } satisfies WindowRect;
      })
    );

    return rects.filter(Boolean) as WindowRect[];
  } catch {
    return [];
  }
}

async function resolveNonOverlappingPosition(
  type: EditorWindowType,
  base: WindowRect,
  screenWidth: number,
  screenHeight: number,
  scaleFactor: number
): Promise<WindowRect> {
  const occupied = await getVisibleEditorWindowRects(type, scaleFactor);

  const margin = 20;
  const bounds = {
    minX: margin,
    minY: margin,
    maxX: Math.max(margin, screenWidth - base.width - margin),
    maxY: Math.max(margin, screenHeight - base.height - margin),
  };

  const normalizedBase: WindowRect = {
    ...base,
    x: clamp(base.x, bounds.minX, bounds.maxX),
    y: clamp(base.y, bounds.minY, bounds.maxY),
  };

  const overlaps = (candidate: WindowRect) =>
    occupied.some((rect) => rectsOverlap(candidate, rect));

  if (!overlaps(normalizedBase)) return normalizedBase;

  const step = 36;
  const maxRadius = 18;

  for (let radius = 1; radius <= maxRadius; radius++) {
    const d = radius * step;
    const offsets = [
      { dx: 0, dy: d },
      { dx: 0, dy: -d },
      { dx: d, dy: 0 },
      { dx: -d, dy: 0 },
      { dx: d, dy: d },
      { dx: -d, dy: d },
      { dx: d, dy: -d },
      { dx: -d, dy: -d },
    ];

    for (const { dx, dy } of offsets) {
      const candidate: WindowRect = {
        ...normalizedBase,
        x: clamp(normalizedBase.x + dx, bounds.minX, bounds.maxX),
        y: clamp(normalizedBase.y + dy, bounds.minY, bounds.maxY),
      };
      if (!overlaps(candidate)) return candidate;
    }
  }

  return normalizedBase;
}

/**
 * 计算编辑器窗口的默认位置（基于主窗口）
 * 所有窗口默认放在主窗口右下外边框处，从下往上堆叠
 */
export async function calculateWindowPosition(
  type: EditorWindowType
): Promise<{ x: number; y: number; width: number; height: number }> {
  const cached = windowPositionCache.get(type);
  const mainBounds = await getMainWindowBounds();

  // Style window is a docked edit bar under the main window (not a floating panel).
  if (type === 'style') {
    const barHeight = 96;
    const gap = 8;
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;

    const width = mainBounds.width;
    const x = clamp(mainBounds.x, 0, Math.max(0, screenWidth - width));

    let y = mainBounds.y + mainBounds.height + gap;
    if (y + barHeight > screenHeight) {
      y = Math.max(0, mainBounds.y - barHeight - gap);
    }

    return { x, y, width, height: barHeight };
  }

  // 默认窗口大小
  const windowSizes: Record<EditorWindowType, { width: number; height: number }> = {
    control: { width: 220, height: 470 }, // 可拖动控制面板 - 撤回/恢复置顶后缩回高度
    statistics: { width: 380, height: 500 },
    library: { width: 520, height: 680 },
    style: { width: 520, height: 720 },
    'style-pixel': { width: 560, height: 520 },
    'style-cover-color': { width: 560, height: 520 },
    'style-background-effect': { width: 560, height: 560 },
    'style-border-effect': { width: 560, height: 560 },
    creator: { width: 900, height: 700 },
    background: { width: 480, height: 650 },
    'custom-background': { width: 600, height: 720 },
    theme: { width: 1200, height: 800 },
    debug: { width: 1200, height: 800 }, // 调试窗口 - 大窗口
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
    'style-pixel': 3,
    'style-cover-color': 3,
    'style-background-effect': 3,
    'style-border-effect': 3,
    creator: 5,
    background: 6,
    'custom-background': 7,
    theme: 8,
    debug: 9, // 调试窗口
  };

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    offsetX = cached.x;
    y = cached.y;
  } else if (type === 'custom-background' || type === 'theme' || type === 'debug') {
    offsetX = (screenWidth - size.width) / 2;
    y = (screenHeight - size.height) / 2;
  } else if (
    type === 'style-pixel' ||
    type === 'style-cover-color' ||
    type === 'style-background-effect' ||
    type === 'style-border-effect'
  ) {
    // Style popups should NOT cover the main window; place them beside the main window by default.
    offsetX = mainRightX + GAP;
    y = mainBottomY - size.height - (96 + 8); // above the docked style bar (best-effort)

    if (offsetX + size.width > screenWidth) {
      offsetX = mainBounds.x - size.width - GAP;
    }

    if (y < 10) y = 10;
  } else {
    offsetX = mainRightX + GAP;

    const order = verticalOrder[type];
    if (order === 0) {
      y = mainBottomY - size.height;
    } else {
      const controlSize = windowSizes['control'];
      const accumulatedHeight = controlSize.height + GAP;
      const verticalOffset = order * 60;
      y = mainBottomY - size.height - accumulatedHeight - verticalOffset;
    }

    if (offsetX + size.width > screenWidth) {
      offsetX = mainBounds.x - size.width - GAP;
    }
  }

  const resolved = await resolveNonOverlappingPosition(
    type,
    { x: offsetX, y, ...size },
    screenWidth,
    screenHeight,
    mainBounds.scaleFactor
  );

  const position = { x: resolved.x, y: resolved.y, ...size };

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
