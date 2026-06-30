import { appWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, Crosshair, Eye, EyeOff, Home, ListTree, PanelBottom, Pencil, RotateCcw, Scan } from 'lucide-react';
import { useKernel } from '../../contexts/KernelContext';
import type { VisualizerContribution } from '../../contracts/contributions';
import { useT } from '../../i18n/react';
import {
  createDefaultVisualizerWorkbenchStore,
  resolveDefaultVisualizerNativeDockSurfaceContents,
  resolveVisualizerScene,
  VISUALIZER_WORKBENCH_SURFACE_IDS,
} from '../../modules/visualizer';
import type {
  VisualizerCameraOrbitPreset,
  VisualizerViewGizmoAxisState,
  VisualizerViewGizmoState,
} from '../../modules/visualizer';
import { createWorkbenchNativeSurfaceManager } from '../../modules/workbench';
import type { WorkbenchNativeSurfaceEvent } from '../../modules/workbench';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import WindowResizeHandles from '../core/WindowResizeHandles';
import { VisualizerCanvas } from './VisualizerCanvas';
import './VisualizerOverlay.css';

type VisualizerOverlayProps = {
  visualizerId: string;
  source?: 'magnet' | 'settings' | 'command' | 'programmatic';
  onClose: () => void;
};

type CameraOrbitAxisPreset = Exclude<VisualizerCameraOrbitPreset, 'home'>;

type ViewGizmoAxisStyle = CSSProperties & {
  '--gizmo-x': string;
  '--gizmo-y': string;
  '--gizmo-length': string;
  '--gizmo-angle': string;
  '--gizmo-scale': string;
  '--gizmo-opacity': string;
  '--gizmo-z': number;
};

const CAMERA_ORBIT_TITLE_KEYS: Record<CameraOrbitAxisPreset, string> = {
  'x-positive': 'visualizer.overlay.cameraOrbit.xPositive',
  'x-negative': 'visualizer.overlay.cameraOrbit.xNegative',
  'y-positive': 'visualizer.overlay.cameraOrbit.yPositive',
  'y-negative': 'visualizer.overlay.cameraOrbit.yNegative',
  'z-positive': 'visualizer.overlay.cameraOrbit.zPositive',
  'z-negative': 'visualizer.overlay.cameraOrbit.zNegative',
};

const DEFAULT_VIEW_GIZMO_STATE: VisualizerViewGizmoState = {
  axes: [
    { id: 'x-negative', axis: 'x', direction: -1, label: '-X', x: 10, y: 42, depth: -0.5, visible: false },
    { id: 'y-negative', axis: 'y', direction: -1, label: '-Y', x: 46, y: 52, depth: -0.5, visible: false },
    { id: 'z-negative', axis: 'z', direction: -1, label: '-Z', x: 34, y: 66, depth: -0.5, visible: false },
    { id: 'x-positive', axis: 'x', direction: 1, label: 'X', x: 58, y: 26, depth: 0.5, visible: true },
    { id: 'y-positive', axis: 'y', direction: 1, label: 'Y', x: 22, y: 18, depth: 0.5, visible: true },
    { id: 'z-positive', axis: 'z', direction: 1, label: 'Z', x: 34, y: 2, depth: 0.5, visible: true },
  ],
};

function toViewGizmoAxisStyle(axis: VisualizerViewGizmoAxisState): ViewGizmoAxisStyle {
  const dx = axis.x - 34;
  const dy = axis.y - 34;
  const frontness = Math.max(0, Math.min(1, (axis.depth + 1) / 2));
  return {
    '--gizmo-x': `${axis.x}px`,
    '--gizmo-y': `${axis.y}px`,
    '--gizmo-length': `${Math.hypot(dx, dy)}px`,
    '--gizmo-angle': `${Math.atan2(dy, dx)}rad`,
    '--gizmo-scale': `${0.72 + frontness * 0.42}`,
    '--gizmo-opacity': `${0.38 + frontness * 0.56}`,
    '--gizmo-z': Math.round(10 + frontness * 40),
  };
}

type NativeDockSurfaceKey = 'timeline' | 'outliner';

type NativeDockSurfaceVisibility = Record<NativeDockSurfaceKey, boolean>;

const DEFAULT_NATIVE_DOCK_VISIBILITY: NativeDockSurfaceVisibility = {
  timeline: false,
  outliner: false,
};

