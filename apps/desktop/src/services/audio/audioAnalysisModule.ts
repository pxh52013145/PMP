import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import type { AudioState, Track } from './types';
import {
  AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT,
  AUDIO_ANALYSIS_SERVICE_TOKEN,
  DefaultAudioAnalysisService,
  audioAnalysisPriorityRank,
  resolveAudioAnalysisTrackIdentity,
} from './audioAnalysisService';
import type { AudioAnalysisPriority } from '../../contracts/audioAnalysis';

const NEXT_TRACK_PREHEAT_COUNT = 1;
const PREHEAT_DEDUPE_WINDOW_MS = 60_000;
const RECENT_PREHEAT_LIMIT = 64;

interface RecentPreheatIntent {
  priority: AudioAnalysisPriority;
  requestedAt: number;
}

export function collectAudioAnalysisPreheatTargets(state: AudioState): Array<{
  track: Track;
  priority: 'current' | 'next';
  reason: string;
}> {
  const targets: Array<{ track: Track; priority: 'current' | 'next'; reason: string }> = [];
  if (state.currentTrack) {
    targets.push({
      track: state.currentTrack,
      priority: 'current',
      reason: 'current-track',
    });
  }

  for (const track of state.queue.slice(
    state.currentIndex + 1,
    state.currentIndex + 1 + NEXT_TRACK_PREHEAT_COUNT
  )) {
    targets.push({
      track,
      priority: 'next',
      reason: 'queue-next',
    });
  }
  return targets;
}

export function createAudioAnalysisModule(options: {
  enablePreheat?: boolean;
} = {}): KernelModule<AppEvents> {
  const enablePreheat = options.enablePreheat !== false;
  return {
    id: 'audio-analysis',
    activate: ({ services, events }) => {
      const service = new DefaultAudioAnalysisService();
      const unregister = services.register(AUDIO_ANALYSIS_SERVICE_TOKEN, service);
      const recentPreheatKeys = new Map<string, RecentPreheatIntent>();

      const shouldPreheat = (key: string, priority: AudioAnalysisPriority): boolean => {
        const now = Date.now();
        const previous = recentPreheatKeys.get(key);
        if (
          previous &&
          now - previous.requestedAt < PREHEAT_DEDUPE_WINDOW_MS &&
          audioAnalysisPriorityRank(previous.priority) >= audioAnalysisPriorityRank(priority)
        ) {
          return false;
        }
        recentPreheatKeys.delete(key);
        recentPreheatKeys.set(key, { priority, requestedAt: now });
        if (recentPreheatKeys.size > RECENT_PREHEAT_LIMIT) {
          const first = recentPreheatKeys.keys().next().value as string | undefined;
          if (first) recentPreheatKeys.delete(first);
        }
        return true;
      };

      const unsubscribe = events.on('audio/stateChanged', (state) => {
        if (!enablePreheat) return;
        if (!isTauriRuntime()) return;
        for (const target of collectAudioAnalysisPreheatTargets(state)) {
          const identity = resolveAudioAnalysisTrackIdentity(
            target.track,
            AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT
          );
          if (!identity || !shouldPreheat(identity.key, target.priority)) continue;
          void service.requestPeakRms(target.track, {
            priority: target.priority,
            reason: target.reason,
          });
        }
      });

      return () => {
        unsubscribe();
        unregister();
        service.destroy();
      };
    },
  };
}
