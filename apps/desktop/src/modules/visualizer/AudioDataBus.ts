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
const MAX_SOFT_CLOCK_CORRECTION_SEC = 0.05;

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

function synthesizeTimeDomain(
  frequency: Uint8Array,
  timestamp: number,
  energy: number,
  bass: number,
  mid: number
): Uint8Array {
  const length = Math.max(128, frequency.length || 256);
  const output = new Uint8Array(length);
  const phase = timestamp / 1000;
  const amplitude = clamp(0.08 + energy * 0.72, 0.08, 0.92);
  const bassShape = clamp(0.25 + bass * 1.2, 0.25, 1.4);
  const midShape = clamp(0.12 + mid * 0.7, 0.12, 0.9);

  for (let index = 0; index < length; index += 1) {
    const t = index / Math.max(1, length - 1);
    const low = Math.sin(t * Math.PI * 2 * bassShape + phase * 2.1);
    const harmonic = Math.sin(t * Math.PI * 2 * (3.1 + midShape * 2.4) + phase * 3.7) * 0.34;
    const shimmer = Math.sin(t * Math.PI * 2 * 11.2 + phase * 5.9) * 0.12;
    output[index] = Math.round(clamp(128 + (low + harmonic + shimmer) * 72 * amplitude, 0, 255));
  }

  return output;
}

function isAdvancingPlaybackState(state: AudioState['playbackState']): boolean {
  return state === 'playing' || state === 'buffering' || state === 'loading';
}

function createEmptySnapshot(state: AudioState, sampleRate = 0, timestamp = 0): VisualizerAudioSnapshot {
  const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
  const currentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const isPlaying = isAdvancingPlaybackState(state.playbackState);

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

  private smoothedFrequency: Uint8Array | null = null;

  private clockBaseTimeSec: number | null = null;

  private clockBaseTimestampMs: number | null = null;

  private clockPlaybackState: AudioState['playbackState'] | null = null;

  private clockLastServiceTimeSec: number | null = null;

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

  private smoothFrequencyData(source: Uint8Array): Uint8Array {
    if (source.length === 0) {
      this.smoothedFrequency = null;
      return source;
    }

    if (!this.smoothedFrequency || this.smoothedFrequency.length !== source.length) {
      this.smoothedFrequency = new Uint8Array(source);
      return new Uint8Array(source);
    }

    const target = this.smoothedFrequency;
    for (let index = 0; index < source.length; index += 1) {
      const previous = target[index] ?? 0;
      const next = source[index] ?? 0;
      target[index] = Math.round(previous * 0.62 + next * 0.38);
    }
    return new Uint8Array(target);
  }

  private resolveCurrentTime(
    state: AudioState,
    serviceCurrentTime: number,
    duration: number,
    timestamp: number
  ): { currentTime: number; isPlaying: boolean } {
    const serviceTime = Number.isFinite(serviceCurrentTime)
      ? Math.max(0, serviceCurrentTime)
      : Number.isFinite(state.currentTime)
        ? Math.max(0, state.currentTime)
        : 0;
    const isPlaying = isAdvancingPlaybackState(state.playbackState);
    const stateChanged = this.clockPlaybackState !== state.playbackState;
    const previousServiceTime = this.clockLastServiceTimeSec;
    const serviceTimeChanged = previousServiceTime === null || Math.abs(serviceTime - previousServiceTime) > 0.01;
    const serviceTimeMovedBackward = previousServiceTime !== null && serviceTime + 0.08 < previousServiceTime;
    this.clockLastServiceTimeSec = serviceTime;

    if (!isPlaying || !Number.isFinite(timestamp)) {
      this.clockBaseTimeSec = serviceTime;
      this.clockBaseTimestampMs = Number.isFinite(timestamp) ? timestamp : null;
      this.clockPlaybackState = state.playbackState;
      return { currentTime: serviceTime, isPlaying };
    }

    if (
      stateChanged ||
      this.clockBaseTimeSec === null ||
      this.clockBaseTimestampMs === null ||
      timestamp < this.clockBaseTimestampMs
    ) {
      this.clockBaseTimeSec = serviceTime;
      this.clockBaseTimestampMs = timestamp;
      this.clockPlaybackState = state.playbackState;
      return { currentTime: duration > 0 ? Math.min(serviceTime, duration) : serviceTime, isPlaying };
    }

    const predicted = this.clockBaseTimeSec + (timestamp - this.clockBaseTimestampMs) / 1000;
    const drift = Math.abs(serviceTime - predicted);

    if (serviceTimeMovedBackward || (serviceTimeChanged && serviceTime > predicted + 0.35)) {
      this.clockBaseTimeSec = serviceTime;
      this.clockBaseTimestampMs = timestamp;
      this.clockPlaybackState = state.playbackState;
      return { currentTime: duration > 0 ? Math.min(serviceTime, duration) : serviceTime, isPlaying };
    }

    if (serviceTimeChanged && drift <= 0.08) {
      this.clockBaseTimeSec = serviceTime;
      this.clockBaseTimestampMs = timestamp;
    }

    const correction =
      serviceTimeChanged && drift > 0.08
        ? clamp(serviceTime - predicted, -MAX_SOFT_CLOCK_CORRECTION_SEC, MAX_SOFT_CLOCK_CORRECTION_SEC)
        : 0;
    const corrected = predicted + correction;
    if (correction !== 0) {
      this.clockBaseTimeSec = corrected;
      this.clockBaseTimestampMs = timestamp;
    }

    const currentTime = duration > 0 ? Math.min(corrected, duration) : corrected;
    return { currentTime: Math.max(0, currentTime), isPlaying };
  }

  sample(timestamp = performance.now()): VisualizerAudioSnapshot {
    try {
      const state = this.audioService.getState();
      const spectrumFrame = this.getSpectrumFrame(this.spectrumTap);
      const frequencySource = spectrumFrame?.bins ?? this.getFrequencyData();
      const frequency = this.smoothFrequencyData(frequencySource ? new Uint8Array(frequencySource) : new Uint8Array(0));
      const liveCurrentTime = this.audioService.getCurrentTime();
      const liveDuration = this.audioService.getDuration();
      const duration = Number.isFinite(liveDuration)
        ? Math.max(0, liveDuration)
        : Number.isFinite(state.duration)
          ? Math.max(0, state.duration)
          : 0;
      const { currentTime, isPlaying } = this.resolveCurrentTime(state, liveCurrentTime, duration, timestamp);
      const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
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
        timeDomain: synthesizeTimeDomain(frequency, timestamp, energy, bass, mid),
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
