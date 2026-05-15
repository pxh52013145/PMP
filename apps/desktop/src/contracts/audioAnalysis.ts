export type AudioAnalysisPriority = 'current' | 'next' | 'background';

export interface AudioPeakRmsSegment {
  min: number;
  max: number;
  peak: number;
  rms: number;
}

export interface AudioPeakRmsAnalysis {
  version: number;
  segmentCount: number;
  duration: number;
  sampleRate: number;
  channels: number;
  frameCount: number;
  decodedFrames: number;
  analyzedSamples: number;
  elapsedMs: number;
  segments: AudioPeakRmsSegment[];
}

export interface AudioAnalysisRequestOptions {
  segmentCount?: number;
  priority?: AudioAnalysisPriority;
  reason?: string;
}

export interface AudioAnalysisTrackIdentity {
  key: string;
  trackId: string;
  sourcePath: string;
  normalizedPath: string;
  fileSize: number | null;
  mtimeMs: number | null;
  duration: number | null;
  segmentCount: number;
  version: number;
}
