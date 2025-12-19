/**
 * ProgressBar 数据层 Hook
 * 负责获取播放时间数据
 */

import { useEffect, useRef, useState } from 'react';
import { Track } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';

export interface ProgressBarData {
  currentTime: number;
  duration: number;
  buffered: number;
  coverUrl?: string;
}

export function useProgressBarData(isSeeking: boolean): ProgressBarData {
  const audioService = useAudioService();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const buffered = 0;
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined);
  const [track, setTrack] = useState<Track | null>(null);
  const fallbackRef = useRef<{
    lastObservedTime: number;
    lastObservedAtMs: number;
    baseTime: number;
    baseAtMs: number;
  } | null>(null);

  useEffect(() => {
    const unsubscribeState = audioService.onStateChange((state) => {
      if (!isSeeking) {
        setCurrentTime(state.currentTime);
      }
      setDuration(state.duration);
      setTrack(state.currentTrack);
      const nextCoverUrl = state.currentTrack?.coverUrl;
      if (typeof nextCoverUrl === 'string' && nextCoverUrl) {
        setCoverUrl(nextCoverUrl);
      }
    });

    const unsubscribeTime = audioService.onTimeUpdate((time) => {
      if (!isSeeking) {
        setCurrentTime(time);
      }
    });

    const state = audioService.getState();
    setCurrentTime(state.currentTime);
    setDuration(state.duration);
    setTrack(state.currentTrack);
    setCoverUrl(state.currentTrack?.coverUrl);

    return () => {
      unsubscribeTime();
      unsubscribeState();
    };
  }, [audioService, isSeeking]);

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

  useEffect(() => {
    let cancelled = false;
    const current = track;
    if (!current) return;

    void musicLibraryService.getCoverUrlForTrack(current).then((url) => {
      if (cancelled) return;
      if (!url) return;
      setCoverUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.filePath, track?.path]);

  return {
    currentTime,
    duration,
    buffered,
    coverUrl,
  };
}
