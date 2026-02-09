import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Magnet } from '../../types/pixel';
import { MATRIX_CONFIG } from '../../constants/config';
import { getMagnetRenderer } from '../../magnet-system/registry';
import type { MagnetChromeOverrideMode } from '../../modules/magnets';
import './Magnet.css';

interface MagnetProps {
  magnet: Magnet;
  pixelPositions: Map<string, { x: number; y: number }>;
  onInteract?: (magnetId: string, event: string) => void;
  chromeOverrideMode?: MagnetChromeOverrideMode;
}

/**
 * Magnet 组件
 * 通过锚点吸附到 Pixel 上，实现响应式定位
 */
export function MagnetComponent({ magnet, pixelPositions, onInteract, chromeOverrideMode }: MagnetProps) {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const [isHovering, setIsHovering] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const { PIXEL_SIZE } = MATRIX_CONFIG;

  // ✅ 优化：检测大幅度位置变化，禁用 transition 以避免卡顿
  const [disableTransition, setDisableTransition] = useState(true); // ✅ 首次渲染禁用动画
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const isFirstRenderRef = useRef(true);

  // 根据锚点计算实际位置和尺寸
  const bounds = useMemo(() => {
    const { anchorType, style } = magnet;
    const anchors = Array.isArray(magnet.anchors) ? magnet.anchors : [];

    switch (anchorType) {
      case 'single': {
        if (anchors.length < 1) return null;
        // 单锚点：固定尺寸，位置由锚点决定
        // 重要：Magnet 的中心对齐到 Pixel 的中心
        const pos = pixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
        if (!pos) return null;

        const magnetWidth = parseFloat(style.width || '36px');
        const magnetHeight = parseFloat(style.height || '36px');

        // 计算偏移量，使 Magnet 中心对齐 Pixel 中心
        const offsetX = (PIXEL_SIZE - magnetWidth) / 2;
        const offsetY = (PIXEL_SIZE - magnetHeight) / 2;

        return {
          x: pos.x + offsetX,
          y: pos.y + offsetY,
          width: magnetWidth,
          height: magnetHeight,
        };
      }

      case 'horizontal': {
        if (anchors.length < 2) return null;
        // 水平锚点：宽度自适应，高度固定
        // y 方向也需要垂直居中对齐 Pixel
        const leftAnchor = anchors[0].gridX <= anchors[1].gridX ? anchors[0] : anchors[1];
        const rightAnchor = leftAnchor === anchors[0] ? anchors[1] : anchors[0];
        const left = pixelPositions.get(`${leftAnchor.gridX},${leftAnchor.gridY}`);
        const right = pixelPositions.get(`${rightAnchor.gridX},${rightAnchor.gridY}`);
        if (!left || !right) return null;

        const magnetHeight = parseFloat(style.height || '36px');

        // 计算 y 方向偏移量，使 Magnet 垂直居中对齐 Pixel
        const offsetY = (PIXEL_SIZE - magnetHeight) / 2;
        const edgePadding = PIXEL_SIZE / 2;

        return {
          x: left.x - edgePadding,
          y: left.y + offsetY,
          width: right.x - left.x + PIXEL_SIZE * 2,
          height: magnetHeight,
        };
      }

      case 'vertical': {
        if (anchors.length < 2) return null;
        // 垂直锚点：高度自适应，宽度固定
        // x 方向也需要水平居中对齐 Pixel
        const topAnchor = anchors[0].gridY <= anchors[1].gridY ? anchors[0] : anchors[1];
        const bottomAnchor = topAnchor === anchors[0] ? anchors[1] : anchors[0];
        const top = pixelPositions.get(`${topAnchor.gridX},${topAnchor.gridY}`);
        const bottom = pixelPositions.get(`${bottomAnchor.gridX},${bottomAnchor.gridY}`);
        if (!top || !bottom) return null;

        const magnetWidth = parseFloat(style.width || '36px');

        // 计算 x 方向偏移量，使 Magnet 水平居中对齐 Pixel
        const offsetX = (PIXEL_SIZE - magnetWidth) / 2;
        const edgePadding = PIXEL_SIZE / 2;

        return {
          x: top.x + offsetX,
          y: top.y - edgePadding,
          width: magnetWidth,
          height: bottom.y - top.y + PIXEL_SIZE * 2,
        };
      }

      case 'rectangular': {
        if (anchors.length < 3) return null;
        // 矩形锚点：宽度和高度都自适应
        const topLeft = pixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
        const topRight = pixelPositions.get(`${anchors[1].gridX},${anchors[1].gridY}`);
        const bottomLeft = pixelPositions.get(`${anchors[2].gridX},${anchors[2].gridY}`);
        if (!topLeft || !topRight || !bottomLeft) return null;
        const edgePadding = PIXEL_SIZE / 2;
        return {
          x: topLeft.x - edgePadding,
          y: topLeft.y - edgePadding,
          width: topRight.x - topLeft.x + PIXEL_SIZE * 2,
          height: bottomLeft.y - topLeft.y + PIXEL_SIZE * 2,
        };
      }

      default:
        return null;
    }
  }, [magnet, pixelPositions, PIXEL_SIZE]);

  const handleClick = () => {
    if (magnet.interactions.clickable && magnet.interactions.onClick) {
      magnet.interactions.onClick();
      onInteract?.(magnet.id, 'click');
    }
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (magnet.interactions.draggable && magnet.interactions.onDrag) {
        e.preventDefault();
        magnet.interactions.onDrag(magnet.anchors);
        onInteract?.(magnet.id, 'drag');
      }
      setIsActive(true);
    },
    [magnet, onInteract]
  );

  const handleMouseUp = useCallback(() => {
    setIsActive(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setIsActive(false);
  }, []);

  // 计算当前应用的样式
  const currentStyle = useMemo(() => {
    let appliedStyle = { ...magnet.style };

    // 应用 hover 样式
    if (isHovering && magnet.animation?.hoverStyle) {
      appliedStyle = { ...appliedStyle, ...magnet.animation.hoverStyle };
    }

    // 应用 active 样式（优先级更高）
    if (isActive && magnet.animation?.activeStyle) {
      appliedStyle = { ...appliedStyle, ...magnet.animation.activeStyle };
    }

    return appliedStyle;
  }, [magnet.style, magnet.animation, isHovering, isActive]);

  // ✅ 检测大幅度位置变化（窗口大小变化），禁用 transition
  useEffect(() => {
    if (lowRenderMode) {
      setDisableTransition(true);
      lastBoundsRef.current = bounds;
      return;
    }

    if (!bounds) {
      return;
    }

    // 首次渲染，保存初始位置并短暂禁用动画
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      lastBoundsRef.current = bounds;
      // 50ms 后启用动画
      const timer = setTimeout(() => {
        setDisableTransition(false);
      }, 50);
      return () => clearTimeout(timer);
    }

    // 首次渲染后第一次更新
    if (!lastBoundsRef.current) {
      lastBoundsRef.current = bounds;
      return;
    }

    const last = lastBoundsRef.current;
    const deltaX = Math.abs(bounds.x - last.x);
    const deltaY = Math.abs(bounds.y - last.y);
    const deltaW = Math.abs(bounds.width - last.width);
    const deltaH = Math.abs(bounds.height - last.height);

    // ✅ 检测窗口大小变化：
    // 1. 任何单个维度变化超过 100px
    // 2. 或者多个维度同时变化（总变化 > 100px）
    const totalDelta = deltaX + deltaY + deltaW + deltaH;
    const isLargeChange =
      deltaX > 100 || deltaY > 100 || deltaW > 100 || deltaH > 100 || totalDelta > 100;

    if (isLargeChange) {
      setDisableTransition(true);
      // 短暂禁用后恢复（立即禁用，50ms 后恢复）
      const timer = setTimeout(() => {
        setDisableTransition(false);
        lastBoundsRef.current = bounds; // ✅ 恢复后更新位置
      }, 50);
      return () => clearTimeout(timer);
    } else {
      // 小幅度变化，正常更新位置
      lastBoundsRef.current = bounds;
    }
  }, [bounds, lowRenderMode]);

  const transitionValue = useMemo(() => {
    if (lowRenderMode || disableTransition) return 'none';
    return magnet.animation?.transition || 'var(--magnet-transition, all 0.3s cubic-bezier(0.4, 0, 0.2, 1))';
  }, [lowRenderMode, disableTransition, magnet.animation?.transition]);

  // Shell is layout + hit-testing only (position/size/drag/click). Visual styles live in the optional "chrome" element.
  const shellStyle = useMemo(() => {
    if (!bounds) return null;

    const cursor = typeof currentStyle.cursor === 'string' ? currentStyle.cursor : undefined;

    return {
      position: 'absolute' as const,
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      transition: transitionValue,
      cursor,
    };
  }, [bounds, currentStyle.cursor, transitionValue]);

  const chromeStyle = useMemo(() => {
    const next: Record<string, string | number | undefined> = { ...currentStyle };
    delete next.width;
    delete next.height;

    return {
      width: '100%',
      height: '100%',
      transition: transitionValue,
      ...next,
    };
  }, [currentStyle, transitionValue]);

  // 渲染自定义组件内容
  const renderContent = () => {
    const rendererId = magnet.renderer ?? magnet.id;
    const rendererEntry =
      getMagnetRenderer(rendererId) ??
      (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
    if (rendererEntry) return rendererEntry.render();

    // 默认渲染
    if (typeof magnet.content === 'string') {
      return <span className="magnet-text">{magnet.content}</span>;
    }

    return magnet.content;
  };

  if (!bounds || !shellStyle) return null;

  const chromeEnabled =
    chromeOverrideMode === 'force-on'
      ? true
      : chromeOverrideMode === 'force-off'
        ? false
        : magnet.chrome?.enabled !== false;

  return (
    <div
      className={`magnet-shell magnet-state-${magnet.state}`}
      data-magnet-id={magnet.id}
      style={shellStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {chromeEnabled ? (
        <div
          className={`magnet magnet-${magnet.type} magnet-state-${magnet.state}`}
          style={chromeStyle}
        >
          {renderContent()}
        </div>
      ) : (
        renderContent()
      )}
    </div>
  );
}
