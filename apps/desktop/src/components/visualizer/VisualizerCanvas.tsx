import { useEffect, useLayoutEffect, useRef } from 'react';
import type { QualityEffectiveConfig } from '../../contracts/quality';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useQuality } from '../../contexts/QualityContext';
import { VisualizerWorkspaceRuntime } from '../../modules/visualizer';
import type { VisualizerComponentQuality, VisualizerWorkspaceViewMode } from '../../modules/visualizer';

type VisualizerCanvasProps = {
  visualizerId: string;
  className?: string;
  editMode?: boolean;
  resetLayoutRevision?: number;
  centerCanvasRevision?: number;
  resetCanvasSizeRevision?: number;
  viewMode?: VisualizerWorkspaceViewMode;
};

const QUALITY_LEVEL_ORDER: QualityEffectiveConfig['level'][] = ['potato', 'low', 'balanced', 'high', 'ultra'];

function toVisualizerQuality(quality: QualityEffectiveConfig): VisualizerComponentQuality {
  return {
    level: Math.max(0, QUALITY_LEVEL_ORDER.indexOf(quality.level)),
    barCount: quality.visualizerBars,
    renderScale: quality.renderScale,
    fpsLimit: quality.fpsForeground > 0 ? quality.fpsForeground : quality.fpsEffects,
  };
}

export function VisualizerCanvas({
  visualizerId,
  className,
  editMode = false,
  resetLayoutRevision = 0,
  centerCanvasRevision = 0,
  resetCanvasSizeRevision = 0,
  viewMode = 'perspective',
}: VisualizerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const componentHostRootRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<VisualizerWorkspaceRuntime | null>(null);
  const audioService = useAudioService();
  const quality = useQuality();
  const initialVisualizerIdRef = useRef(visualizerId);
  const initialQualityRef = useRef(quality.effective);
  const initialViewModeRef = useRef(viewMode);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const componentHostRoot = componentHostRootRef.current;
    if (!canvas) return;

    const runtime = new VisualizerWorkspaceRuntime({
      audioService,
      canvas,
      componentHostRoot,
      sceneId: initialVisualizerIdRef.current,
      quality: toVisualizerQuality(initialQualityRef.current),
      viewMode: initialViewModeRef.current,
    });
    runtimeRef.current = runtime;
    runtime.start();

    return () => {
      runtime.dispose();
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [audioService]);

  useEffect(() => {
    runtimeRef.current?.setScene(visualizerId);
  }, [visualizerId]);

  useEffect(() => {
    runtimeRef.current?.setQuality(toVisualizerQuality(quality.effective));
  }, [quality.effective]);

  useEffect(() => {
    runtimeRef.current?.setEditMode(editMode);
  }, [editMode]);

  useEffect(() => {
    runtimeRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (resetLayoutRevision <= 0) return;
    runtimeRef.current?.resetLayout();
  }, [resetLayoutRevision]);

  useEffect(() => {
    if (centerCanvasRevision <= 0) return;
    runtimeRef.current?.centerCanvas();
  }, [centerCanvasRevision]);

  useEffect(() => {
    if (resetCanvasSizeRevision <= 0) return;
    runtimeRef.current?.resetCanvasSize();
  }, [resetCanvasSizeRevision]);

  return (
    <div className={`visualizer-canvas ${className ?? ''}`} data-visualizer-id={visualizerId}>
      <canvas
        ref={canvasRef}
        className="visualizer-canvas__webgl"
        data-visualizer-canvas="workspace"
      />
      <div
        ref={componentHostRootRef}
        className="visualizer-canvas__component-host-root"
        data-visualizer-surface-root="component-host-root"
        aria-hidden="true"
      />
    </div>
  );
}
