import type { AudioState, IAudioService } from '../../services/audio';
import type { AudioSpectrumFrame, AudioSpectrumTap } from '../../services/audio/types';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type {
  VisualizerAnalysisSnapshot,
  VisualizerAudioAdapter,
  VisualizerAudioSnapshot,
  VisualizerTrackSnapshot,
} from './types';

const telemetry = getTelemetryLogger('visualizer', 'AudioDataBus');

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeTrack(track: AudioState['currentTrack']): VisualizerTrackSnapshot | null {
  if (!track) return null;

  const title = typeof track.title === 'string' ? track.title.trim() : '';
  const artist = typeof track.artist === 'string' ? track.artist.trim() : '';
  const album = typeof track.album === 'string' ? track.album.trim() : '';
  const coverUrl = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
  const lyrics = typeof track.lyrics === 'string' ? track.lyrics.trim() : '';

  if (!title && !artist && !album) {
    return null;
  }

  return {
    title: title || artist || album || 'Unknown track',
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(lyrics ? { lyrics } : {}),
  };
}

function computeAverage(values: Uint8Array, start: number, end: number): number {
  const safeStart = Math.max(0, Math.min(values.length, start));
  const safeEnd = Math.max(safeStart + 1, Math.min(values.length, end));
  let total = 0;
  let count = 0;
  for (let index = safeStart; index < safeEnd; index += 1) {
    total += values[index] ?? 0;
    count += 1;
  }
  return count > 0 ? total / count / 255 : 0;
}

function computePeak(values: Uint8Array): { bin: number; value: number } {
  let bin = 0;
  let value = 0;
  values.forEach((entry, index) => {
    if (entry > value) {
      value = entry;
      bin = index;
    }
  });
  return { bin, value: value / 255 };
}

function computeSpectralCentroid(values: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const normalized = (values[index] ?? 0) / 255;
    weighted += normalized * index;
    total += normalized;
  }
  if (total <= 0) return 0;
  return clamp(weighted / total / Math.max(1, values.length - 1), 0, 1);
}

function createEmptySnapshot(state: AudioState, sampleRate = 0, timestamp = 0): VisualizerAudioSnapshot {
  const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
  const currentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const isPlaying = state.playbackState === 'playing' || state.playbackState === 'buffering' || state.playbackState === 'loading';

  return {
    frequency: new Uint8Array(0),
    timeDomain: new Uint8Array(0),
    spectrumFrame: null,
    analysis: {
      energy: 0,
      smoothedEnergy: 0,
      energyDelta: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      spectralCentroid: 0,
      peakBin: 0,
      peakValue: 0,
      beatPhase: 0,
      beatStrength: 0,
    },
    playback: {
      currentTime,
      duration,
      progress,
      isPlaying,
      sampleRate,
      playbackState: state.playbackState,
    },
    track: normalizeTrack(state.currentTrack),
    timestamp,
  };
}

export class AudioDataBus implements VisualizerAudioAdapter {
  private readonly listeners = new Set<(snapshot: VisualizerAudioSnapshot) => void>();

  private lastSnapshot: VisualizerAudioSnapshot | null = null;

  private smoothedEnergy = 0;

  private readonly spectrumTap: AudioSpectrumTap;

  constructor(
    private readonly audioService: IAudioService,
    options: {
      spectrumTap?: AudioSpectrumTap;
    } = {}
  ) {
    this.spectrumTap = options.spectrumTap ?? 'post-dsp';
  }

  getState(): AudioState {
    return this.audioService.getState();
  }

  getFrequencyData(): Uint8Array | null {
    return this.audioService.getFrequencyData?.() ?? null;
  }

  getSpectrumFrame(tap?: AudioSpectrumTap): AudioSpectrumFrame | null {
    return this.audioService.getSpectrumFrame?.(tap ?? this.spectrumTap) ?? null;
  }

  getSnapshot(): VisualizerAudioSnapshot {
    return this.lastSnapshot ?? this.sample();
  }

  subscribe(listener: (snapshot: VisualizerAudioSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sample(timestamp = performance.now()): VisualizerAudioSnapshot {
    try {
      const state = this.audioService.getState();
      const spectrumFrame = this.getSpectrumFrame(this.spectrumTap);
      const frequencySource = spectrumFrame?.bins ?? this.getFrequencyData();
      const frequency = frequencySource ? new Uint8Array(frequencySource) : new Uint8Array(0);
      const currentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
      const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
      const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
      const isPlaying =
        state.playbackState === 'playing' ||
        state.playbackState === 'buffering' ||
        state.playbackState === 'loading';
      const energy = frequency.length > 0 ? computeAverage(frequency, 0, frequency.length) : 0;
      const bass = frequency.length > 0 ? computeAverage(frequency, 0, Math.max(4, Math.floor(frequency.length * 0.14))) : 0;
      const mid = frequency.length > 0 ? computeAverage(frequency, Math.floor(frequency.length * 0.14), Math.floor(frequency.length * 0.52)) : 0;
      const treble = frequency.length > 0 ? computeAverage(frequency, Math.floor(frequency.length * 0.52), frequency.length) : 0;
      const peak = computePeak(frequency);
      const centroid = computeSpectralCentroid(frequency);
      const previousEnergy = this.lastSnapshot?.analysis.smoothedEnergy ?? 0;
      this.smoothedEnergy = this.lastSnapshot
        ? this.smoothedEnergy * 0.82 + energy * 0.18
        : energy;
      const energyDelta = this.smoothedEnergy - previousEnergy;
      const beatStrength = clamp(this.smoothedEnergy * 1.25 + Math.max(0, energyDelta) * 0.8, 0, 1);
      const beatPhase = ((timestamp / 520) + this.smoothedEnergy * 2.8) % 1;

      const snapshot: VisualizerAudioSnapshot = {
        frequency,
        timeDomain: spectrumFrame ? new Uint8Array(spectrumFrame.bins) : new Uint8Array(frequency.length),
        spectrumFrame,
        analysis: {
          energy,
          smoothedEnergy: this.smoothedEnergy,
          energyDelta,
          bass,
          mid,
          treble,
          spectralCentroid: centroid,
          peakBin: peak.bin,
          peakValue: peak.value,
          beatPhase,
          beatStrength,
        } satisfies VisualizerAnalysisSnapshot,
        playback: {
          currentTime,
          duration,
          progress,
          isPlaying,
          sampleRate: spectrumFrame?.sampleRate ?? 0,
          playbackState: state.playbackState,
        },
        track: normalizeTrack(state.currentTrack),
        timestamp,
      };

      this.lastSnapshot = snapshot;
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          telemetry.warn('audio_data_bus.listener.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return snapshot;
    } catch (error) {
      telemetry.warn('audio_data_bus.sample.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      const fallback = createEmptySnapshot(this.audioService.getState(), 0, timestamp);
      this.lastSnapshot = fallback;
      return fallback;
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
