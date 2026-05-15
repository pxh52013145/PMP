import type { VisualizerAudioSnapshot } from '../../types';
import { CHROMATIC_NOTES, MAJOR_PROFILE, MINOR_PROFILE, CHORDS, CHORDS_CHROMATIC } from './styleModel';

export interface ReferenceTonalityFeatures {
  chroma: Float32Array;
  keyChroma: Float32Array;
  chord: string;
  key: string;
}

function resolveSampleRate(snapshot: VisualizerAudioSnapshot): number {
  return snapshot.playback.sampleRate || snapshot.spectrumFrame?.sampleRate || 44_100;
}

export function resolvePeakFrequency(snapshot: VisualizerAudioSnapshot): { frequency: number; value: number } {
  const bins = snapshot.frequency;
  if (bins.length === 0) return { frequency: 0, value: 0 };

  let maxBin = 0;
  let maxValue = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const value = bins[index] ?? 0;
    if (value > maxValue) {
      maxValue = value;
      maxBin = index;
    }
  }

  const fftSize = Math.max(1, bins.length * 2);
  return {
    frequency: Math.round((maxBin * resolveSampleRate(snapshot)) / fftSize),
    value: maxValue,
  };
}

export function resolveChordIntensity(
  chroma: Float32Array,
  chordIndex: number,
  fallbackCurrentChordIndex: number
): number {
  const chromaticIndex = CHORDS_CHROMATIC[chordIndex] ?? 0;
  const liveIntensity = chroma[chromaticIndex] ?? 0;
  if (liveIntensity > 0.02) return liveIntensity;
  return chordIndex === fallbackCurrentChordIndex ? 1 : 0;
}

export class ReferenceTonalityTracker {
  private readonly chroma = new Float32Array(12);

  private readonly smoothedChroma = new Float32Array(12);

  private readonly keyChroma = new Float32Array(12);

  private detectedChord = 'N/A';

  private detectedKey = 'SCANNING...';

  update(snapshot: VisualizerAudioSnapshot): ReferenceTonalityFeatures {
    const bins = snapshot.frequency;
    const sampleRate = resolveSampleRate(snapshot);
    const fftSize = Math.max(1, bins.length * 2);
    const frequencyStep = sampleRate / fftSize;
    let totalEnergy = 0;

    this.chroma.fill(0);

    for (let index = 1; index < bins.length; index += 1) {
      const raw = bins[index] ?? 0;
      totalEnergy += raw;
      const frequency = index * frequencyStep;
      if (frequency < 45 || frequency > 4000) continue;

      const magnitude = raw / 255;
      if (magnitude <= 0.05) continue;

      const notePitch = 69 + 12 * Math.log2(frequency / 440);
      const pitchClass = (Math.round(notePitch) % 12 + 12) % 12;
      this.chroma[pitchClass] += magnitude;
    }

    const energy = bins.length > 0 ? totalEnergy / (bins.length * 255) : snapshot.analysis.smoothedEnergy;
    let maxChroma = 0;
    for (let index = 0; index < 12; index += 1) {
      if ((this.chroma[index] ?? 0) > maxChroma) {
        maxChroma = this.chroma[index] ?? 0;
      }
    }

    if (maxChroma > 0) {
      for (let index = 0; index < 12; index += 1) {
        this.chroma[index] = (this.chroma[index] ?? 0) / maxChroma;
      }
    }

    for (let index = 0; index < 12; index += 1) {
      this.smoothedChroma[index] = (this.smoothedChroma[index] ?? 0) * 0.7 + (this.chroma[index] ?? 0) * 0.3;
      if (energy > 0.01) {
        this.keyChroma[index] = (this.keyChroma[index] ?? 0) * 0.995 + (this.chroma[index] ?? 0) * 0.005;
      }
    }

    if (energy > 0.01) {
      this.resolveChord();
      this.resolveKey();
    }

    return {
      chroma: this.smoothedChroma,
      keyChroma: this.keyChroma,
      chord: this.detectedChord,
      key: this.detectedKey,
    };
  }

  reset(): void {
    this.chroma.fill(0);
    this.smoothedChroma.fill(0);
    this.keyChroma.fill(0);
    this.detectedChord = 'N/A';
    this.detectedKey = 'SCANNING...';
  }

  private resolveChord(): void {
    let maxScore = -1;
    for (let root = 0; root < 12; root += 1) {
      const majorScore =
        (this.smoothedChroma[root] ?? 0) +
        (this.smoothedChroma[(root + 4) % 12] ?? 0) +
        (this.smoothedChroma[(root + 7) % 12] ?? 0);
      const minorScore =
        (this.smoothedChroma[root] ?? 0) +
        (this.smoothedChroma[(root + 3) % 12] ?? 0) +
        (this.smoothedChroma[(root + 7) % 12] ?? 0);

      if (majorScore > maxScore) {
        maxScore = majorScore;
        this.detectedChord = `${CHROMATIC_NOTES[root]} Maj`;
      }
      if (minorScore > maxScore) {
        maxScore = minorScore;
        this.detectedChord = `${CHROMATIC_NOTES[root]} Min`;
      }
    }
  }

  private resolveKey(): void {
    let maxScore = -1;
    for (let root = 0; root < 12; root += 1) {
      let majorScore = 0;
      let minorScore = 0;
      for (let index = 0; index < 12; index += 1) {
        const absChroma = this.keyChroma[(root + index) % 12] ?? 0;
        majorScore += (MAJOR_PROFILE[index] ?? 0) * absChroma;
        minorScore += (MINOR_PROFILE[index] ?? 0) * absChroma;
      }
      if (majorScore > maxScore) {
        maxScore = majorScore;
        this.detectedKey = `${CHROMATIC_NOTES[root]} Maj/Ion`;
      }
      if (minorScore > maxScore) {
        maxScore = minorScore;
        this.detectedKey = `${CHROMATIC_NOTES[root]} Min/Aeo`;
      }
    }
  }
}

export function resolveFallbackChordIndex(currentTime: number): number {
  return Math.floor(currentTime / 5) % CHORDS.length;
}
