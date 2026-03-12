import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { Magnet } from '../../types/pixel';
import { getMagnetRenderer } from '../../magnet-system/registry';
import type { MagnetChromeOverrideMode } from '../../modules/magnets';
import { DEFAULT_MAGNET_TRANSITION } from '../../modules/magnets/chromePresets';
import {
  alignMagnetBounds,
  computeMagnetBounds,
  resolveMagnetInsets,
  type MagnetBounds,
} from '../../modules/magnets/geometry';
import type { MagnetAdaptiveLayoutMode, MagnetJoinEdges } from '../../modules/magnets/layoutAdaptive';
import {
  resolveMagnetCornerRadii,
  splitMagnetStyleTokens,
} from '../../modules/magnets/stylePolicy';
import './Magnet.css';

interface MagnetProps {
  magnet: Magnet;
  pixelPositions: Map<string, { x: number; y: number }>;
  onInteract?: (magnetId: string, event: string) => void;
  chromeOverrideMode?: MagnetChromeOverrideMode;
  boundsOverride?: MagnetBounds;
  layoutMode?: MagnetAdaptiveLayoutMode;
  joinEdges?: MagnetJoinEdges;
}

function normalizeOpacity(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return undefined;
}

function toOpaqueColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return value;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 4) return `#${hex.slice(0, 3)}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}`;
    return normalized;
  }

  const rgbaMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbaMatch) return value;
  const channels = rgbaMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (channels.length < 3) return value;
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function extractBorderStroke(value: string | undefined): { width: string; color: string } | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const match = normalized.match(/^([0-9.]+px)\s+\S+\s+(.+)$/);
  if (!match) return null;

  return {
    width: match[1],
    color: match[2].trim(),
  };
}

