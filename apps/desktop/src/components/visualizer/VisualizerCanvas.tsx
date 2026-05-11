import { useEffect, useLayoutEffect, useRef } from 'react';
import type { QualityEffectiveConfig } from '../../contracts/quality';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useQuality } from '../../contexts/QualityContext';
import { CanvasRuntime } from '../../modules/visualizer';
import type { VisualizerComponentQuality } from '../../modules/visualizer';

type VisualizerCanvasProps = {
  visualizerId: string;
  className?: string;
  editMode?: boolean;
  resetLayoutRevision?: number;
  centerCanvasRevision?: number;
  resetCanvasSizeRevision?: number;
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
}: VisualizerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<CanvasRuntime | null>(null);
  const audioService = useAudioService();
  const quality = useQuality();
  const initialVisualizerIdRef = useRef(visualizerId);
  const initialQualityRef = useRef(quality.effective);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const runtime = new CanvasRuntime({
      audioService,
      canvas,
      sceneId: initialVisualizerIdRef.current,
      quality: toVisualizerQuality(initialQualityRef.current),
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

  return <canvas ref={canvasRef} className={className} data-visualizer-id={visualizerId} />;
}
