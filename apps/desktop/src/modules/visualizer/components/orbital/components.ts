import type {
  VisualizerComponent,
  VisualizerComponentContext,
  VisualizerComponentDefinition,
  VisualizerFrameInfo,
  VisualizerHitBounds,
  VisualizerRenderContext,
} from '../../types';
import { TonalityTracker, type TonalityFeatures } from './audioFeatures';
import {
  centeredTransform,
  circularStageGeometry,
  createOrbitalManifest,
  ORBITAL_COMPONENT_IDS,
} from './styleModel';
import {
  drawCenterConsole,
  drawChordWheel,
  drawFrequencyRing,
  drawMorseTelemetry,
  drawParticleFlow,
  drawPhaseScope,
  drawProgressOrbit,
  drawTrackHeader,
  type MorseArc,
  type OrbitalParticle,
  updateMorseArcs,
} from './renderers';
import { createStaticSpectrum } from './styleModel';

function createCircularHitBounds(radius: number): VisualizerHitBounds {
  return { type: 'circle', radius };
}

interface TonalityComponentState {
  tracker: TonalityTracker;
  features: TonalityFeatures;
}

function makeCircularDefinition(options: {
  id: string;
  name: string;
  description: string;
  preview: string;
  tags: string[];
  zIndex: number;
  capabilities: Array<{ id: 'audio.playback' | 'audio.state' | 'audio.spectrum' | 'audio.analysis'; required: boolean; reason?: string }>;
  draw: (frame: VisualizerFrameInfo, ctx: VisualizerRenderContext, state: unknown) => void;
  createState?: () => unknown;
  disposeState?: (state: unknown) => void;
}): VisualizerComponentDefinition {
  const manifest = createOrbitalManifest({
    id: options.id,
    name: options.name,
    description: options.description,
    tags: options.tags,
    preview: options.preview,
    geometry: circularStageGeometry(),
    defaultTransform: centeredTransform(options.zIndex),
    capabilities: options.capabilities,
  });

  return {
    manifest,
    create(): VisualizerComponent {
      const state = options.createState?.() ?? undefined;
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
          const defaultSize = manifest.geometry.defaultSize as { radius: number };
          return createCircularHitBounds(defaultSize.radius);
        },
      };
    },
  };
}

function makeRectDefinition(options: {
  id: string;
  name: string;
  description: string;
  preview: string;
  tags: string[];
  zIndex: number;
  width: number;
  height: number;
  position: { x: number; y: number };
  capabilities: Array<{ id: 'audio.playback' | 'audio.state' | 'audio.spectrum' | 'audio.analysis'; required: boolean; reason?: string }>;
  draw: (frame: VisualizerFrameInfo, ctx: VisualizerRenderContext, state: unknown) => void;
  createState?: () => unknown;
  disposeState?: (state: unknown) => void;
}): VisualizerComponentDefinition {
  const manifest = createOrbitalManifest({
    id: options.id,
    name: options.name,
    description: options.description,
    tags: options.tags,
    preview: options.preview,
    geometry: {
      type: 'rectangular',
      defaultSize: { width: options.width, height: options.height },
      hitShape: { type: 'rect', width: options.width, height: options.height },
    },
    defaultTransform: {
      position: options.position,
      scale: 1,
      rotation: 0,
      zIndex: options.zIndex,
      opacity: 1,
      visible: true,
    },
    capabilities: options.capabilities,
  });

  return {
    manifest,
    create(): VisualizerComponent {
      const state = options.createState?.() ?? undefined;
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
          return { type: 'rect', width: options.width, height: options.height };
        },
      };
    },
  };
}