export function VisualizerOverlay({ visualizerId, source, onClose }: VisualizerOverlayProps) {
  const kernel = useKernel();
  const t = useT();
  const telemetry = useMemo(() => getTelemetryLogger('visualizer', 'VisualizerOverlay'), []);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const nativeSurfaceManagerRef = useRef<ReturnType<typeof createWorkbenchNativeSurfaceManager> | null>(null);
  const componentVisibilityRef = useRef<Record<string, boolean>>({});
  const syncNativeSurfaceContentRef = useRef<(() => void) | null>(null);
  const nativeDockVisibilityRef = useRef<NativeDockSurfaceVisibility>({ ...DEFAULT_NATIVE_DOCK_VISIBILITY });
  const setNativeDockSurfaceVisibleRef = useRef<((surfaceId: string, visible: boolean) => void) | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closeRequestedRef = useRef(false);
  const closeFinishedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [revision, setRevision] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [componentVisibilityOverrides, setComponentVisibilityOverrides] = useState<Record<string, boolean>>({});
  const [nativeDockVisibility, setNativeDockVisibility] = useState<NativeDockSurfaceVisibility>({
    ...DEFAULT_NATIVE_DOCK_VISIBILITY,
  });
  const [layoutResetRevision, setLayoutResetRevision] = useState(0);
  const [centerCanvasRevision, setCenterCanvasRevision] = useState(0);
  const [resetCanvasSizeRevision, setResetCanvasSizeRevision] = useState(0);
  const [cameraOrbitPreset, setCameraOrbitPreset] = useState<VisualizerCameraOrbitPreset>('home');
  const [cameraOrbitRevision, setCameraOrbitRevision] = useState(0);
  const [viewGizmoVisible, setViewGizmoVisible] = useState(true);
  const [viewGizmoState, setViewGizmoState] = useState<VisualizerViewGizmoState>(DEFAULT_VIEW_GIZMO_STATE);
  const [isEntered, setIsEntered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const finishClose = useCallback(() => {
    if (!closeRequestedRef.current || closeFinishedRef.current) return;
    closeFinishedRef.current = true;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    onCloseRef.current();
  }, []);

  const beginClose = useCallback(() => {
    if (closeRequestedRef.current || closeFinishedRef.current) return;
    closeRequestedRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, 320);
  }, [finishClose]);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((value) => value + 1));
  }, [kernel.contributions]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const contribution = useMemo(() => {
    void revision;
    return kernel.contributions.get<VisualizerContribution>('visualizer', visualizerId);
  }, [kernel.contributions, revision, visualizerId]);

  const title = contribution?.title ?? visualizerId;

  useEffect(() => {
    telemetry.info('visualizer.overlay.opened', {
      fields: {
        visualizerId,
        source: source ?? 'programmatic',
      },
    });
    return () => {
      telemetry.info('visualizer.overlay.closed', {
        fields: {
          visualizerId,
          source: source ?? 'programmatic',
        },
      });
    };
  }, [source, telemetry, visualizerId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (editMode) {
        setEditMode(false);
        return;
      }
      beginClose();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [beginClose, editMode]);

  useEffect(() => {
    overlayRef.current?.focus();
  }, [visualizerId]);

  useEffect(() => {
    componentVisibilityRef.current = {};
    setComponentVisibilityOverrides({});
    nativeDockVisibilityRef.current = { ...DEFAULT_NATIVE_DOCK_VISIBILITY };
    setNativeDockVisibility({ ...DEFAULT_NATIVE_DOCK_VISIBILITY });
    setCameraOrbitPreset('home');
    setCameraOrbitRevision((value) => value + 1);
  }, [visualizerId]);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    const manager = createWorkbenchNativeSurfaceManager();
    nativeSurfaceManagerRef.current = manager;
    let disposed = false;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let unlistenAudioState: (() => void) | null = null;
    let unlistenAudioTime: (() => void) | null = null;
    let unlistenNativeEvents: (() => void) | null = null;
    let contentSyncTimer: number | null = null;
    let lastContentSyncAt = 0;
    const audioService = kernel.services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN)?.getSnapshot().audioService ?? null;
    const store = createDefaultVisualizerWorkbenchStore({
      sceneId: visualizerId,
      now: Date.now,
    });

    const syncNativeSurfaces = () => {
      void manager.syncGeometry().catch(() => undefined);
    };

    const syncWorkbenchTimelineFromAudio = () => {
      if (!audioService) return;
      const state = audioService.getState();
      store.dispatch({
        type: 'timeline.playhead.set',
        playheadMs: Math.max(0, state.currentTime * 1_000),
      });
    };

    const syncNativeSurfaceContent = () => {
      if (disposed) return;

      const snapshot = store.getSnapshot();
      const audioState = audioService?.getState();
      const currentTrack = audioState?.currentTrack ?? null;
      const durationSeconds = audioState?.duration ?? audioService?.getDuration() ?? 0;
      const trackLabel = currentTrack
        ? [currentTrack.title, currentTrack.artist].filter(Boolean).join(' - ')
        : null;
      const updates = resolveDefaultVisualizerNativeDockSurfaceContents(snapshot, {
        titleForKey: t,
        durationMs: durationSeconds * 1_000,
        trackLabel,
        componentVisibility: componentVisibilityRef.current,
      });

      lastContentSyncAt = window.performance.now();
      void Promise.all(updates.map((update) => manager.updateContent(update.surfaceId, update.content))).catch(
        (error) => {
          telemetry.warn('visualizer.native-dock.content-sync.failed', {
            message: error instanceof Error ? error.message : String(error),
            fields: {
              visualizerId,
            },
          });
        }
      );
    };
    syncNativeSurfaceContentRef.current = syncNativeSurfaceContent;

    const scheduleNativeSurfaceContentSync = (immediate = false) => {
      if (disposed) return;
      if (contentSyncTimer !== null) {
        window.clearTimeout(contentSyncTimer);
        contentSyncTimer = null;
      }
      if (immediate) {
        syncNativeSurfaceContent();
        return;
      }

      const elapsedMs = window.performance.now() - lastContentSyncAt;
      const delayMs = Math.max(0, 125 - elapsedMs);
      contentSyncTimer = window.setTimeout(() => {
        contentSyncTimer = null;
        syncNativeSurfaceContent();
      }, delayMs);
    };

    const setNativeDockSurfaceVisible = (surfaceId: string, visible: boolean) => {
      if (disposed) return;
      const snapshot = store.getSnapshot();
      const run = async () => {
        if (visible) {
          await manager.openSurfaces(snapshot, {
            surfaceIds: [surfaceId],
          });
          if (disposed) {
            await manager.closeSurface(surfaceId);
            return;
          }
          syncNativeSurfaces();
          scheduleNativeSurfaceContentSync(true);
          return;
        }

        await manager.closeSurface(surfaceId);
      };

      void run().catch((error) => {
        telemetry.warn('visualizer.native-dock.visibility-toggle.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            visualizerId,
            surfaceId,
            visible,
          },
        });
      });
    };
    setNativeDockSurfaceVisibleRef.current = setNativeDockSurfaceVisible;

    const handleNativeSurfaceEvent = (event: WorkbenchNativeSurfaceEvent) => {
      if (disposed) return;
      if (
        event.surfaceId !== VISUALIZER_WORKBENCH_SURFACE_IDS.timeline &&
        event.surfaceId !== VISUALIZER_WORKBENCH_SURFACE_IDS.outliner
      ) {
        return;
      }

      if (event.kind === 'timeline.seek') {
        store.dispatch({
          type: 'timeline.playhead.set',
          playheadMs: event.playheadMs,
          isScrubbing: false,
        });
        try {
          audioService?.seek(event.playheadMs / 1_000);
        } catch (error) {
          telemetry.warn('visualizer.native-dock.timeline-seek.failed', {
            message: error instanceof Error ? error.message : String(error),
            fields: {
              visualizerId,
            },
          });
        }
        scheduleNativeSurfaceContentSync(true);
        return;
      }

      if (event.kind === 'timeline.clip.set') {
        store.dispatch({
          type: 'timeline.clip.set',
          range: event.range,
        });
        scheduleNativeSurfaceContentSync(event.isFinal);
        return;
      }

      if (event.kind === 'timeline.loop.set') {
        store.dispatch({
          type: 'timeline.loop.set',
          range: event.range,
        });
        scheduleNativeSurfaceContentSync(event.isFinal);
        return;
      }

      if (event.kind === 'outliner.select') {
        const snapshot = store.getSnapshot();
        const sceneId = snapshot.context.sceneId;
        store.dispatch({
          type: 'selection.set',
          scope: event.itemId === sceneId ? 'scene' : 'component',
          ids: [event.itemId],
          primaryId: event.itemId,
        });
        scheduleNativeSurfaceContentSync(true);
        return;
      }

      if (event.kind === 'outliner.visibility.toggle') {
        const snapshot = store.getSnapshot();
        const scene = resolveVisualizerScene(snapshot.context.sceneId ?? visualizerId);
        const componentsById = new Map(scene.components.map((component) => [component.id, component] as const));
        const nextVisibility = { ...componentVisibilityRef.current };

        if (event.itemId === scene.id) {
          const hasVisibleComponent = scene.components.some(
            (component) => nextVisibility[component.id] ?? component.transform?.visible ?? true
          );
          const visible = !hasVisibleComponent;
          for (const component of scene.components) {
            nextVisibility[component.id] = visible;
          }
        } else {
          const component = componentsById.get(event.itemId);
          if (!component) return;
          const visible = nextVisibility[component.id] ?? component.transform?.visible ?? true;
          nextVisibility[component.id] = !visible;
        }

        componentVisibilityRef.current = nextVisibility;
        setComponentVisibilityOverrides(nextVisibility);
        scheduleNativeSurfaceContentSync(true);
      }
    };

    const attachGeometryListeners = async () => {
      try {
        const [moveCleanup, resizeCleanup] = await Promise.all([
          appWindow.onMoved(syncNativeSurfaces),
          appWindow.onResized(syncNativeSurfaces),
        ]);

        if (disposed) {
          moveCleanup();
          resizeCleanup();
          return;
        }

        unlistenMove = moveCleanup;
        unlistenResize = resizeCleanup;
      } catch (error) {
        telemetry.warn('visualizer.native-dock.geometry-listeners.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            visualizerId,
          },
        });
      }
    };

    syncNativeSurfaces();

    if (audioService) {
      unlistenAudioState = audioService.onStateChange(() => {
        syncWorkbenchTimelineFromAudio();
        scheduleNativeSurfaceContentSync(true);
      });
      unlistenAudioTime = audioService.onTimeUpdate((time) => {
        store.dispatch({
          type: 'timeline.playhead.set',
          playheadMs: Math.max(0, time * 1_000),
        });
        scheduleNativeSurfaceContentSync();
      });
    }

    void manager
      .listenEvents(handleNativeSurfaceEvent)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenNativeEvents = unlisten;
      })
      .catch((error) => {
        telemetry.warn('visualizer.native-dock.event-listener.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            visualizerId,
          },
        });
      });

    void attachGeometryListeners();
    window.addEventListener('resize', syncNativeSurfaces);
    return () => {
      disposed = true;
      if (contentSyncTimer !== null) {
        window.clearTimeout(contentSyncTimer);
        contentSyncTimer = null;
      }
      window.removeEventListener('resize', syncNativeSurfaces);
      unlistenMove?.();
      unlistenResize?.();
      unlistenAudioState?.();
      unlistenAudioTime?.();
      unlistenNativeEvents?.();
      if (syncNativeSurfaceContentRef.current === syncNativeSurfaceContent) {
        syncNativeSurfaceContentRef.current = null;
      }
      if (setNativeDockSurfaceVisibleRef.current === setNativeDockSurfaceVisible) {
        setNativeDockSurfaceVisibleRef.current = null;
      }
      void manager.closeAll().catch(() => undefined);
      if (nativeSurfaceManagerRef.current === manager) {
        nativeSurfaceManagerRef.current = null;
      }
    };
  }, [kernel.services, t, telemetry, visualizerId]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const handleFrameTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
      if (!isClosing) return;
      finishClose();
    },
    [finishClose, isClosing]
  );

  const handleDragRegionPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.detail > 1 || !isTauriRuntime()) return;

    void appWindow.startDragging();
  }, []);

  const handleDragRegionDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleExitClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      beginClose();
    },
    [beginClose]
  );

  const handleLayoutResetClick = useCallback(() => {
    componentVisibilityRef.current = {};
    setComponentVisibilityOverrides({});
    setLayoutResetRevision((value) => value + 1);
    syncNativeSurfaceContentRef.current?.();
  }, []);

  const handleCameraOrbit = useCallback((preset: VisualizerCameraOrbitPreset) => {
    setCameraOrbitPreset(preset);
    setCameraOrbitRevision((value) => value + 1);
  }, []);

  const handleViewGizmoChange = useCallback((state: VisualizerViewGizmoState) => {
    setViewGizmoState(state);
  }, []);

  const sortedViewGizmoAxes = useMemo(
    () => [...viewGizmoState.axes].sort((left, right) => left.depth - right.depth),
    [viewGizmoState.axes]
  );

  const viewGizmoToggleTitle = t(
    viewGizmoVisible ? 'visualizer.overlay.cameraOrbit.hide' : 'visualizer.overlay.cameraOrbit.show'
  );

  const handleNativeDockToggle = useCallback((surface: NativeDockSurfaceKey) => {
    const surfaceId =
      surface === 'timeline'
        ? VISUALIZER_WORKBENCH_SURFACE_IDS.timeline
        : VISUALIZER_WORKBENCH_SURFACE_IDS.outliner;
    const next = {
      ...nativeDockVisibilityRef.current,
      [surface]: !nativeDockVisibilityRef.current[surface],
    };
    nativeDockVisibilityRef.current = next;
    setNativeDockVisibility(next);
    setNativeDockSurfaceVisibleRef.current?.(surfaceId, next[surface]);
  }, []);

  return (
    <div
      ref={overlayRef}
      className={`visualizer-overlay ${editMode ? 'is-editing' : ''} ${
        isClosing ? 'is-closing' : isEntered ? 'is-entered' : 'is-entering'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="visualizer-overlay__frame" onTransitionEnd={handleFrameTransitionEnd}>
        <span className="visualizer-overlay__sr-title">{title}</span>
        <div
          className="visualizer-overlay__window-drag-region"
          onPointerDown={handleDragRegionPointerDown}
          onDoubleClick={handleDragRegionDoubleClick}
          aria-hidden="true"
        />
        {!editMode && (
          <button
            type="button"
            className="visualizer-overlay__exit"
            onClick={handleExitClick}
            title={t('common.action.close')}
            aria-label={t('common.action.close')}
          >
            <ChevronDown size={21} strokeWidth={2.15} aria-hidden="true" />
          </button>
        )}

        <div
          className="visualizer-overlay__dock-rail"
          role="toolbar"
          aria-label={t('visualizer.overlay.dockControls')}
        >
          <div className="visualizer-overlay__dock-tools">
            <button
              type="button"
              className={`visualizer-overlay__tool visualizer-overlay__dock-tool ${
                nativeDockVisibility.timeline ? 'is-active' : ''
              }`}
              onClick={() => handleNativeDockToggle('timeline')}
              title={t('visualizer.overlay.action.toggleTimeline')}
              aria-label={t('visualizer.overlay.action.toggleTimeline')}
              aria-pressed={nativeDockVisibility.timeline}
            >
              <PanelBottom size={18} strokeWidth={2.1} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`visualizer-overlay__tool visualizer-overlay__dock-tool ${
                nativeDockVisibility.outliner ? 'is-active' : ''
              }`}
              onClick={() => handleNativeDockToggle('outliner')}
              title={t('visualizer.overlay.action.toggleOutliner')}
              aria-label={t('visualizer.overlay.action.toggleOutliner')}
              aria-pressed={nativeDockVisibility.outliner}
            >
              <ListTree size={18} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className={`visualizer-overlay__viewport-rail ${viewGizmoVisible ? 'is-gizmo-visible' : 'is-gizmo-hidden'}`}
          role="toolbar"
          aria-label={t('visualizer.overlay.viewportControls')}
        >
          <div className="visualizer-overlay__viewport-tools">
            <div
              className="visualizer-overlay__viewport-group"
              role="group"
              aria-label={t('visualizer.overlay.cameraOrbit.group')}
            >
              <button
                type="button"
                className={`visualizer-overlay__tool visualizer-overlay__viewport-tool ${viewGizmoVisible ? 'is-active' : ''}`}
                onClick={() => setViewGizmoVisible((value) => !value)}
                title={viewGizmoToggleTitle}
                aria-label={viewGizmoToggleTitle}
                aria-pressed={viewGizmoVisible}
              >
                {viewGizmoVisible ? <Eye size={18} strokeWidth={2.05} aria-hidden="true" /> : <EyeOff size={18} strokeWidth={2.05} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="visualizer-overlay__tool visualizer-overlay__viewport-tool"
                onClick={() => handleCameraOrbit('home')}
                title={t('visualizer.overlay.cameraOrbit.home')}
                aria-label={t('visualizer.overlay.cameraOrbit.home')}
              >
                <Home size={18} strokeWidth={2.05} aria-hidden="true" />
              </button>
            </div>
            <div
              className="visualizer-overlay__viewport-group"
              role="group"
              aria-label={t('visualizer.overlay.canvasActions')}
            >
              <button
                type="button"
                className="visualizer-overlay__tool visualizer-overlay__viewport-tool"
                onClick={() => setCenterCanvasRevision((value) => value + 1)}
                title={t('visualizer.overlay.action.centerCanvas')}
                aria-label={t('visualizer.overlay.action.centerCanvas')}
              >
                <Crosshair size={18} strokeWidth={2.1} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="visualizer-overlay__tool visualizer-overlay__viewport-tool"
                onClick={() => setResetCanvasSizeRevision((value) => value + 1)}
                title={t('visualizer.overlay.action.resetCanvasSize')}
                aria-label={t('visualizer.overlay.action.resetCanvasSize')}
              >
                <Scan size={17} strokeWidth={2.1} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div
          className={`visualizer-overlay__controls ${editMode ? 'is-active' : ''}`}
          role="toolbar"
          aria-label={t('settings.sections.visualizers')}
        >
          <button
            type="button"
            className={`visualizer-overlay__tool visualizer-overlay__edit-tool ${editMode ? 'is-active' : ''}`}
            onClick={() => setEditMode((value) => !value)}
            title={editMode ? t('common.action.done') : t('common.action.edit')}
            aria-label={editMode ? t('common.action.done') : t('common.action.edit')}
            aria-pressed={editMode}
          >
            {editMode ? <Check size={18} strokeWidth={2.1} aria-hidden="true" /> : <Pencil size={18} strokeWidth={2.1} aria-hidden="true" />}
          </button>
          {editMode && (
            <button
              type="button"
              className="visualizer-overlay__tool"
              onClick={handleLayoutResetClick}
              title={t('common.action.reset')}
              aria-label={t('common.action.reset')}
            >
              <RotateCcw size={17} strokeWidth={2.1} aria-hidden="true" />
            </button>
          )}
        </div>

        <VisualizerCanvas
          visualizerId={visualizerId}
          className="visualizer-overlay__canvas"
          editMode={editMode}
          componentVisibilityOverrides={componentVisibilityOverrides}
          resetLayoutRevision={layoutResetRevision}
          centerCanvasRevision={centerCanvasRevision}
          resetCanvasSizeRevision={resetCanvasSizeRevision}
          cameraOrbitPreset={cameraOrbitPreset}
          cameraOrbitRevision={cameraOrbitRevision}
          onViewGizmoChange={handleViewGizmoChange}
        />
        {viewGizmoVisible && (
          <div
            className="visualizer-overlay__view-gizmo"
            role="toolbar"
            aria-label={t('visualizer.overlay.cameraOrbit.group')}
          >
            <div className="visualizer-overlay__view-gizmo-orb">
              <span className="visualizer-overlay__view-gizmo-ring" />
              {sortedViewGizmoAxes.map((axis) => (
                <span
                  key={`${axis.id}-spoke`}
                  className={`visualizer-overlay__view-gizmo-spoke is-${axis.axis}`}
                  data-axis={axis.axis}
                  data-direction={axis.direction}
                  data-visible={axis.visible ? 'true' : 'false'}
                  style={toViewGizmoAxisStyle(axis)}
                  aria-hidden="true"
                />
              ))}
              <button
                type="button"
                className="visualizer-overlay__view-gizmo-button is-home"
                onClick={() => handleCameraOrbit('home')}
                title={t('visualizer.overlay.cameraOrbit.home')}
                aria-label={t('visualizer.overlay.cameraOrbit.home')}
              >
                <Home size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
              {sortedViewGizmoAxes.map((axis) => (
                <button
                  key={axis.id}
                  type="button"
                  className={`visualizer-overlay__view-gizmo-button is-${axis.axis}`}
                  onClick={() => handleCameraOrbit(axis.id)}
                  title={t(CAMERA_ORBIT_TITLE_KEYS[axis.id])}
                  aria-label={t(CAMERA_ORBIT_TITLE_KEYS[axis.id])}
                  data-axis={axis.axis}
                  data-direction={axis.direction}
                  data-visible={axis.visible ? 'true' : 'false'}
                  style={toViewGizmoAxisStyle(axis)}
                >
                  <span aria-hidden="true">{axis.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <WindowResizeHandles />
      </div>
    </div>
  );
}
