import type { AudioState, IAudioService } from '../../services/audio';
import type { AudioSpectrumFrame, AudioSpectrumTap } from '../../services/audio/types';

export type VisualizerRendererRequirement =
  | { type: 'canvas2d' }
  | { type: 'webgl2'; extensions?: string[] }
  | { type: 'webgpu'; features?: string[] }
  | { type: 'three'; version?: string }
  | { type: 'any' };

export type VisualizerCapabilityId =
  | 'audio.playback'
  | 'audio.state'
  | 'audio.spectrum'
  | 'audio.analysis'
  | 'audio.cover'
  | 'lyrics.current'
  | 'lyrics.document'
  | 'lyrics.control'
  | 'theme.bindings'
  | 'theme.tokens'
  | 'color.dynamic'
  | 'storage.config'
  | 'storage.state'
  | 'storage.durable'
  | 'navigation'
  | 'i18n'
  | 'telemetry'
  | 'library.metadata'
  | 'library.fields';

export interface VisualizerCapabilityRequirement {
  id: VisualizerCapabilityId;
  required: boolean;
  permissions?: string[];
  reason?: string;
}

export interface VisualizerComponentMetadata {
  name: string;
  description: string;
  author?: string | { name: string; email?: string; url?: string };
  license?: string;
  homepage?: string;
  repository?: string;
  tags?: string[];
  icon?: string;
  preview?: string;
  i18n?: Record<string, { name: string; description: string }>;
}

export interface VisualizerEngineRequirements {
  apiVersion: string;
  renderer: VisualizerRendererRequirement;
  estimatedMemory?: number;
  offscreen?: boolean;
  minFPS?: number;
}

export interface VisualizerCircularSize {
  radius: number;
}

export interface VisualizerRectangularSize {
  width: number;
  height: number;
}

export type VisualizerComponentDefaultSize = VisualizerCircularSize | VisualizerRectangularSize;

export interface VisualizerHitShapeDescriptor {
  type: 'circle' | 'rect' | 'polygon' | 'auto';
  radius?: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
}

export interface VisualizerComponentGeometry {
  type: 'circular' | 'rectangular' | 'custom';
  defaultSize: VisualizerComponentDefaultSize;
  hitShape?: VisualizerHitShapeDescriptor;
  depth?: {
    thickness: number;
    spatial: boolean;
  };
}

export interface VisualizerComponentPosition {
  x: number;
  y: number;
  z?: number;
}

export interface VisualizerComponentScale {
  x: number;
  y: number;
  z?: number;
}

export interface VisualizerComponentRotation {
  x?: number;
  y?: number;
  z: number;
}

export interface VisualizerComponentTransform {
  position: VisualizerComponentPosition;
  scale: number | VisualizerComponentScale;
  rotation: number | VisualizerComponentRotation;
  zIndex: number;
  opacity: number;
  visible: boolean;
}

export interface VisualizerComponentEntry {
  main: string;
  factory?: string;
  format: 'esm' | 'iife';
  shaders?: Array<{
    id: string;
    vertex: string;
    fragment: string;
    type: 'glsl' | 'wgsl';
  }>;
}

export interface VisualizerAssetDeclaration {
  id: string;
  path: string;
  type: 'texture' | 'font' | 'audio' | 'data' | 'shader' | 'model';
  preload?: boolean;
  size?: number;
}

export interface VisualizerComponentManifest {
  id: string;
  version: string;
  formatVersion: 1;
  metadata: VisualizerComponentMetadata;
  engine: VisualizerEngineRequirements;
  capabilities: VisualizerCapabilityRequirement[];
  configSchema?: Record<string, unknown>;
  stateSchema?: Record<string, unknown>;
  geometry: VisualizerComponentGeometry;
  defaultTransform: VisualizerComponentTransform;
  entry?: VisualizerComponentEntry;
  assets?: VisualizerAssetDeclaration[];
}

export interface VisualizerComponentQuality {
  level: number;
  barCount: number;
  renderScale: number;
  fpsLimit: number;
}

export interface VisualizerViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export type VisualizerWorkspaceViewMode = 'perspective' | 'top' | 'front' | 'side';

export type VisualizerCameraOrbitPreset =
  | 'home'
  | 'x-positive'
  | 'x-negative'
  | 'y-positive'
  | 'y-negative'
  | 'z-positive'
  | 'z-negative';

