import { appWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Crosshair, Edit3, RotateCcw, Scan } from 'lucide-react';
import { useKernel } from '../../contexts/KernelContext';
import type { VisualizerContribution } from '../../contracts/contributions';
import { useT } from '../../i18n/react';
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

export function VisualizerOverlay({ visualizerId, source, onClose }: VisualizerOverlayProps) {
  const kernel = useKernel();
  const t = useT();
  const telemetry = useMemo(() => getTelemetryLogger('visualizer', 'VisualizerOverlay'), []);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closeRequestedRef = useRef(false);
  const closeFinishedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [revision, setRevision] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [layoutResetRevision, setLayoutResetRevision] = useState(0);
  const [centerCanvasRevision, setCenterCanvasRevision] = useState(0);
  const [resetCanvasSizeRevision, setResetCanvasSizeRevision] = useState(0);
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
    const rafId = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, []);

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
          resetLayoutRevision={layoutResetRevision}
          centerCanvasRevision={centerCanvasRevision}
          resetCanvasSizeRevision={resetCanvasSizeRevision}
        />
        <WindowResizeHandles />
      </div>
    </div>
  );
}