export function MagnetComponent({
  magnet,
  pixelPositions,
  onInteract,
  chromeOverrideMode,
  boundsOverride,
  layoutMode = 'normal',
  joinEdges,
}: MagnetProps) {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const [isHovering, setIsHovering] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragFeedbackTimerRef = useRef<number | null>(null);
  const [disableTransition, setDisableTransition] = useState(true);
  const lastBoundsRef = useRef<MagnetBounds | null>(null);
  const isFirstRenderRef = useRef(true);

  const clearDragFeedbackTimer = useCallback(() => {
    if (dragFeedbackTimerRef.current === null) return;
    window.clearTimeout(dragFeedbackTimerRef.current);
    dragFeedbackTimerRef.current = null;
  }, []);

  const resetTransientInteractionState = useCallback(() => {
    clearDragFeedbackTimer();
    setIsActive(false);
    setIsDragging(false);
  }, [clearDragFeedbackTimer]);

  const scheduleDragFeedbackReset = useCallback(() => {
    clearDragFeedbackTimer();
    dragFeedbackTimerRef.current = window.setTimeout(() => {
      dragFeedbackTimerRef.current = null;
      setIsActive(false);
      setIsDragging(false);
    }, 240);
  }, [clearDragFeedbackTimer]);

  const bounds = useMemo(() => {
    if (boundsOverride) return alignMagnetBounds(boundsOverride);
    const computedBounds = computeMagnetBounds(magnet, pixelPositions);
    return computedBounds ? alignMagnetBounds(computedBounds) : null;
  }, [boundsOverride, magnet, pixelPositions]);

  const handleClick = () => {
    if (magnet.interactions.clickable && magnet.interactions.onClick) {
      magnet.interactions.onClick();
      onInteract?.(magnet.id, 'click');
    }
  };

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      setIsActive(true);

      if (magnet.interactions.draggable && magnet.interactions.onDrag) {
        event.preventDefault();
        setIsDragging(true);
        scheduleDragFeedbackReset();
        magnet.interactions.onDrag(magnet.anchors);
        onInteract?.(magnet.id, 'drag');
        return;
      }
    },
    [magnet, onInteract, scheduleDragFeedbackReset]
  );

  const handleMouseUp = useCallback(() => {
    resetTransientInteractionState();
  }, [resetTransientInteractionState]);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setIsActive(false);
    if (!isDragging) return;
    scheduleDragFeedbackReset();
  }, [isDragging, scheduleDragFeedbackReset]);

  useEffect(() => {
    const handleWindowBlur = () => {
      resetTransientInteractionState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetTransientInteractionState();
      }
    };

    window.addEventListener('mouseup', handleWindowBlur);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mouseup', handleWindowBlur);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearDragFeedbackTimer();
    };
  }, [clearDragFeedbackTimer, resetTransientInteractionState]);

  const currentStyle = useMemo(() => {
    let appliedStyle = { ...magnet.style };

    if (isHovering && magnet.animation?.hoverStyle) {
      appliedStyle = { ...appliedStyle, ...magnet.animation.hoverStyle };
    }

    if (isActive && magnet.animation?.activeStyle) {
      appliedStyle = { ...appliedStyle, ...magnet.animation.activeStyle };
    }

    if (isDragging && magnet.animation?.dragStyle) {
      appliedStyle = { ...appliedStyle, ...magnet.animation.dragStyle };
    }

    return appliedStyle;
  }, [magnet.style, magnet.animation, isHovering, isActive, isDragging]);

  const { chromeStyle: chromeTokens, contentStyle: contentTokens } = useMemo(
    () => splitMagnetStyleTokens(currentStyle),
    [currentStyle]
  );

  const resolvedCornerRadii = useMemo(
    () => resolveMagnetCornerRadii(chromeTokens.borderRadius, joinEdges),
    [chromeTokens.borderRadius, joinEdges]
  );

  useEffect(() => {
    if (lowRenderMode) {
      setDisableTransition(true);
      lastBoundsRef.current = bounds;
      return;
    }

    if (!bounds) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      lastBoundsRef.current = bounds;
      const timer = setTimeout(() => {
        setDisableTransition(false);
      }, 50);
      return () => clearTimeout(timer);
    }

    if (!lastBoundsRef.current) {
      lastBoundsRef.current = bounds;
      return;
    }

    const last = lastBoundsRef.current;
    const deltaX = Math.abs(bounds.x - last.x);
    const deltaY = Math.abs(bounds.y - last.y);
    const deltaW = Math.abs(bounds.width - last.width);
    const deltaH = Math.abs(bounds.height - last.height);
    const totalDelta = deltaX + deltaY + deltaW + deltaH;
    const isLargeChange =
      deltaX > 100 || deltaY > 100 || deltaW > 100 || deltaH > 100 || totalDelta > 100;

    if (isLargeChange) {
      setDisableTransition(true);
      const timer = setTimeout(() => {
        setDisableTransition(false);
        lastBoundsRef.current = bounds;
      }, 50);
      return () => clearTimeout(timer);
    }

    lastBoundsRef.current = bounds;
  }, [bounds, lowRenderMode]);

  const transitionValue = useMemo(() => {
    if (lowRenderMode || disableTransition) return 'none';
    return magnet.animation?.transition || DEFAULT_MAGNET_TRANSITION;
  }, [lowRenderMode, disableTransition, magnet.animation?.transition]);

  const chromeEnabled =
    chromeOverrideMode === 'force-on'
      ? true
      : chromeOverrideMode === 'force-off'
        ? false
        : magnet.chrome?.enabled !== false;

  const chromeBaseOpacity = normalizeOpacity(currentStyle.opacity) ?? 1;
  const borderStroke = extractBorderStroke(currentStyle.border);
  const chromeInsets = useMemo(() => resolveMagnetInsets(magnet.chrome?.inset), [magnet.chrome?.inset]);
  const hasChromeInset = chromeInsets.top > 0 || chromeInsets.right > 0 || chromeInsets.bottom > 0 || chromeInsets.left > 0;
  const chromeInsetApplies = chromeEnabled && hasChromeInset;

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
    const next: Record<string, string | number | undefined> = { ...chromeTokens };
    delete next.width;
    delete next.height;
    delete next.opacity;
    delete next.backgroundColor;
    delete next.border;
    delete next.boxShadow;
    delete next.backdropFilter;
    delete next.filter;
    delete next.cursor;
    delete next.borderRadius;

    return {
      width: '100%',
      height: '100%',
      transition: transitionValue,
      ...next,
      ...resolvedCornerRadii,
    };
  }, [chromeTokens, resolvedCornerRadii, transitionValue]);

  const chromeBaseStyle = useMemo(() => {
    const shouldUseInsetStroke = layoutMode !== 'normal' && borderStroke;
    const boxShadow = shouldUseInsetStroke
      ? [currentStyle.boxShadow, `inset 0 0 0 ${borderStroke.width} ${borderStroke.color}`]
          .filter(Boolean)
          .join(', ')
      : currentStyle.boxShadow;

    return {
      position: 'absolute' as const,
      top: chromeInsets.top,
      right: chromeInsets.right,
      bottom: chromeInsets.bottom,
      left: chromeInsets.left,
      pointerEvents: 'none' as const,
      transition: transitionValue,
      opacity: chromeBaseOpacity,
      backgroundColor: toOpaqueColor(currentStyle.backgroundColor),
      border: shouldUseInsetStroke ? 'none' : currentStyle.border,
      boxShadow,
      backdropFilter: currentStyle.backdropFilter,
      WebkitBackdropFilter: currentStyle.backdropFilter,
      filter: currentStyle.filter,
      ...resolvedCornerRadii,
    };
  }, [
    borderStroke,
    chromeBaseOpacity,
    currentStyle.backgroundColor,
    currentStyle.border,
    currentStyle.boxShadow,
    currentStyle.backdropFilter,
    currentStyle.filter,
    chromeInsets.top,
    chromeInsets.right,
    chromeInsets.bottom,
    chromeInsets.left,
    layoutMode,
    resolvedCornerRadii,
    transitionValue,
  ]);

  const rendererStyle = useMemo(() => {
    const baseStyle = {
      minWidth: 0,
      minHeight: 0,
      boxSizing: 'border-box' as const,
      transition: transitionValue,
      ...resolvedCornerRadii,
      ...contentTokens,
    };

    if (!chromeInsetApplies) {
      return {
        width: '100%',
        height: '100%',
        ...baseStyle,
      };
    }

    return {
      position: 'absolute' as const,
      top: chromeInsets.top,
      right: chromeInsets.right,
      bottom: chromeInsets.bottom,
      left: chromeInsets.left,
      width: 'auto',
      height: 'auto',
      ...baseStyle,
    };
  }, [
    contentTokens,
    transitionValue,
    resolvedCornerRadii,
    chromeInsetApplies,
    chromeInsets.top,
    chromeInsets.right,
    chromeInsets.bottom,
    chromeInsets.left,
  ]);

  const renderContent = () => {
    const rendererId = magnet.renderer ?? magnet.id;
    const rendererEntry =
      getMagnetRenderer(rendererId) ??
      (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
    if (rendererEntry) return rendererEntry.render();

    if (typeof magnet.content === 'string') {
      return <span className="magnet-text">{magnet.content}</span>;
    }

    return magnet.content;
  };

  if (!bounds || !shellStyle) return null;

  const interactionState = isDragging ? 'dragging' : isActive ? 'active' : isHovering ? 'hover' : 'idle';

  return (
    <div
      className={`magnet-shell magnet-shell--${interactionState} magnet-shell--${layoutMode} magnet-state-${magnet.state}`}
      data-magnet-id={magnet.id}
      data-interaction-state={interactionState}
      data-layout-mode={layoutMode}
      style={shellStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {chromeEnabled ? (
        <div
          className={`magnet magnet--${interactionState} magnet--${layoutMode} magnet-${magnet.type} magnet-state-${magnet.state}`}
          style={chromeStyle}
        >
          <div className="magnet-base-layer" style={chromeBaseStyle} />
          <div className="magnet-content-layer" style={rendererStyle}>
            {renderContent()}
          </div>
        </div>
      ) : (
        <div className="magnet-renderer" style={rendererStyle}>
          {renderContent()}
        </div>
      )}
    </div>
  );
}
