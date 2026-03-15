import { memo, useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import type { Magnet } from '../../types/pixel';
import { getMagnetRenderer } from '../../magnet-system/registry';
import type { MagnetChromeOverrideMode } from '../../modules/magnets';
import {
  alignMagnetBounds,
  computeMagnetBounds,
  resolveMagnetInsets,
  type MagnetBounds,
} from '../../modules/magnets/geometry';
import type { MagnetAdaptiveLayoutMode, MagnetJoinEdges } from '../../modules/magnets/layoutAdaptive';
import {
  buildMagnetLayoutCompensationTransform,
  buildMagnetShellTransition,
  resolveMagnetMotionRuntime,
} from '../../modules/magnets/motionContract';
import {
  resolveMagnetCornerRadii,
  splitMagnetStyleTokens,
} from '../../modules/magnets/stylePolicy';
import {
  extractMagnetBorderStroke,
  normalizeMagnetOpacity,
  resolveMagnetChromeEnabled,
  resolveMagnetCurrentStyle,
  resolveMagnetInteractionState,
  resolveMagnetTransitionValue,
  toOpaqueMagnetColor,
} from '../../modules/magnets/runtimeStyle';
import { useSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId } from '../../themes/types/theme';
import { useMagnetSkin } from '../../themes/useMagnetSkin';
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

function MagnetComponentImpl({
  magnet,
  pixelPositions,
  onInteract,
  chromeOverrideMode,
  boundsOverride,
  layoutMode = 'normal',
  joinEdges,
}: MagnetProps) {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const magnetBindingId = `magnet.${magnet.id}` as ThemeBindingId;
  const magnetSkin = useMagnetSkin(magnet.id, {
    defaultRendererId: magnet.renderer ?? magnet.id,
    defaultVariant: 'default',
  });
  const magnetSurface = useSkinSurfaceModel(magnetBindingId);
  const [isHovering, setIsHovering] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragFeedbackTimerRef = useRef<number | null>(null);
  const [disableTransition, setDisableTransition] = useState(true);
  const [layoutCompensationTransform, setLayoutCompensationTransform] = useState<string | null>(null);
  const lastBoundsRef = useRef<MagnetBounds | null>(null);
  const isFirstRenderRef = useRef(true);
  const layoutCompensationFrameRef = useRef<number | null>(null);

  const clearDragFeedbackTimer = useCallback(() => {
    if (dragFeedbackTimerRef.current === null) return;
    window.clearTimeout(dragFeedbackTimerRef.current);
    dragFeedbackTimerRef.current = null;
  }, []);

  const clearLayoutCompensationFrame = useCallback(() => {
    if (layoutCompensationFrameRef.current === null) return;
    window.cancelAnimationFrame(layoutCompensationFrameRef.current);
    layoutCompensationFrameRef.current = null;
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

  const currentStyle = useMemo(
    () =>
      resolveMagnetCurrentStyle(magnet.style, magnet.animation, {
        isHovering,
        isActive,
        isDragging,
      }),
    [magnet.style, magnet.animation, isHovering, isActive, isDragging]
  );

  const { chromeStyle: chromeTokens, contentStyle: contentTokens } = useMemo(
    () => splitMagnetStyleTokens(currentStyle),
    [currentStyle]
  );

  const resolvedCornerRadii = useMemo(
    () => resolveMagnetCornerRadii(chromeTokens.borderRadius, joinEdges),
    [chromeTokens.borderRadius, joinEdges]
  );

  const motionRuntime = useMemo(
    () => resolveMagnetMotionRuntime(lowRenderMode, magnetSkin.motion),
    [lowRenderMode, magnetSkin.motion]
  );

  useLayoutEffect(() => {
    if (motionRuntime.mode === 'off') {
      clearLayoutCompensationFrame();
      setDisableTransition(true);
      setLayoutCompensationTransform(null);
      lastBoundsRef.current = bounds;
      return;
    }

    if (!bounds) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      lastBoundsRef.current = bounds;
      setLayoutCompensationTransform(null);
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
    const shouldSnapLargeChange = isLargeChange && motionRuntime.largeChange !== 'animate';

    if (shouldSnapLargeChange) {
      clearLayoutCompensationFrame();
      setDisableTransition(true);
      setLayoutCompensationTransform(null);
      const timer = setTimeout(() => {
        setDisableTransition(false);
        lastBoundsRef.current = bounds;
      }, 50);
      return () => clearTimeout(timer);
    }

    clearLayoutCompensationFrame();
    const nextCompensationTransform = buildMagnetLayoutCompensationTransform(
      last,
      bounds,
      motionRuntime.layoutStrategy
    );
    if (nextCompensationTransform) {
      setLayoutCompensationTransform(nextCompensationTransform);
      layoutCompensationFrameRef.current = window.requestAnimationFrame(() => {
        layoutCompensationFrameRef.current = null;
        setLayoutCompensationTransform(null);
      });
    } else {
      setLayoutCompensationTransform(null);
    }

    setDisableTransition(false);
    lastBoundsRef.current = bounds;
    return () => {
      clearLayoutCompensationFrame();
    };
  }, [bounds, clearLayoutCompensationFrame, motionRuntime]);

  useEffect(
    () => () => {
      clearLayoutCompensationFrame();
    },
    [clearLayoutCompensationFrame]
  );

  const chromeTransitionValue = useMemo(
    () => resolveMagnetTransitionValue(lowRenderMode || motionRuntime.mode === 'off', disableTransition, magnet.animation?.transition),
    [lowRenderMode, motionRuntime.mode, disableTransition, magnet.animation?.transition]
  );

  const shellTransitionValue = useMemo(
    () => buildMagnetShellTransition(motionRuntime, chromeTransitionValue, disableTransition),
    [motionRuntime, chromeTransitionValue, disableTransition]
  );

  const chromeEnabled = useMemo(
    () => resolveMagnetChromeEnabled(magnet.chrome, chromeOverrideMode),
    [magnet.chrome, chromeOverrideMode]
  );

  const chromeBaseOpacity = normalizeMagnetOpacity(currentStyle.opacity) ?? 1;
  const borderStroke = extractMagnetBorderStroke(currentStyle.border);
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
      transition: shellTransitionValue,
      cursor,
      transform: layoutCompensationTransform ?? undefined,
      transformOrigin: layoutCompensationTransform ? 'top left' : undefined,
      willChange: layoutCompensationTransform ? 'transform' : undefined,
    };
  }, [bounds, currentStyle.cursor, shellTransitionValue, layoutCompensationTransform]);

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
      transition: chromeTransitionValue,
      ...next,
      ...resolvedCornerRadii,
    };
  }, [chromeTokens, resolvedCornerRadii, chromeTransitionValue]);

  const chromeBaseStyle = useMemo(() => {
    const shouldUseInsetStroke = Boolean(borderStroke);
    const insetStrokeShadow = borderStroke
      ? `inset 0 0 0 ${borderStroke.width} ${borderStroke.color}`
      : undefined;
    const boxShadow = [currentStyle.boxShadow, insetStrokeShadow].filter(Boolean).join(', ');

    return {
      position: 'absolute' as const,
      top: chromeInsets.top,
      right: chromeInsets.right,
      bottom: chromeInsets.bottom,
      left: chromeInsets.left,
      pointerEvents: 'none' as const,
      transition: chromeTransitionValue,
      opacity: chromeBaseOpacity,
      backgroundColor: toOpaqueMagnetColor(currentStyle.backgroundColor),
      border: shouldUseInsetStroke ? 'none' : currentStyle.border,
      boxShadow: boxShadow || undefined,
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
    resolvedCornerRadii,
    chromeTransitionValue,
  ]);

  const rendererStyle = useMemo(() => {
    const baseStyle = {
      minWidth: 0,
      minHeight: 0,
      boxSizing: 'border-box' as const,
      transition: chromeTransitionValue,
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
    chromeTransitionValue,
    resolvedCornerRadii,
    chromeInsetApplies,
    chromeInsets.top,
    chromeInsets.right,
    chromeInsets.bottom,
    chromeInsets.left,
  ]);

  const renderedContent = useMemo(() => {
    const rendererId = magnet.renderer ?? magnet.id;
    const rendererEntry =
      getMagnetRenderer(rendererId) ??
      (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
    if (rendererEntry) return rendererEntry.render();

    if (typeof magnet.content === 'string') {
      return <span className="magnet-text">{magnet.content}</span>;
    }

    return magnet.content;
  }, [magnet.renderer, magnet.id, magnet.content]);

  if (!bounds || !shellStyle) return null;

  const interactionState = resolveMagnetInteractionState({
    isHovering,
    isActive,
    isDragging,
  });

  const chromeRootProps = magnetSurface.getElementProps({
    bindingId: magnetBindingId,
    state: interactionState,
    className: `magnet magnet--${interactionState} magnet--${layoutMode} magnet-${magnet.type} magnet-state-${magnet.state}`,
    style: chromeStyle,
    includeSurfaceTokens: true,
  });

  const rendererRootProps = magnetSurface.getElementProps({
    bindingId: magnetBindingId,
    state: interactionState,
    className: 'magnet-renderer',
    style: rendererStyle,
    includeSurfaceTokens: true,
  });

  return (
    <div
      className={`magnet-shell magnet-shell--${interactionState} magnet-shell--${layoutMode} magnet-state-${magnet.state}`}
      data-magnet-id={magnet.id}
      data-interaction-state={interactionState}
      data-layout-mode={layoutMode}
      data-pmp-motion-mode={motionRuntime.mode}
      data-pmp-motion-layout={motionRuntime.layoutStrategy}
      {...(motionRuntime.sharedKey ? { 'data-pmp-motion-shared-key': motionRuntime.sharedKey } : {})}
      style={shellStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {chromeEnabled ? (
        <div
          {...chromeRootProps}
          data-surface-id={magnetBindingId}
          data-surface-variant={magnetSurface.variant}
        >
          <div className="magnet-base-layer" style={chromeBaseStyle} />
          <div className="magnet-content-layer" style={rendererStyle}>{renderedContent}</div>
        </div>
      ) : (
        <div
          {...rendererRootProps}
          data-surface-id={magnetBindingId}
          data-surface-variant={magnetSurface.variant}
        >
          {renderedContent}
        </div>
      )}
    </div>
  );
}

export const MagnetComponent = memo(MagnetComponentImpl);
MagnetComponent.displayName = 'MagnetComponent';
