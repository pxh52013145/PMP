import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { PmpsEntryPoint } from './pmps';
import { resolvePmpsEntryPoint } from './webgl2ShaderSource';
import { Webgl2ShaderRuntime, type DetectedUniform, type ShaderRuntimeError } from './webgl2Runtime';
import { useWindowActivity } from '../contexts/WindowActivityContext';
import { BACKGROUND_RENDER_THROTTLE_FPS } from '../contracts/performance';

export type PmpsShaderLayerProps = {
  shaderId: string;
  fragmentCode: string;
  entryPoint?: PmpsEntryPoint;
  width: number;
  height: number;
  fpsLimit?: number;
  resolutionScale?: number;
  getFrequencyData?: () => Uint8Array | null;
  uniformValues?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
  onError?: (error: ShaderRuntimeError) => void;
  onDetectedUniforms?: (uniforms: DetectedUniform[]) => void;
};

export function PmpsShaderLayer({
  shaderId,
  fragmentCode,
  entryPoint,
  width,
  height,
  fpsLimit,
  resolutionScale,
  getFrequencyData,
  uniformValues,
  className,
  style,
  onError,
  onDetectedUniforms,
}: PmpsShaderLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Webgl2ShaderRuntime | null>(null);
  const [hasError, setHasError] = useState(false);
  const { isVisible, renderMode } = useWindowActivity();

  const resolvedEntryPoint = useMemo(
    () => resolvePmpsEntryPoint(fragmentCode, entryPoint),
    [entryPoint, fragmentCode]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    runtimeRef.current?.dispose();
    runtimeRef.current = null;
    setHasError(false);

    const runtimeErrorHandler = (error: ShaderRuntimeError) => {
      console.error('[pmps]', error);
      onError?.(error);
      if (error.stage === 'context') {
        return;
      }
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      setHasError(true);
    };

    try {
      const runtime = new Webgl2ShaderRuntime({
        canvas,
        fragmentCode,
        entryPoint: resolvedEntryPoint,
        shaderId,
        fpsLimit,
        resolutionScale,
        onError: runtimeErrorHandler,
      });
      runtime.resize(width, height, { resolutionScale });
      onDetectedUniforms?.(runtime.getDetectedUniforms());
      runtimeRef.current = runtime;
    } catch (error) {
      runtimeErrorHandler({
        shaderId,
        stage: 'compile',
        message: error instanceof Error ? error.message : String(error),
        detail: error,
      });
    }

    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [
    fragmentCode,
    fpsLimit,
    height,
    onDetectedUniforms,
    onError,
    resolvedEntryPoint,
    resolutionScale,
    shaderId,
    width,
  ]);

  useEffect(() => {
    runtimeRef.current?.resize(width, height, { resolutionScale });
  }, [height, resolutionScale, width]);

  useEffect(() => {
    const shouldRun = isVisible && renderMode !== 'pause' && !hasError && width > 0 && height > 0;
    runtimeRef.current?.setActive(shouldRun);
  }, [hasError, height, isVisible, renderMode, width]);

  useEffect(() => {
    const base =
      typeof fpsLimit === 'number' && Number.isFinite(fpsLimit) && fpsLimit > 0 ? fpsLimit : undefined;
    const effective =
      renderMode === 'throttle'
        ? base === undefined
          ? BACKGROUND_RENDER_THROTTLE_FPS
          : Math.min(base, BACKGROUND_RENDER_THROTTLE_FPS)
        : base;
    runtimeRef.current?.setFpsLimit(effective);
  }, [fpsLimit, renderMode]);

  useEffect(() => {
    runtimeRef.current?.setFrequencyDataProvider(getFrequencyData);
  }, [getFrequencyData]);

  useEffect(() => {
    runtimeRef.current?.setUserUniformValues(uniformValues);
  }, [uniformValues]);

  if (hasError) {
    return (
      <div
        className={className}
        style={style}
        data-pmps-shader-id={shaderId}
        data-pmps-shader-error="1"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      data-pmps-shader-id={shaderId}
    />
  );
}
