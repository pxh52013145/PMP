/**
 * ProgressBar 数据层 Hook
 * 负责获取播放时间数据
 */

import { useEffect, useRef, useState } from 'react';
import { Track } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { trackKey } from '../shared/trackKey';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';

export interface ProgressBarData {
  currentTime: number;
  duration: number;
  /**
   * Best-effort buffered progress in range [0, 1].
   * For local decoded tracks this is typically 1, while streaming inputs report how far ahead the
   * decoder has produced contiguous PCM for the UI.
   */
  buffered: number;
  coverUrl?: string;
}

export function useProgressBarData(isSeeking: boolean): ProgressBarData {
  const audioService = useAudioService();
  const lastTrackKeyRef = useRef<string>('none');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [track, setTrack] = useState<Track | null>(null);
  const coverUrl = useCoverUrlForTrack(track);
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
      const ratio = nextDuration > 0 ? Math.max(0, Math.min(1, nextBufferedTime / nextDuration)) : 0;
      setBuffered(ratio);

      const nextTrack = state.currentTrack;
      const nextKey = trackKey(nextTrack);
      if (nextKey !== lastTrackKeyRef.current) {
        lastTrackKeyRef.current = nextKey;
        setTrack(nextTrack);
        fallbackRef.current = null;
        return;
      }

      const nextCoverUrl = nextTrack?.coverUrl;
      if (typeof nextCoverUrl === 'string' && nextCoverUrl) {
        setTrack((prev) => {
          if (!prev || trackKey(prev) !== nextKey) return nextTrack;
          if (prev.coverUrl === nextCoverUrl) return prev;
          return { ...prev, coverUrl: nextCoverUrl };
        });
      }
    });

    const unsubscribeTime = audioService.onTimeUpdate((time) => {
      setCurrentTime(time);
    });

    const state = audioService.getState();
    setCurrentTime(state.currentTime);
    setDuration(state.duration);
    const bufferedTime = typeof state.bufferedTime === 'number' && isFinite(state.bufferedTime) ? state.bufferedTime : 0;
    const ratio = state.duration > 0 ? Math.max(0, Math.min(1, bufferedTime / state.duration)) : 0;
    setBuffered(ratio);
    setTrack(state.currentTrack);
    lastTrackKeyRef.current = trackKey(state.currentTrack);

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
    coverUrl,
  };
}
