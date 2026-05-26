import { appWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Axis3d, Check, ChevronDown, Crosshair, Edit3, Grid2x2, PanelRight, PanelTop, RotateCcw, Scan } from 'lucide-react';
import { useKernel } from '../../contexts/KernelContext';
import type { VisualizerContribution } from '../../contracts/contributions';
import { useT } from '../../i18n/react';
import {
  createDefaultVisualizerWorkbenchState,
  readStoredVisualizerWorkspaceViewMode,
  resolveDefaultVisualizerNativeDockSurfaceContents,
  VISUALIZER_WORKBENCH_SURFACE_IDS,
} from '../../modules/visualizer';
import type { VisualizerWorkspaceViewMode } from '../../modules/visualizer';
import { createWorkbenchNativeSurfaceManager } from '../../modules/workbench';
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

const VIEW_MODE_BUTTONS: Array<{
  mode: VisualizerWorkspaceViewMode;
  titleKey: string;
  ariaKey: string;
}> = [
  {
    mode: 'perspective',
    titleKey: 'visualizer.overlay.viewMode.perspective.title',
    ariaKey: 'visualizer.overlay.viewMode.perspective.aria',
  },
  {
    mode: 'top',
    titleKey: 'visualizer.overlay.viewMode.top.title',
    ariaKey: 'visualizer.overlay.viewMode.top.aria',
  },
  {
    mode: 'front',
    titleKey: 'visualizer.overlay.viewMode.front.title',
    ariaKey: 'visualizer.overlay.viewMode.front.aria',
  },
  {
    mode: 'side',
    titleKey: 'visualizer.overlay.viewMode.side.title',
    ariaKey: 'visualizer.overlay.viewMode.side.aria',
  },
];

function renderViewModeIcon(mode: VisualizerWorkspaceViewMode) {
  if (mode === 'top') {
    return <Grid2x2 size={17} strokeWidth={2.05} aria-hidden="true" />;
  }
  if (mode === 'front') {
    return <PanelTop size={17} strokeWidth={2.05} aria-hidden="true" />;
  }
  if (mode === 'side') {
    return <PanelRight size={17} strokeWidth={2.05} aria-hidden="true" />;
  }
  return <Axis3d size={18} strokeWidth={2.05} aria-hidden="true" />;
}