function createChordState(): TonalityComponentState {
  const tracker = new TonalityTracker();
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

function createParticleState() {
  return [] as OrbitalParticle[];
}

function createMorseState() {
  return [] as MorseArc[];
}

function createFrequencyDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.frequencyRing,
    name: 'Frequency Ring',
    description: 'Outer frequency ring for the reference-style orbital visualizer.',
    preview: 'Freq',
    tags: ['audio', 'spectrum', 'orbit'],
    zIndex: 1,
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'The frequency ring needs live frequency bins.' },
      { id: 'audio.analysis', required: true, reason: 'The frequency ring needs energy analysis.' },
    ],
    draw: (frame, ctx) => drawFrequencyRing(ctx.ctx, frame, ctx),
  });
}

function createPhaseDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.phaseScope,
    name: 'Phase Scope',
    description: 'Vector-phase inner layer for the orbital visualizer.',
    preview: 'Phase',
    tags: ['audio', 'phase', 'scope'],
    zIndex: 0,
    capabilities: [
      { id: 'audio.analysis', required: true, reason: 'The phase scope uses analysis and time-domain data.' },
      { id: 'audio.spectrum', required: true, reason: 'The phase scope needs the audio spectrum snapshot.' },
    ],
    draw: (frame, ctx) => drawPhaseScope(ctx.ctx, frame, ctx),
  });
}

function createChordDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.chordWheel,
    name: 'Chord Wheel',
    description: 'Chord wheel and tonal marker ring.',
    preview: 'Chord',
    tags: ['audio', 'tonality', 'wheel'],
    zIndex: 2,
    capabilities: [
      { id: 'audio.analysis', required: true, reason: 'The chord wheel reads tonal energy.' },
      { id: 'audio.spectrum', required: true, reason: 'The chord wheel needs frequency bins.' },
    ],
    draw: (frame, ctx, state) => {
      const tonal = state as TonalityComponentState;
      tonal.features = tonal.tracker.update(ctx.audioSnapshot);
      drawChordWheel(ctx.ctx, frame, ctx, tonal.features);
    },
    createState: createChordState,
    disposeState: (state) => {
      (state as TonalityComponentState | undefined)?.tracker.reset();
    },
  });
}

function createProgressDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.progressOrbit,
    name: 'Progress Orbit',
    description: 'Progress arc built from the reference demo timing ring.',
    preview: 'Progress',
    tags: ['audio', 'progress', 'orbit'],
    zIndex: 3,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'The progress ring needs playback state.' },
      { id: 'audio.analysis', required: true, reason: 'The progress ring uses beat energy.' },
    ],
    draw: (_frame, ctx, state) => drawProgressOrbit(ctx.ctx, ctx, state as number[]),
    createState: () => createStaticSpectrum(180),
  });
}

function createParticleDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.particleFlow,
    name: 'Particle Flow',
    description: 'Emitter particles that trail the playback head.',
    preview: 'Particles',
    tags: ['audio', 'particles', 'flow'],
    zIndex: 4,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'The particle flow needs playback state.' },
      { id: 'audio.analysis', required: true, reason: 'The particle flow uses energy.' },
    ],
    draw: (_frame, ctx, state) => drawParticleFlow(ctx.ctx, ctx, state as OrbitalParticle[]),
    createState: createParticleState,
  });
}

function createMorseDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.morseTelemetry,
    name: 'Morse Telemetry',
    description: 'Telemetry ring that renders Morse arcs like the reference demo.',
    preview: 'Morse',
    tags: ['audio', 'morse', 'telemetry'],
    zIndex: 5,
    capabilities: [
      { id: 'audio.analysis', required: true, reason: 'The telemetry ring needs analysis to react.' },
      { id: 'audio.spectrum', required: true, reason: 'The telemetry ring uses peak frequency.' },
    ],
    draw: (frame, ctx, state) => {
      const arcs = state as MorseArc[];
      updateMorseArcs(ctx, frame, arcs);
      drawMorseTelemetry(ctx.ctx, ctx, arcs);
    },
    createState: createMorseState,
  });
}