export interface VisualizerViewGizmoAxisState {
  id: Exclude<VisualizerCameraOrbitPreset, 'home'>;
  axis: 'x' | 'y' | 'z';
  direction: 1 | -1;
  label: string;
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export interface VisualizerViewGizmoState {
  axes: VisualizerViewGizmoAxisState[];
}

export interface VisualizerWorkspaceHostContext {
  viewMode: VisualizerWorkspaceViewMode;
  camera: unknown;
  renderer: unknown;
  componentHostRoot: HTMLElement | null;
}

export interface VisualizerCanvasViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface VisualizerScreenSpaceSelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualizerCanvasSelectionChange {
  sceneId: string;
  ids: string[];
  primaryId: string | null;
}

export interface VisualizerCanvasEditState extends VisualizerCanvasViewState {
  editMode: boolean;
  hoveredComponentId: string | null;
  selectedComponentId: string | null;
  selectedComponentIds: string[];
  draggingComponentId: string | null;
  resizingComponentId: string | null;
  hoveredHandle: 'scale' | null;
  activeHandle: 'scale' | null;
  snapToGrid: boolean;
  gridSize: number;
}

export interface VisualizerAnalysisSnapshot {
  energy: number;
  smoothedEnergy: number;
  energyDelta: number;
  bass: number;
  mid: number;
  treble: number;
  spectralCentroid: number;
  peakBin: number;
  peakValue: number;
  beatPhase: number;
  beatStrength: number;
}

export interface VisualizerTrackSnapshot {
  title: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  lyrics?: string;
}

export interface VisualizerAudioSnapshot {
  frequency: Uint8Array;
  timeDomain: Uint8Array;
  spectrumFrame: AudioSpectrumFrame | null;
  analysis: VisualizerAnalysisSnapshot;
  playback: {
    currentTime: number;
    duration: number;
    progress: number;
    isPlaying: boolean;
    sampleRate: number;
    playbackState: AudioState['playbackState'];
  };
  track: VisualizerTrackSnapshot | null;
  timestamp: number;
}

export interface VisualizerAudioAdapter {
  getState(): AudioState;
  getFrequencyData(): Uint8Array | null;
  getSpectrumFrame(tap?: AudioSpectrumTap): AudioSpectrumFrame | null;
  getSnapshot(): VisualizerAudioSnapshot;
}

export interface VisualizerComponentContext {
  audio: VisualizerAudioAdapter;
  viewport: VisualizerViewportInfo;
  transform: Readonly<VisualizerComponentTransform>;
  config: Readonly<Record<string, unknown>>;
  quality: VisualizerComponentQuality;
  qualityLevel: number;
  workspace?: VisualizerWorkspaceHostContext;
  requestRedraw(): void;
}

export interface VisualizerRenderContext {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  bounds: {
    width: number;
    height: number;
  };
  viewport: VisualizerViewportInfo;
  transform: Readonly<VisualizerComponentTransform>;
  config: Readonly<Record<string, unknown>>;
  audioSnapshot: VisualizerAudioSnapshot;
  quality: VisualizerComponentQuality;
  qualityLevel: number;
  viewState: Readonly<VisualizerCanvasViewState>;
  editState: Readonly<VisualizerCanvasEditState>;
  workspace?: VisualizerWorkspaceHostContext;
}

export interface VisualizerFrameInfo {
  timestamp: number;
  deltaTime: number;
  frameNumber: number;
  globalRotation: number;
}

export type VisualizerHitBounds =
  | { type: 'circle'; radius: number }
  | { type: 'rect'; width: number; height: number }
  | { type: 'polygon'; points: Array<{ x: number; y: number }> };

export interface VisualizerComponent {
  readonly manifest: VisualizerComponentManifest;
  initialize(ctx: VisualizerComponentContext): void | Promise<void>;
  render(frame: VisualizerFrameInfo, ctx: VisualizerRenderContext): void;
  dispose(): void;
  onConfigChange?(config: Record<string, unknown>): void;
  onTransformChange?(transform: VisualizerComponentTransform): void;
  onFocusChange?(focused: boolean): void;
  getHitBounds(): VisualizerHitBounds;
}

export interface VisualizerComponentDefinition {
  readonly manifest: VisualizerComponentManifest;
  create(): VisualizerComponent;
}

export interface VisualizerSceneComponentPlacement {
  id: string;
  transform?: Partial<VisualizerComponentTransform>;
  config?: Record<string, unknown>;
}

export interface VisualizerSceneDescriptor {
  id: string;
  title?: string;
  components: VisualizerSceneComponentPlacement[];
}

export interface VisualizerRuntimeOptions {
  audioService: IAudioService;
  canvas: HTMLCanvasElement;
  componentHostRoot?: HTMLElement | null;
  sceneId: string;
  quality: VisualizerComponentQuality;
  viewMode?: VisualizerWorkspaceViewMode;
  onSelectionChange?: (selection: VisualizerCanvasSelectionChange) => void;
  onSelectionBoxChange?: (box: VisualizerScreenSpaceSelectionBox | null) => void;
  onViewGizmoChange?: (state: VisualizerViewGizmoState) => void;
  onClose?: () => void;
}
