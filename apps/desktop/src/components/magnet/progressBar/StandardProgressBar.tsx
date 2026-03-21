import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProgressBarVariantProps } from './ProgressBarTypes';
import { parseProgressBarSkinProps } from './progressBarSkin';
import { buildCoverGradient } from '../shared/useDynamicColor';
import './StandardProgressBar.css';

export const StandardProgressBar: React.FC<ProgressBarVariantProps> = ({
  data,
  logic,
  dynamicColors,
  dynamicColorConfig,
  skinProps: rawSkinProps,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const latestSeekTimeRef = useRef<number | null>(null);
  const globalDragEndCleanupRef = useRef<(() => void) | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const skinProps = useMemo(() => parseProgressBarSkinProps(rawSkinProps), [rawSkinProps]);

  const getTimeFromClientX = (clientX: number) => {
    if (!progressBarRef.current || !data.duration) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    return percentage * data.duration;
  };

  const cleanupGlobalDragEndListeners = useCallback(() => {
    const cleanup = globalDragEndCleanupRef.current;
    if (!cleanup) return;

    cleanup();
    globalDragEndCleanupRef.current = null;
  }, []);

  const endDrag = useCallback(() => {
    cleanupGlobalDragEndListeners();
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const finalTime = latestSeekTimeRef.current;
    latestSeekTimeRef.current = null;
    if (typeof finalTime === 'number') {
      logic.onSeek(finalTime);
    }
    logic.onSeekEnd();

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        setPreviewTime(null);
      });
    } else {
      setPreviewTime(null);
    }
  }, [cleanupGlobalDragEndListeners, logic]);

  const attachGlobalDragEndListeners = useCallback(() => {
    if (typeof window === 'undefined') return;

    cleanupGlobalDragEndListeners();
    const handleDragEnd = () => {
      endDrag();
    };

    window.addEventListener('pointerup', handleDragEnd, true);
    window.addEventListener('pointercancel', handleDragEnd, true);
    window.addEventListener('blur', handleDragEnd);
    globalDragEndCleanupRef.current = () => {
      window.removeEventListener('pointerup', handleDragEnd, true);
      window.removeEventListener('pointercancel', handleDragEnd, true);
      window.removeEventListener('blur', handleDragEnd);
    };
  }, [cleanupGlobalDragEndListeners, endDrag]);

  useEffect(() => {
    return () => {
      cleanupGlobalDragEndListeners();
    };
  }, [cleanupGlobalDragEndListeners]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!data.duration) return;

    progressBarRef.current?.setPointerCapture(e.pointerId);
    logic.onSeekStart();
    isDraggingRef.current = true;
    attachGlobalDragEndListeners();

    const newTime = getTimeFromClientX(e.clientX);
    if (typeof newTime !== 'number') return;
    latestSeekTimeRef.current = newTime;
    setPreviewTime(newTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !data.duration) return;

    const newTime = getTimeFromClientX(e.clientX);
    if (typeof newTime !== 'number') return;
    latestSeekTimeRef.current = newTime;
    setPreviewTime(newTime);
  };

  const effectiveTime = previewTime ?? data.currentTime;
  const progress = useMemo(() => {
    if (!data.duration) return 0;
    return (effectiveTime / data.duration) * 100;
  }, [data.duration, effectiveTime]);

  const buffered = useMemo(() => {
    if (!data.duration) return 0;
    const ratio = typeof data.buffered === 'number' && isFinite(data.buffered) ? data.buffered : 0;
    return Math.max(0, Math.min(1, ratio)) * 100;
  }, [data.buffered, data.duration]);

  const decodeBuffered = useMemo(() => {
    if (!data.duration) return buffered;
    const ratio =
      typeof data.decodeBuffered === 'number' && isFinite(data.decodeBuffered)
        ? data.decodeBuffered
        : data.buffered;
    return Math.max(0, Math.min(1, ratio)) * 100;
  }, [buffered, data.buffered, data.decodeBuffered, data.duration]);

  const outputBuffered = useMemo(() => {
    if (!data.duration) return buffered;
    const ratio =
      typeof data.outputBuffered === 'number' && isFinite(data.outputBuffered)
        ? data.outputBuffered
        : data.buffered;
    return Math.max(0, Math.min(1, ratio)) * 100;
  }, [buffered, data.buffered, data.duration, data.outputBuffered]);

  const effect = dynamicColorConfig?.effect ?? 'tone';
  const gradientAngle = typeof dynamicColorConfig?.gradientAngle === 'number' ? dynamicColorConfig.gradientAngle : 90;
  const dynamicSpeed = typeof dynamicColorConfig?.dynamicSpeed === 'number' ? dynamicColorConfig.dynamicSpeed : 6;

  const fillBackground =
    !dynamicColors || effect === 'tone'
      ? dynamicColors?.accentColor
      : buildCoverGradient(dynamicColors, gradientAngle);

  return (
    <div
      className={`progress-bar-component progress-bar-density-${skinProps.trackDensity} progress-bar-thumb-${skinProps.thumbVisibility}${
        skinProps.showTimeLabels ? '' : ' progress-bar-no-times'
      }${effect === 'gradient' ? ' progress-bar-gradient' : ''}${effect === 'dynamic' ? ' progress-bar-dynamic' : ''}`}
      style={
        dynamicColors
          ? ({
              '--progress-fill-color': dynamicColors.accentColor,
              '--progress-thumb-color': dynamicColors.accentColor,
              '--progress-fill-bg': fillBackground ?? dynamicColors.accentColor,
              '--progress-gradient-speed': `${dynamicSpeed}s`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {skinProps.showTimeLabels ? <span className="progress-time">{logic.formatTime(effectiveTime)}</span> : null}

      <div
        ref={progressBarRef}
        className="progress-bar-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="progress-bar-bg">
          {skinProps.bufferLayers === 'all' ? (
            <>
              <div className="progress-bar-buffered progress-bar-buffered-decode" style={{ width: `${decodeBuffered}%` }} />
              <div className="progress-bar-buffered progress-bar-buffered-output" style={{ width: `${outputBuffered}%` }} />
            </>
          ) : null}
          {skinProps.bufferLayers === 'single' ? (
            <div className="progress-bar-buffered progress-bar-buffered-single" style={{ width: `${buffered}%` }} />
          ) : null}
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          {skinProps.thumbVisibility === 'hidden' ? null : (
            <div className="progress-bar-thumb" style={{ left: `${progress}%` }} />
          )}
        </div>
      </div>

      {skinProps.showTimeLabels ? <span className="progress-time">{logic.formatTime(data.duration)}</span> : null}
    </div>
  );
};