function createCenterDefinition(): VisualizerComponentDefinition {
  return makeCircularDefinition({
    id: ORBITAL_COMPONENT_IDS.centerConsole,
    name: 'Center Console',
    description: 'Core status and tonality console.',
    preview: 'Center',
    tags: ['audio', 'center', 'status'],
    zIndex: 6,
    capabilities: [
      { id: 'audio.state', required: true, reason: 'The center console needs playback state.' },
      { id: 'audio.analysis', required: true, reason: 'The center console uses tonal energy.' },
    ],
    draw: (_frame, ctx, state) => {
      const tonal = state as TonalityComponentState;
      tonal.features = tonal.tracker.update(ctx.audioSnapshot);
      drawCenterConsole(ctx.ctx, ctx, tonal.features);
    },
    createState: createChordState,
    disposeState: (state) => {
      (state as TonalityComponentState | undefined)?.tracker.reset();
    },
  });
}

function createTrackHeaderDefinition(): VisualizerComponentDefinition {
  return makeRectDefinition({
    id: ORBITAL_COMPONENT_IDS.trackHeader,
    name: 'Track Header',
    description: 'Top track metadata used by the reference visualizer composition.',
    preview: 'Header',
    tags: ['audio', 'track', 'header'],
    zIndex: 9,
    width: 1200,
    height: 90,
    position: { x: 0, y: -320 },
    capabilities: [
      { id: 'audio.state', required: true, reason: 'The track header needs track metadata.' },
    ],
    draw: (_frame, ctx) => drawTrackHeader(ctx.ctx, ctx),
  });
}

const ORBITAL_PHASE_SCOPE_COMPONENT = createPhaseDefinition();
const ORBITAL_FREQUENCY_RING_COMPONENT = createFrequencyDefinition();
const ORBITAL_CHORD_WHEEL_COMPONENT = createChordDefinition();
const ORBITAL_PROGRESS_ORBIT_COMPONENT = createProgressDefinition();
const ORBITAL_PARTICLE_FLOW_COMPONENT = createParticleDefinition();
const ORBITAL_MORSE_TELEMETRY_COMPONENT = createMorseDefinition();
const ORBITAL_CENTER_CONSOLE_COMPONENT = createCenterDefinition();
const ORBITAL_TRACK_HEADER_COMPONENT = createTrackHeaderDefinition();

export const ORBITAL_VISUALIZER_COMPONENT_DEFINITIONS: VisualizerComponentDefinition[] = [
  ORBITAL_PHASE_SCOPE_COMPONENT,
  ORBITAL_FREQUENCY_RING_COMPONENT,
  ORBITAL_CHORD_WHEEL_COMPONENT,
  ORBITAL_PROGRESS_ORBIT_COMPONENT,
  ORBITAL_PARTICLE_FLOW_COMPONENT,
  ORBITAL_MORSE_TELEMETRY_COMPONENT,
  ORBITAL_CENTER_CONSOLE_COMPONENT,
  ORBITAL_TRACK_HEADER_COMPONENT,
];

export const ORBITAL_PHASE_SCOPE_COMPONENT_DEFINITION = ORBITAL_PHASE_SCOPE_COMPONENT;
export const ORBITAL_FREQUENCY_RING_COMPONENT_DEFINITION = ORBITAL_FREQUENCY_RING_COMPONENT;
export const ORBITAL_CHORD_WHEEL_COMPONENT_DEFINITION = ORBITAL_CHORD_WHEEL_COMPONENT;
export const ORBITAL_PROGRESS_ORBIT_COMPONENT_DEFINITION = ORBITAL_PROGRESS_ORBIT_COMPONENT;
export const ORBITAL_PARTICLE_FLOW_COMPONENT_DEFINITION = ORBITAL_PARTICLE_FLOW_COMPONENT;
export const ORBITAL_MORSE_TELEMETRY_COMPONENT_DEFINITION = ORBITAL_MORSE_TELEMETRY_COMPONENT;
export const ORBITAL_CENTER_CONSOLE_COMPONENT_DEFINITION = ORBITAL_CENTER_CONSOLE_COMPONENT;
export const ORBITAL_TRACK_HEADER_COMPONENT_DEFINITION = ORBITAL_TRACK_HEADER_COMPONENT;
