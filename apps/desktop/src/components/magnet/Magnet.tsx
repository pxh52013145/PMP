import { memo, useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { Magnet } from '../../types/pixel';
import {
  getMagnetRenderer,
  getMagnetRenderersRevision,
  subscribeMagnetRenderers,
} from '../../magnet-system/registry';
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
import type { ThemeBindingId, ThemeMotionChannelSpec } from '../../themes/types/theme';
import {
  MagnetSkinInstanceDefaultsProvider,
  useMagnetSkin,
} from '../../themes/useMagnetSkin';
import type { MagnetSceneAnimation } from './magnetSceneRuntime';
import './Magnet.css';

interface MagnetProps {
  magnet: Magnet;
  pixelPositions: Map<string, { x: number; y: number }>;
  onInteract?: (magnetId: string, event: string) => void;
  chromeOverrideMode?: MagnetChromeOverrideMode;
  layoutBoundsOverride?: MagnetBounds;
  layoutMode?: MagnetAdaptiveLayoutMode;
  joinEdges?: MagnetJoinEdges;
  sceneAnimation?: MagnetSceneAnimation;
  layoutMotionChannel?: ThemeMotionChannelSpec;
  disableMotion?: boolean;
}

type MagnetShellStyle = React.CSSProperties & {
  '--pmp-magnet-z': number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function MagnetComponentImpl({
  magnet,
  pixelPositions,
  onInteract,
  chromeOverrideMode,
  layoutBoundsOverride,
  layoutMode = 'normal',
  joinEdges,
  sceneAnimation,
  layoutMotionChannel,
  disableMotion = false,
}: MagnetProps) {
  const lowRenderMode = import.meta.env.VITE_PERF_NEXT_LOW_RENDER === '1';
  const rendererId = magnet.renderer ?? magnet.id;
  const magnetSkinDefaults = useMemo(
    () => ({
      magnetId: magnet.id,
      rendererId,
      ...(typeof magnet.variant === 'string' && magnet.variant.trim().length > 0
        ? { variant: magnet.variant.trim() }
        : {}),
      ...(isPlainObject(magnet.skinProps) ? { props: magnet.skinProps } : {}),
    }),
    [magnet.id, magnet.skinProps, magnet.variant, rendererId]
  );
  const magnetBindingId = `magnet.${magnet.id}` as ThemeBindingId;
  const magnetSkin = useMagnetSkin(magnet.id, {
    defaultRendererId: rendererId,
    defaultVariant: magnetSkinDefaults.variant ?? 'default',
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
  const rendererRevision = useSyncExternalStore(
    subscribeMagnetRenderers,
    getMagnetRenderersRevision,
    getMagnetRenderersRevision
  );

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

  const layoutBounds = useMemo(() => {
    if (layoutBoundsOverride) return alignMagnetBounds(layoutBoundsOverride);
    const computedBounds = computeMagnetBounds(magnet, pixelPositions);
    return computedBounds ? alignMagnetBounds(computedBounds) : null;
  }, [layoutBoundsOverride, magnet, pixelPositions]);

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
    () =>
      disableMotion
        ? {
            mode: 'off' as const,
            layoutStrategy: 'none' as const,
            largeChange: 'snap' as const,
          }
        : resolveMagnetMotionRuntime(lowRenderMode, magnetSkin.motion, undefined, layoutMotionChannel),
    [disableMotion, layoutMotionChannel, lowRenderMode, magnetSkin.motion]
  );

  useLayoutEffect(() => {
    if (disableMotion || motionRuntime.mode === 'off') {
      clearLayoutCompensationFrame();
      isFirstRenderRef.current = true;
      setDisableTransition(true);
      setLayoutCompensationTransform(null);
      lastBoundsRef.current = layoutBounds;
      return;
    }

    if (!layoutBounds) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      lastBoundsRef.current = layoutBounds;
      setLayoutCompensationTransform(null);
      const timer = setTimeout(() => {
        setDisableTransition(false);
      }, 50);
      return () => clearTimeout(timer);
    }

    if (!lastBoundsRef.current) {
      lastBoundsRef.current = layoutBounds;
      return;
    }

    const last = lastBoundsRef.current;
    const deltaX = Math.abs(layoutBounds.x - last.x);
    const deltaY = Math.abs(layoutBounds.y - last.y);
    const deltaW = Math.abs(layoutBounds.width - last.width);
    const deltaH = Math.abs(layoutBounds.height - last.height);
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
        lastBoundsRef.current = layoutBounds;
      }, 50);
      return () => clearTimeout(timer);
    }

    clearLayoutCompensationFrame();
    const nextCompensationTransform = buildMagnetLayoutCompensationTransform(
      last,
      layoutBounds,
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
    lastBoundsRef.current = layoutBounds;
    return () => {
      clearLayoutCompensationFrame();
    };
  }, [disableMotion, layoutBounds, clearLayoutCompensationFrame, motionRuntime]);

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
  const contentInsets = useMemo(() => resolveMagnetInsets(magnet.chrome?.inset), [magnet.chrome?.inset]);
  const chromeOutsets = useMemo(() => resolveMagnetInsets(magnet.chrome?.outset), [magnet.chrome?.outset]);
  const hasChromeInset =
    contentInsets.top > 0 || contentInsets.right > 0 || contentInsets.bottom > 0 || contentInsets.left > 0;
  const chromeInsetApplies = chromeEnabled && hasChromeInset;
  const hasChromeOutset =
    chromeOutsets.top > 0 ||
    chromeOutsets.right > 0 ||
    chromeOutsets.bottom > 0 ||
    chromeOutsets.left > 0;
  const chromeOutsetApplies = chromeEnabled && hasChromeOutset;

  const shellStyle = useMemo<MagnetShellStyle | null>(() => {
    if (!layoutBounds) return null;

    const cursor = typeof currentStyle.cursor === 'string' ? currentStyle.cursor : undefined;
    const stackLevel = magnet.anchorType === 'rectangular' ? 1 : 2;

    return {
      position: 'absolute' as const,
      left: `${layoutBounds.x}px`,
      top: `${layoutBounds.y}px`,
      width: `${layoutBounds.width}px`,
      height: `${layoutBounds.height}px`,
      '--pmp-magnet-z': stackLevel,
      transition: shellTransitionValue,
      cursor,
      ...(sceneAnimation?.style ?? {}),
      transform: layoutCompensationTransform ?? undefined,
      transformOrigin: layoutCompensationTransform ? 'top left' : undefined,
      willChange: layoutCompensationTransform ? 'transform' : undefined,
    };
  }, [
    layoutBounds,
    currentStyle.cursor,
    shellTransitionValue,
    layoutCompensationTransform,
    sceneAnimation?.style,
    magnet.anchorType,
  ]);

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
    const boxShadow = typeof currentStyle.boxShadow === 'string' ? currentStyle.boxShadow : undefined;
    const borderWidth = borderStroke?.width ?? null;
    const shouldSuppressTop = Boolean(borderWidth && joinEdges?.top);
    const shouldSuppressLeft = Boolean(borderWidth && joinEdges?.left);

    return {
      position: 'absolute' as const,
      top: -(chromeOutsetApplies ? chromeOutsets.top : 0),
      right: -(chromeOutsetApplies ? chromeOutsets.right : 0),
      bottom: -(chromeOutsetApplies ? chromeOutsets.bottom : 0),
      left: -(chromeOutsetApplies ? chromeOutsets.left : 0),
      pointerEvents: 'none' as const,
      transition: chromeTransitionValue,
      opacity: chromeBaseOpacity,
      backgroundColor: toOpaqueMagnetColor(currentStyle.backgroundColor),
      ...(borderStroke
        ? {
            borderStyle: borderStroke.style,
            borderColor: borderStroke.color,
            borderTopWidth: shouldSuppressTop ? '0px' : borderStroke.width,
            borderRightWidth: borderStroke.width,
            borderBottomWidth: borderStroke.width,
            borderLeftWidth: shouldSuppressLeft ? '0px' : borderStroke.width,
          }
        : { border: currentStyle.border }),
      boxShadow,
      backdropFilter: currentStyle.backdropFilter,
      WebkitBackdropFilter: currentStyle.backdropFilter,
      filter: currentStyle.filter,
      ...resolvedCornerRadii,
    };
  }, [
    borderStroke,
    chromeBaseOpacity,
    chromeOutsetApplies,
    chromeOutsets.top,
    chromeOutsets.right,
    chromeOutsets.bottom,
    chromeOutsets.left,
    currentStyle.backgroundColor,
    currentStyle.border,
    currentStyle.boxShadow,
    currentStyle.backdropFilter,
    currentStyle.filter,
    joinEdges?.top,
    joinEdges?.left,
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
      top: contentInsets.top,
      right: contentInsets.right,
      bottom: contentInsets.bottom,
      left: contentInsets.left,
      width: 'auto',
      height: 'auto',
      ...baseStyle,
    };
  }, [
    contentTokens,
    chromeTransitionValue,
    resolvedCornerRadii,
    chromeInsetApplies,
    contentInsets.top,
    contentInsets.right,
    contentInsets.bottom,
    contentInsets.left,
  ]);

  const renderedContent = useMemo(() => {
    void rendererRevision;
    const rendererEntry =
      getMagnetRenderer(rendererId) ??
      (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
    if (rendererEntry) return rendererEntry.render();

    if (typeof magnet.content === 'string') {
      return <span className="magnet-text">{magnet.content}</span>;
    }

    return magnet.content;
  }, [rendererId, magnet.id, magnet.content, rendererRevision]);

  if (!layoutBounds || !shellStyle) return null;

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
      {...(sceneAnimation?.sceneId ? { 'data-pmp-motion-scene': sceneAnimation.sceneId } : {})}
      {...(sceneAnimation?.phase ? { 'data-pmp-motion-phase': sceneAnimation.phase } : {})}
      {...(sceneAnimation?.channel ? { 'data-pmp-motion-channel': sceneAnimation.channel } : {})}
      {...(sceneAnimation?.spec.preset ? { 'data-pmp-motion-preset': sceneAnimation.spec.preset } : {})}
      {...(motionRuntime.sharedKey ? { 'data-pmp-motion-shared-key': motionRuntime.sharedKey } : {})}
      style={shellStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <MagnetSkinInstanceDefaultsProvider value={magnetSkinDefaults}>
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
      </MagnetSkinInstanceDefaultsProvider>
    </div>
  );
}

export const MagnetComponent = memo(MagnetComponentImpl);
MagnetComponent.displayName = 'MagnetComponent';