export function VisualizerOverlay({ visualizerId, source, onClose }: VisualizerOverlayProps) {
  const kernel = useKernel();
  const t = useT();
  const telemetry = useMemo(() => getTelemetryLogger('visualizer', 'VisualizerOverlay'), []);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const nativeSurfaceManagerRef = useRef<ReturnType<typeof createWorkbenchNativeSurfaceManager> | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closeRequestedRef = useRef(false);
  const closeFinishedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [revision, setRevision] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [layoutResetRevision, setLayoutResetRevision] = useState(0);
  const [centerCanvasRevision, setCenterCanvasRevision] = useState(0);
  const [resetCanvasSizeRevision, setResetCanvasSizeRevision] = useState(0);
  const [viewMode, setViewMode] = useState<VisualizerWorkspaceViewMode>(() =>
    readStoredVisualizerWorkspaceViewMode(visualizerId)
  );
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
    setViewMode(readStoredVisualizerWorkspaceViewMode(visualizerId));
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
    let contentSyncTimer: number | null = null;
    let lastContentSyncAt = 0;
    const audioService = kernel.services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN)?.getSnapshot().audioService ?? null;

    const syncNativeSurfaces = () => {
      void manager.syncGeometry().catch(() => undefined);
    };

    const syncNativeSurfaceContent = () => {
      if (disposed) return;

      const audioState = audioService?.getState();
      const currentTrack = audioState?.currentTrack ?? null;
      const durationSeconds = audioState?.duration ?? audioService?.getDuration() ?? 0;
      const currentSeconds = audioState?.currentTime ?? audioService?.getCurrentTime() ?? 0;
      const trackLabel = currentTrack
        ? [currentTrack.title, currentTrack.artist].filter(Boolean).join(' - ')
        : null;
      const snapshot = createDefaultVisualizerWorkbenchState({
        sceneId: visualizerId,
      });
      const updates = resolveDefaultVisualizerNativeDockSurfaceContents(snapshot, {
        titleForKey: t,
        durationMs: durationSeconds * 1_000,
        playheadMs: currentSeconds * 1_000,
        trackLabel,
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

    const bootstrapNativeSurfaces = async () => {
      const snapshot = createDefaultVisualizerWorkbenchState({
        sceneId: visualizerId,
      });

      await manager.openSurfaces(snapshot, {
        surfaceIds: [
          VISUALIZER_WORKBENCH_SURFACE_IDS.timeline,
          VISUALIZER_WORKBENCH_SURFACE_IDS.outliner,
        ],
      });

      if (disposed) {
        await manager.closeAll();
        return;
      }

      if (!disposed) {
        syncNativeSurfaces();
        scheduleNativeSurfaceContentSync(true);
      }
    };

    void bootstrapNativeSurfaces().catch((error) => {
      telemetry.warn('visualizer.native-dock.bootstrap.failed', {
        message: error instanceof Error ? error.message : String(error),
        fields: {
          visualizerId,
        },
      });
    });

    if (audioService) {
      unlistenAudioState = audioService.onStateChange(() => scheduleNativeSurfaceContentSync(true));
      unlistenAudioTime = audioService.onTimeUpdate(() => scheduleNativeSurfaceContentSync());
    }

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
          className="visualizer-overlay__viewport-rail"
          role="toolbar"
          aria-label={t('visualizer.overlay.viewportControls')}
        >
          <div className="visualizer-overlay__viewport-tools">
            <div
              className="visualizer-overlay__viewport-group"
              role="group"
              aria-label={t('visualizer.overlay.viewMode.group')}
            >
              {VIEW_MODE_BUTTONS.map((button) => (
                <button
                  key={button.mode}
                  type="button"
                  className={`visualizer-overlay__tool ${viewMode === button.mode ? 'is-active' : ''}`}
                  onClick={() => setViewMode(button.mode)}
                  title={t(button.titleKey)}
                  aria-label={t(button.ariaKey)}
                  aria-pressed={viewMode === button.mode}
                  data-view-mode={button.mode}
                >
                  {renderViewModeIcon(button.mode)}
                </button>
              ))}
            </div>
            <div
              className="visualizer-overlay__viewport-group"
              role="group"
              aria-label={t('visualizer.overlay.canvasActions')}
            >
              <button
                type="button"
                className="visualizer-overlay__tool"
                onClick={() => setCenterCanvasRevision((value) => value + 1)}
                title={t('visualizer.overlay.action.centerCanvas')}
                aria-label={t('visualizer.overlay.action.centerCanvas')}
              >
                <Crosshair size={18} strokeWidth={2.1} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="visualizer-overlay__tool"
                onClick={() => setResetCanvasSizeRevision((value) => value + 1)}
                title={t('visualizer.overlay.action.resetCanvasSize')}
                aria-label={t('visualizer.overlay.action.resetCanvasSize')}
              >
                <Scan size={17} strokeWidth={2.1} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="visualizer-overlay__controls" aria-label={t('settings.sections.visualizers')}>
          <button
            type="button"
            className={`visualizer-overlay__tool ${editMode ? 'is-active' : ''}`}
            onClick={() => setEditMode((value) => !value)}
            title={editMode ? t('common.action.done') : t('common.action.edit')}
            aria-label={editMode ? t('common.action.done') : t('common.action.edit')}
            aria-pressed={editMode}
          >
            {editMode ? <Check size={18} strokeWidth={2.1} aria-hidden="true" /> : <Edit3 size={18} strokeWidth={2.1} aria-hidden="true" />}
          </button>
          {editMode && (
            <button
              type="button"
              className="visualizer-overlay__tool"
              onClick={() => setLayoutResetRevision((value) => value + 1)}
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
          viewMode={viewMode}
          resetLayoutRevision={layoutResetRevision}
          centerCanvasRevision={centerCanvasRevision}
          resetCanvasSizeRevision={resetCanvasSizeRevision}
        />
        <WindowResizeHandles />
      </div>
    </div>
  );
}
