import type {
  VisualizerComponent,
  VisualizerComponentContext,
  VisualizerComponentDefinition,
  VisualizerFrameInfo,
  VisualizerHitBounds,
  VisualizerRenderContext,
} from '../../types';
import { ReferenceTonalityTracker, type ReferenceTonalityFeatures } from './audioFeatures';
import {
  createReferenceCircularGeometry,
  createReferenceDefaultTransform,
  createReferenceHudGeometry,
  createReferenceManifest,
  REFERENCE_COMPONENT_IDS,
  type ReferenceComponentId,
} from './styleModel';
import {
  drawReferenceCenter,
  drawReferenceChords,
  drawReferenceFrequency,
  drawReferenceHud,
  drawReferenceMorse,
  drawReferenceParticles,
  drawReferencePhase,
  drawReferenceProgress,
  drawReferenceProgressTooltip,
  createReferenceProgressSpectrumState,
  createReferenceSpectrumSmoothingState,
  updateReferenceMorseArcs,
  updateReferenceProgressSpectrum,
  updateReferenceSpectrumSmoothing,
  type ReferenceMorseArc,
  type ReferenceParticle,
  type ReferenceProgressSpectrumState,
  type ReferenceSpectrumSmoothingState,
} from './renderers';

interface TonalityState {
  tracker: ReferenceTonalityTracker;
  features: ReferenceTonalityFeatures;
}

function createTonalityState(): TonalityState {
  const tracker = new ReferenceTonalityTracker();
  return {
    tracker,
    features: tracker.update({
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
        currentTime: 0,
        duration: 0,
        progress: 0,
        isPlaying: false,
        sampleRate: 44_100,
        playbackState: 'idle',
      },
      track: null,
      timestamp: 0,
    }),
  };
}

function makeReferenceDefinition(options: {
  id: ReferenceComponentId;
  name: string;
  description: string;
  tags: string[];
  zIndex: number;
  geometry?: 'circular' | 'hud';
  capabilities: Array<{ id: 'audio.playback' | 'audio.state' | 'audio.spectrum' | 'audio.analysis'; required: boolean; reason?: string }>;
  draw: (frame: VisualizerFrameInfo, ctx: VisualizerRenderContext, state: unknown) => void;
  createState?: () => unknown;
  disposeState?: (state: unknown) => void;
}): VisualizerComponentDefinition {
  const geometry =
    options.geometry === 'hud' ? createReferenceHudGeometry() : createReferenceCircularGeometry();
  const manifest = createReferenceManifest({
    id: options.id,
    name: options.name,
    description: options.description,
    tags: options.tags,
    geometry,
    defaultTransform: createReferenceDefaultTransform(options.id, options.zIndex),
    capabilities: options.capabilities,
  });

  return {
    manifest,
    create(): VisualizerComponent {
      const state = options.createState?.();
      return {
        manifest,
        initialize(_ctx: VisualizerComponentContext) {
          // no-op
        },
        render(frame: VisualizerFrameInfo, ctx: VisualizerRenderContext) {
          options.draw(frame, ctx, state);
        },
        dispose() {
          options.disposeState?.(state);
        },
        getHitBounds(): VisualizerHitBounds {
          if (manifest.geometry.type === 'rectangular') {
            return { type: 'rect', width: 320, height: 90 };
          }
          return { type: 'circle', radius: 420 };
        },
      };
    },
  };
}

function createPhaseDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.phase,
    name: 'Phase',
    description: 'Reference demo vectorscope diamond.',
    tags: ['audio', 'phase', 'reference'],
    zIndex: 0,
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'Phase uses sampled waveform data from the audio pipeline.' },
      { id: 'audio.analysis', required: true, reason: 'Phase glow reacts to energy.' },
    ],
    draw: (frame, ctx) => drawReferencePhase(ctx.ctx, frame, ctx),
  });
}

function createFrequencyDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.freq,
    name: 'Freq',
    description: 'Reference demo outer frequency ring.',
    tags: ['audio', 'frequency', 'reference'],
    zIndex: 1,
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'Frequency ring reads live frequency bins.' },
    ],
    createState: createReferenceSpectrumSmoothingState,
    draw: (frame, ctx, state) => {
      const smoothing = state as ReferenceSpectrumSmoothingState;
      updateReferenceSpectrumSmoothing(smoothing, ctx, frame, 0.42);
      drawReferenceFrequency(ctx.ctx, frame, ctx, smoothing);
    },
  });
}

function createChordsDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.chords,
    name: 'Chords',
    description: 'Reference demo circle-of-fifths chord ring.',
    tags: ['audio', 'tonality', 'reference'],
    zIndex: 2,
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'Chord ring resolves chroma from frequency bins.' },
      { id: 'audio.analysis', required: true, reason: 'Chord fallback reacts to playback time.' },
    ],
    createState: createTonalityState,
    disposeState: (state) => (state as TonalityState | undefined)?.tracker.reset(),
    draw: (_frame, ctx, state) => {
      const tonal = state as TonalityState;
      tonal.features = tonal.tracker.update(ctx.audioSnapshot);
      drawReferenceChords(ctx.ctx, _frame, ctx, tonal.features);
    },
  });
}

function createProgressDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.progress,
    name: 'Progress',
    description: 'Reference demo circular progress spectrum.',
    tags: ['audio', 'progress', 'reference'],
    zIndex: 3,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'Progress reads playback time and duration.' },
      { id: 'audio.analysis', required: false, reason: 'Progress uses a cached per-track visual profile when available.' },
      { id: 'audio.spectrum', required: false, reason: 'Progress falls back to live spectrum while a profile is pending.' },
    ],
    createState: createReferenceProgressSpectrumState,
    draw: (_frame, ctx, state) => {
      const progressState = state as ReferenceProgressSpectrumState;
      updateReferenceProgressSpectrum(progressState, ctx);
      drawReferenceProgress(ctx.ctx, ctx, progressState);
      drawReferenceProgressTooltip(ctx.ctx, ctx);
    },
  });
}

function createParticlesDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.particles,
    name: 'Particles',
    description: 'Reference demo progress-head particle trail.',
    tags: ['audio', 'particles', 'reference'],
    zIndex: 4,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'Particles emit from the playback head.' },
      { id: 'audio.analysis', required: true, reason: 'Particles react to track energy.' },
    ],
    createState: () => [] as ReferenceParticle[],
    draw: (_frame, ctx, state) => drawReferenceParticles(ctx.ctx, ctx, state as ReferenceParticle[]),
  });
}

function createMorseDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.morse,
    name: 'Morse',
    description: 'Reference demo outer Morse telemetry arcs.',
    tags: ['audio', 'morse', 'reference'],
    zIndex: 5,
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'Morse arcs encode peak frequency telemetry.' },
    ],
    createState: () => [] as ReferenceMorseArc[],
    draw: (frame, ctx, state) => {
      const arcs = state as ReferenceMorseArc[];
      updateReferenceMorseArcs(ctx, frame, arcs);
      drawReferenceMorse(ctx.ctx, ctx, arcs);
    },
  });
}

function createCenterDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.center,
    name: 'Center',
    description: 'Reference demo central clock and tonality display.',
    tags: ['audio', 'center', 'reference'],
    zIndex: 6,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'Center display reads playback state and time.' },
      { id: 'audio.spectrum', required: true, reason: 'Center display resolves chord and key from frequency bins.' },
    ],
    createState: createTonalityState,
    disposeState: (state) => (state as TonalityState | undefined)?.tracker.reset(),
    draw: (_frame, ctx, state) => {
      const tonal = state as TonalityState;
      tonal.features = tonal.tracker.update(ctx.audioSnapshot);
      drawReferenceCenter(ctx.ctx, ctx, tonal.features);
    },
  });
}

function createHudDefinition(): VisualizerComponentDefinition {
  return makeReferenceDefinition({
    id: REFERENCE_COMPONENT_IDS.hud,
    name: 'Hud',
    description: 'Reference demo angular waveform HUD.',
    tags: ['audio', 'hud', 'reference'],
    zIndex: 7,
    geometry: 'hud',
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'HUD waveform reads low and mid frequency bins.' },
    ],
    createState: createReferenceSpectrumSmoothingState,
    draw: (frame, ctx, state) => {
      const smoothing = state as ReferenceSpectrumSmoothingState;
      updateReferenceSpectrumSmoothing(smoothing, ctx, frame, 0.48);
      drawReferenceHud(ctx.ctx, frame, ctx, smoothing);
    },
  });
}

const REFERENCE_PHASE_COMPONENT = createPhaseDefinition();
const REFERENCE_FREQ_COMPONENT = createFrequencyDefinition();
const REFERENCE_CHORDS_COMPONENT = createChordsDefinition();
const REFERENCE_PROGRESS_COMPONENT = createProgressDefinition();
const REFERENCE_PARTICLES_COMPONENT = createParticlesDefinition();
const REFERENCE_MORSE_COMPONENT = createMorseDefinition();
const REFERENCE_CENTER_COMPONENT = createCenterDefinition();
const REFERENCE_HUD_COMPONENT = createHudDefinition();

export const REFERENCE_VISUALIZER_COMPONENT_DEFINITIONS: VisualizerComponentDefinition[] = [
  REFERENCE_PHASE_COMPONENT,
  REFERENCE_FREQ_COMPONENT,
  REFERENCE_CHORDS_COMPONENT,
  REFERENCE_PROGRESS_COMPONENT,
  REFERENCE_PARTICLES_COMPONENT,
  REFERENCE_MORSE_COMPONENT,
  REFERENCE_CENTER_COMPONENT,
  REFERENCE_HUD_COMPONENT,
];

export const REFERENCE_PHASE_COMPONENT_DEFINITION = REFERENCE_PHASE_COMPONENT;
export const REFERENCE_FREQ_COMPONENT_DEFINITION = REFERENCE_FREQ_COMPONENT;
export const REFERENCE_CHORDS_COMPONENT_DEFINITION = REFERENCE_CHORDS_COMPONENT;
export const REFERENCE_PROGRESS_COMPONENT_DEFINITION = REFERENCE_PROGRESS_COMPONENT;
export const REFERENCE_PARTICLES_COMPONENT_DEFINITION = REFERENCE_PARTICLES_COMPONENT;
export const REFERENCE_MORSE_COMPONENT_DEFINITION = REFERENCE_MORSE_COMPONENT;
export const REFERENCE_CENTER_COMPONENT_DEFINITION = REFERENCE_CENTER_COMPONENT;
export const REFERENCE_HUD_COMPONENT_DEFINITION = REFERENCE_HUD_COMPONENT;
