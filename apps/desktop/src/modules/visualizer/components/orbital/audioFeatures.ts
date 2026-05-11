import type { VisualizerAudioSnapshot } from '../../types';
import { ORBITAL_CHORDS, ORBITAL_CHORDS_CHROMATIC } from './styleModel';
import { clamp } from '../../CoordinateSystem';

export const CHROMATIC_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface TonalityFeatures {
  chroma: Float32Array;
  keyChroma: Float32Array;
  chord: string;
  key: string;
  energy: number;
}

export function resolveChordIntensity(chroma: Float32Array, chordIndex: number, fallbackProgress = 0): number {
  const chromaticIndex = ORBITAL_CHORDS_CHROMATIC[chordIndex] ?? 0;
  const liveIntensity = chroma[chromaticIndex] ?? 0;
  if (liveIntensity > 0.02) return clamp(liveIntensity, 0, 1);
  const fallbackIndex = Math.floor(fallbackProgress * ORBITAL_CHORDS.length) % ORBITAL_CHORDS.length;
  return chordIndex === fallbackIndex ? 0.72 : 0;
}

export function resolvePeakFrequency(snapshot: VisualizerAudioSnapshot): number {
  const bins = snapshot.frequency;
  if (bins.length === 0) return 0;

  let maxBin = 0;
  let maxValue = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const value = bins[index] ?? 0;
    if (value > maxValue) {
      maxValue = value;
      maxBin = index;
    }
  }

  const sampleRate = snapshot.playback.sampleRate || snapshot.spectrumFrame?.sampleRate || 44_100;
  const fftSize = Math.max(1, bins.length * 2);
  return Math.round((maxBin * sampleRate) / fftSize);
}

export class TonalityTracker {
  private readonly chroma = new Float32Array(12);

  private readonly smoothedChroma = new Float32Array(12);

  private readonly keyChroma = new Float32Array(12);

  private chord = 'N/A';

  private key = 'SCANNING...';

  update(snapshot: VisualizerAudioSnapshot): TonalityFeatures {
    const bins = snapshot.frequency;
    const sampleRate = snapshot.playback.sampleRate || snapshot.spectrumFrame?.sampleRate || 44_100;
    const fftSize = Math.max(1, bins.length * 2);
    const binHz = sampleRate / fftSize;
    let totalEnergy = 0;

    this.chroma.fill(0);

    for (let index = 1; index < bins.length; index += 1) {
      const raw = bins[index] ?? 0;
      totalEnergy += raw;
      const frequency = index * binHz;
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
      maxChroma = Math.max(maxChroma, this.chroma[index] ?? 0);
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

    if (energy <= 0.01) {
      return {
        chroma: this.smoothedChroma,
        keyChroma: this.keyChroma,
        chord: this.chord,
        key: this.key,
        energy,
      };
    }

    this.resolveChord();
    this.resolveKey();

    return {
      chroma: this.smoothedChroma,
      keyChroma: this.keyChroma,
      chord: this.chord,
      key: this.key,
      energy,
    };
  }

  reset(): void {
    this.chroma.fill(0);
    this.smoothedChroma.fill(0);
    this.keyChroma.fill(0);
    this.chord = 'N/A';
    this.key = 'SCANNING...';
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
        this.chord = `${CHROMATIC_NOTES[root]} Maj`;
      }
      if (minorScore > maxScore) {
        maxScore = minorScore;
        this.chord = `${CHROMATIC_NOTES[root]} Min`;
      }
    }
  }

  private resolveKey(): void {
    let maxScore = -1;
    for (let root = 0; root < 12; root += 1) {
      let majorScore = 0;
      let minorScore = 0;
      for (let index = 0; index < 12; index += 1) {
        const value = this.keyChroma[(root + index) % 12] ?? 0;
        majorScore += (MAJOR_PROFILE[index] ?? 0) * value;
        minorScore += (MINOR_PROFILE[index] ?? 0) * value;
      }

      if (majorScore > maxScore) {
        maxScore = majorScore;
        this.key = `${CHROMATIC_NOTES[root]} Maj/Ion`;
      }
      if (minorScore > maxScore) {
        maxScore = minorScore;
        this.key = `${CHROMATIC_NOTES[root]} Min/Aeo`;
      }
    }
  }
}
