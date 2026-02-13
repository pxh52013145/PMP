/**
 * ProgressBar 变体：标准进度条
 * 当前的默认实现
 */

import React, { useMemo, useRef, useState } from 'react';
import { ProgressBarVariantProps } from './ProgressBarTypes';
import { buildCoverGradient } from '../shared/useDynamicColor';
import './StandardProgressBar.css';

export const StandardProgressBar: React.FC<ProgressBarVariantProps> = ({
  data,
  logic,
  dynamicColors,
  dynamicColorConfig,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const latestSeekTimeRef = useRef<number | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);

  const getTimeFromClientX = (clientX: number) => {
    if (!progressBarRef.current || !data.duration) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * data.duration;

    return newTime;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!data.duration) return;

    progressBarRef.current?.setPointerCapture(e.pointerId);
    logic.onSeekStart();
    isDraggingRef.current = true;

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

  const endDrag = () => {
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

  const effect = dynamicColorConfig?.effect ?? 'tone';
  const gradientAngle = typeof dynamicColorConfig?.gradientAngle === 'number' ? dynamicColorConfig.gradientAngle : 90;
  const dynamicSpeed = typeof dynamicColorConfig?.dynamicSpeed === 'number' ? dynamicColorConfig.dynamicSpeed : 6;

  const fillBackground =
    !dynamicColors || effect === 'tone'
      ? dynamicColors?.accentColor
      : buildCoverGradient(dynamicColors, gradientAngle);

  return (
    <div
      className={`progress-bar-component${effect === 'gradient' ? ' progress-bar-gradient' : ''}${effect === 'dynamic' ? ' progress-bar-dynamic' : ''}`}
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
      <span className="progress-time">{logic.formatTime(effectiveTime)}</span>

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
          <div className="progress-bar-buffered" style={{ width: `${buffered}%` }} />
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          <div className="progress-bar-thumb" style={{ left: `${progress}%` }} />
        </div>
      </div>

      <span className="progress-time">{logic.formatTime(data.duration)}</span>
    </div>
  );
};
