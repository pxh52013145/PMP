/**
 * ProgressBar 数据层 Hook
 * 负责获取播放时间数据
 */

import { useEffect, useRef, useState } from 'react';
import { Track } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { trackKey } from '../shared/trackKey';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';
import { isSameTrackRenderIdentity, sanitizeTrackForRuntime } from '../shared/sanitizeTrackForRuntime';

export interface ProgressBarData {
  currentTime: number;
  duration: number;
  /**
   * Best-effort buffered progress in range [0, 1].
   * For local decoded tracks this is typically 1, while streaming inputs report how far ahead the
   * decoder has produced contiguous PCM for the UI.
   */
  buffered: number;
  /**
   * Decode-reservoir buffered ratio [0, 1].
   */
  decodeBuffered: number;
  /**
   * Output/render-queue buffered ratio [0, 1].
   */
  outputBuffered: number;
  coverUrl?: string;
}

const clampRatio = (value: number): number => Math.max(0, Math.min(1, value));

const computeAheadRatio = (
  aheadSeconds: number | undefined,
  currentSeconds: number,
  totalSeconds: number,
  fallback: number
): number => {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return clampRatio(fallback);
  if (!Number.isFinite(currentSeconds)) return clampRatio(fallback);
  if (typeof aheadSeconds !== 'number' || !Number.isFinite(aheadSeconds)) return clampRatio(fallback);
  const absoluteBufferedTime = Math.max(0, currentSeconds + Math.max(0, aheadSeconds));
  return clampRatio(absoluteBufferedTime / totalSeconds);
};

export function useProgressBarData(isSeeking: boolean): ProgressBarData {
  const audioService = useAudioService();
  const lastTrackKeyRef = useRef<string>('none');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [decodeBuffered, setDecodeBuffered] = useState(0);
  const [outputBuffered, setOutputBuffered] = useState(0);
  const [track, setTrack] = useState<Track | null>(null);
  const coverUrl = useCoverUrlForTrack(track, { coverSizeHint: 'small' });
  const fallbackRef = useRef<{
    lastObservedTime: number;
    lastObservedAtMs: number;
    baseTime: number;
    baseAtMs: number;
  } | null>(null);

  useEffect(() => {
    const unsubscribeState = audioService.onStateChange((state) => {
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
      const nextBufferedTime = typeof state.bufferedTime === 'number' && isFinite(state.bufferedTime) ? state.bufferedTime : 0;
      const nextDuration = typeof state.duration === 'number' && isFinite(state.duration) ? state.duration : 0;
      const ratio = nextDuration > 0 ? clampRatio(nextBufferedTime / nextDuration) : 0;
      setBuffered(ratio);
      setDecodeBuffered(
        computeAheadRatio(state.decodeBufferedAhead, state.currentTime, nextDuration, ratio)
      );
      setOutputBuffered(
        computeAheadRatio(state.outputBufferedAhead, state.currentTime, nextDuration, ratio)
      );

      const nextTrack = sanitizeTrackForRuntime(state.currentTrack);
      const nextKey = trackKey(nextTrack);
      if (nextKey !== lastTrackKeyRef.current) {
        lastTrackKeyRef.current = nextKey;
        setTrack(nextTrack);
        fallbackRef.current = null;
        return;
      }

      setTrack((prev) => {
        if (!prev) return nextTrack;
        if (trackKey(prev) !== nextKey) return nextTrack;
        if (isSameTrackRenderIdentity(prev, nextTrack)) return prev;
        return nextTrack;
      });
    });

    const unsubscribeTime = audioService.onTimeUpdate((time) => {
      setCurrentTime(time);
    });

    const state = audioService.getState();
    setCurrentTime(state.currentTime);
    setDuration(state.duration);
    const bufferedTime = typeof state.bufferedTime === 'number' && isFinite(state.bufferedTime) ? state.bufferedTime : 0;
    const ratio = state.duration > 0 ? clampRatio(bufferedTime / state.duration) : 0;
    setBuffered(ratio);
    setDecodeBuffered(
      computeAheadRatio(state.decodeBufferedAhead, state.currentTime, state.duration, ratio)
    );
    setOutputBuffered(
      computeAheadRatio(state.outputBufferedAhead, state.currentTime, state.duration, ratio)
    );
    const initialTrack = sanitizeTrackForRuntime(state.currentTrack);
    setTrack(initialTrack);
    lastTrackKeyRef.current = trackKey(initialTrack);

    return () => {
      unsubscribeTime();
      unsubscribeState();
    };
  }, [audioService]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (isSeeking) return;

      const state = audioService.getState();
      const now = performance.now();

      const observedTime = Number(audioService.getCurrentTime()) || 0;
      const observedDuration = Number(audioService.getDuration()) || 0;
      if (isFinite(observedDuration) && observedDuration > 0) {
        setDuration(observedDuration);
      }

      if (!fallbackRef.current) {
        fallbackRef.current = {
          lastObservedTime: observedTime,
          lastObservedAtMs: now,
          baseTime: observedTime,
          baseAtMs: now,
        };
      }

      const fallback = fallbackRef.current;
      const timeAdvanced = Math.abs(observedTime - fallback.lastObservedTime) > 0.05;
      if (timeAdvanced) {
        fallback.lastObservedTime = observedTime;
        fallback.lastObservedAtMs = now;
        fallback.baseTime = observedTime;
        fallback.baseAtMs = now;
        setCurrentTime(observedTime);
        return;
      }

      // If engine says it's playing but currentTime isn't moving (missing backend ticks),
      // synthesize a local clock so UI remains responsive.
      if (state.playbackState === 'playing') {
        if (now - fallback.lastObservedAtMs > 650) {
          const predicted = fallback.baseTime + (now - fallback.baseAtMs) / 1000;
          const clamped =
            observedDuration > 0 ? Math.min(predicted, observedDuration) : predicted;
          if (isFinite(clamped) && Math.abs(clamped - currentTime) > 0.05) {
            setCurrentTime(clamped);
          }
        }
        return;
      }

      // Not playing: keep showing the observed time.
      setCurrentTime(observedTime);
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [audioService, currentTime, isSeeking]);

  return {
    currentTime,
    duration,
    buffered,
    decodeBuffered,
    outputBuffered,
    coverUrl,
  };
}
