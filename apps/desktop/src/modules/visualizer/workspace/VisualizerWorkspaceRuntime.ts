/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { readJson } from '../../storage';
import { broadcastDataUpdate, STORAGE_KEYS } from '../../../utils/windowCommunication';
import { AudioDataBus } from '../AudioDataBus';
import { ComponentRegistry } from '../ComponentRegistry';
import {
  clamp,
  createViewportInfo,
  getTransformRotation,
  normalizeScale,
  resolveComponentBaseSize,
  screenToWorld,
} from '../CoordinateSystem';
import {
  containsVisualizerEditRect,
  getVisualizerEditMetricsById,
  getVisualizerUniformScale,
  type VisualizerEditHandleKind,
} from '../editorGeometry';
import { REFERENCE_COMPONENT_IDS, REFERENCE_VISUALIZER_COMPONENT_DEFINITIONS } from '../components/reference';
import { renderSceneFrame, type ActiveVisualizerComponent } from '../RenderPipeline';
import { resolveVisualizerScene } from '../scenes';
import type {
  VisualizerCanvasEditState,
  VisualizerCameraOrbitPreset,
  VisualizerCanvasViewState,
  VisualizerComponentPosition,
  VisualizerComponentQuality,
  VisualizerComponentRotation,
  VisualizerComponentScale,
  VisualizerComponentTransform,
  VisualizerRuntimeOptions,
  VisualizerViewGizmoState,
  VisualizerViewportInfo,
  VisualizerWorkspaceViewMode,
} from '../types';

const telemetry = getTelemetryLogger('visualizer', 'VisualizerWorkspaceRuntime');

const DEFAULT_VIEW_MODE: VisualizerWorkspaceViewMode = 'top';
const VIEW_MODES: readonly VisualizerWorkspaceViewMode[] = ['top', 'perspective'];
const EDIT_GRID_SIZE = 40;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const MIN_VISUALIZER_FPS = 60;
const FRAME_INTERVAL_EPSILON_MS = 1;
const REFERENCE_STAGE_SIZE = 840;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 10000;
const CAMERA_DISTANCE_FACTOR = 1.25;
const SURFACE_ROOT_ID = '__visualizer_surface_root__';
const PROGRESS_HOVER_TOLERANCE = 40;
const SURFACE_STAGE_PADDING = 240;
const SURFACE_STAGE_MAX_SIZE = 3200;
const SURFACE_TEXTURE_MAX_SIDE = 8192;
const WORLD_GRID_SIZE = 24000;
const WORLD_GRID_MINOR_DIVISIONS = 600;
const WORLD_GRID_MAJOR_DIVISIONS = 150;
const WORLD_GRID_Y = -0.02;
const PERSPECTIVE_MIN_POLAR_ANGLE = Math.PI * 0.035;
const PERSPECTIVE_MAX_POLAR_ANGLE = Math.PI * 0.965;
const VIEW_GIZMO_RADIUS = 34;
const VIEW_GIZMO_DEPTH_EPSILON = 0.0001;

type LayoutOverrides = Record<string, VisualizerComponentTransform>;
type WorkspaceCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type TransformControlsCompat = TransformControls & {
  getHelper?: () => THREE.Object3D;
};
type DragMode = 'component' | 'resize';

interface VisualizerEditHitTarget {
  type: 'body' | 'label' | 'scale-handle';
  componentId: string;
  handle?: VisualizerEditHandleKind;
}

interface PointerDragBaseState {
  pointerId: number;
  mode: DragMode;
}

interface ComponentPointerDragState extends PointerDragBaseState {
  mode: 'component';
  startWorldX: number;
  startWorldY: number;
  componentId: string;
  initialTransform: VisualizerComponentTransform;
}

interface ResizePointerDragState extends PointerDragBaseState {
  mode: 'resize';
  startWorldX: number;
  startWorldY: number;
  componentId: string;
  initialTransform: VisualizerComponentTransform;
  initialScale?: number;
  initialResizeDistance?: number;
  resizeCenterX?: number;
  resizeCenterY?: number;
  handle?: VisualizerEditHandleKind;
}

type PointerDragState = ComponentPointerDragState | ResizePointerDragState;

interface VisualizerSurfaceFrame {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  viewport: VisualizerViewportInfo;
  viewState: VisualizerCanvasViewState;
}

interface VisualizerSceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface PersistedVector3 {
  x: number;
  y: number;
  z: number;
}

const VIEW_GIZMO_AXIS_SPECS = [
  {
    id: 'x-positive',
    axis: 'x',
    direction: 1,
    label: 'X',
    vector: new THREE.Vector3(1, 0, 0),
  },
  {
    id: 'x-negative',
    axis: 'x',
    direction: -1,
    label: '-X',
    vector: new THREE.Vector3(-1, 0, 0),
  },
  {
    id: 'y-positive',
    axis: 'y',
    direction: 1,
    label: 'Y',
    vector: new THREE.Vector3(0, 0, 1),
  },
  {
    id: 'y-negative',
    axis: 'y',
    direction: -1,
    label: '-Y',
    vector: new THREE.Vector3(0, 0, -1),
  },
  {
    id: 'z-positive',
    axis: 'z',
    direction: 1,
    label: 'Z',
    vector: new THREE.Vector3(0, 1, 0),
  },
  {
    id: 'z-negative',
    axis: 'z',
    direction: -1,
    label: '-Z',
    vector: new THREE.Vector3(0, -1, 0),
  },
] as const;

export interface VisualizerWorkspaceCameraState {
  position: PersistedVector3;
  target: PersistedVector3;
  zoom: number;
}

type SceneCameraSet = Partial<Record<VisualizerWorkspaceViewMode, VisualizerWorkspaceCameraState>>;
type SceneCameraStorage = SceneCameraSet | VisualizerWorkspaceCameraState;

interface VisualizerLayoutStorageV1 {
  version: 1 | 2 | 3;
  scenes: Record<string, LayoutOverrides>;
  views: Record<string, VisualizerCanvasViewState>;
  viewModes?: Record<string, VisualizerWorkspaceViewMode>;
  cameras?: Record<string, SceneCameraStorage>;
}

function isViewMode(value: unknown): value is VisualizerWorkspaceViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as VisualizerWorkspaceViewMode);
}

function cloneScale(scale: number | VisualizerComponentScale): number | VisualizerComponentScale {
  if (typeof scale === 'number') {
    return Number.isFinite(scale) ? scale : 1;
  }

  const next: VisualizerComponentScale = {
    x: Number.isFinite(scale.x) ? scale.x : 1,
    y: Number.isFinite(scale.y) ? scale.y : 1,
  };
  if (typeof scale.z === 'number' && Number.isFinite(scale.z)) {
    next.z = scale.z;
  }
  return next;
}

function cloneRotation(
  rotation: number | VisualizerComponentRotation
): number | VisualizerComponentRotation {
  if (typeof rotation === 'number') {
    return Number.isFinite(rotation) ? rotation : 0;
  }

  const next: VisualizerComponentRotation = {
    z: Number.isFinite(rotation.z) ? rotation.z : 0,
  };
  if (typeof rotation.x === 'number' && Number.isFinite(rotation.x)) {
    next.x = rotation.x;
  }
  if (typeof rotation.y === 'number' && Number.isFinite(rotation.y)) {
    next.y = rotation.y;
  }
  return next;
}

function cloneTransform(
  transform: Partial<VisualizerComponentTransform>,
  viewport: VisualizerViewportInfo = createViewportInfo(1, 1, 1),
  normalizeScenePosition = false
): VisualizerComponentTransform {
  const position = (transform.position ?? {}) as Partial<VisualizerComponentPosition>;
  const defaultCoordinate = normalizeScenePosition ? 0.5 : 0;
  const rawX = typeof position.x === 'number' && Number.isFinite(position.x) ? position.x : defaultCoordinate;
  const rawY = typeof position.y === 'number' && Number.isFinite(position.y) ? position.y : defaultCoordinate;
  const zIndex = typeof transform.zIndex === 'number' && Number.isFinite(transform.zIndex) ? transform.zIndex : 0;
  const opacity = typeof transform.opacity === 'number' && Number.isFinite(transform.opacity) ? transform.opacity : 1;

  return {
    position: normalizeScenePosition
      ? {
          x: (rawX - 0.5) * viewport.width,
          y: (rawY - 0.5) * viewport.height,
          z: position.z,
        }
      : {
          x: rawX,
          y: rawY,
          z: position.z,
        },
    scale: cloneScale(transform.scale ?? 1),
    rotation: cloneRotation(transform.rotation ?? 0),
    zIndex,
    opacity: clamp(opacity, 0, 1),
    visible: transform.visible ?? true,
  };
}

function resolveTransformControlsHelper(transformControls: TransformControls): THREE.Object3D {
  const compat = transformControls as TransformControlsCompat;
  if (typeof compat.getHelper === 'function') {
    return compat.getHelper();
  }

  return transformControls as unknown as THREE.Object3D;
}

function mergeTransforms(
  base: VisualizerComponentTransform,
  override?: Partial<VisualizerComponentTransform>
): VisualizerComponentTransform {
  if (!override) return { ...base };

  return {
    position: {
      x: override.position?.x ?? base.position.x,
      y: override.position?.y ?? base.position.y,
      z: override.position?.z ?? base.position.z,
    },
    scale: override.scale ?? base.scale,
    rotation: override.rotation ?? base.rotation,
    zIndex: override.zIndex ?? base.zIndex,
    opacity: override.opacity ?? base.opacity,
    visible: override.visible ?? base.visible,
  };
}

function withUniformScale(
  transform: VisualizerComponentTransform,
  scale: number
): VisualizerComponentTransform {
  const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (typeof transform.scale === 'number') {
    return {
      ...transform,
      scale: nextScale,
    };
  }

  return {
    ...transform,
    scale: {
      x: nextScale,
      y: nextScale,
      ...(typeof transform.scale.z === 'number' ? { z: transform.scale.z } : {}),
    },
  };
}

function shouldTreatAsLegacyNormalizedLayout(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  for (const entry of Object.values(record)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as Partial<VisualizerComponentTransform>;
    const position = candidate.position;
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') continue;

    const inNormalizedRange =
      position.x >= -0.01 &&
      position.x <= 1.01 &&
      position.y >= -0.01 &&
      position.y <= 1.01;
    const notOrigin = Math.abs(position.x) > 0.001 || Math.abs(position.y) > 0.001;
    if (inNormalizedRange && notOrigin) {
      return true;
    }
  }

  return false;
}

function sanitizeLayoutOverrides(value: unknown, viewport: VisualizerViewportInfo): LayoutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const normalizeScenePosition = shouldTreatAsLegacyNormalizedLayout(record);
  const next: LayoutOverrides = {};

  for (const [id, transform] of Object.entries(record)) {
    if (!transform || typeof transform !== 'object' || Array.isArray(transform)) continue;
    next[id] = cloneTransform(transform as Partial<VisualizerComponentTransform>, viewport, normalizeScenePosition);
  }

  return next;
}

function sanitizeViewState(value: unknown): VisualizerCanvasViewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };
  }

  const record = value as Partial<VisualizerCanvasViewState>;
  return {
    panX: typeof record.panX === 'number' && Number.isFinite(record.panX) ? record.panX : 0,
    panY: typeof record.panY === 'number' && Number.isFinite(record.panY) ? record.panY : 0,
    zoom:
      typeof record.zoom === 'number' && Number.isFinite(record.zoom)
        ? clamp(record.zoom, MIN_ZOOM, MAX_ZOOM)
        : DEFAULT_ZOOM,
  };
}

function createDefaultViewState(viewport: VisualizerViewportInfo): VisualizerCanvasViewState {
  const fitZoom = Math.min(viewport.width, viewport.height) / REFERENCE_STAGE_SIZE;
  return {
    panX: 0,
    panY: 0,
    zoom: clamp(fitZoom, MIN_ZOOM, MAX_ZOOM),
  };
}

function sanitizeViewStates(value: unknown): Record<string, VisualizerCanvasViewState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const next: Record<string, VisualizerCanvasViewState> = {};
  for (const [sceneId, view] of Object.entries(value as Record<string, unknown>)) {
    next[sceneId] = sanitizeViewState(view);
  }
  return next;
}

function sanitizeViewModes(value: unknown): Record<string, VisualizerWorkspaceViewMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const next: Record<string, VisualizerWorkspaceViewMode> = {};
  for (const [sceneId, mode] of Object.entries(value as Record<string, unknown>)) {
    if (isViewMode(mode)) {
      next[sceneId] = mode;
    }
  }
  return next;
}

function isLayoutStorage(value: unknown): value is VisualizerLayoutStorageV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.version === 1 || record.version === 2 || record.version === 3) &&
    !!record.scenes &&
    typeof record.scenes === 'object' &&
    !Array.isArray(record.scenes)
  );
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeVector3(value: unknown, fallback: PersistedVector3): PersistedVector3 {
  if (Array.isArray(value)) {
    return {
      x: readFiniteNumber(value[0], fallback.x),
      y: readFiniteNumber(value[1], fallback.y),
      z: readFiniteNumber(value[2], fallback.z),
    };
  }

  if (!value || typeof value !== 'object') return fallback;
  const record = value as Partial<PersistedVector3>;
  return {
    x: readFiniteNumber(record.x, fallback.x),
    y: readFiniteNumber(record.y, fallback.y),
    z: readFiniteNumber(record.z, fallback.z),
  };
}

function cameraDistanceForViewport(viewport: VisualizerViewportInfo): number {
  return Math.max(viewport.width, viewport.height, REFERENCE_STAGE_SIZE) * CAMERA_DISTANCE_FACTOR;
}

function createDefaultCameraState(
  mode: VisualizerWorkspaceViewMode,
  viewport: VisualizerViewportInfo
): VisualizerWorkspaceCameraState {
  const distance = cameraDistanceForViewport(viewport);
  const target = { x: 0, y: 0, z: 0 };

  if (mode === 'top') {
    return {
      position: { x: 0, y: distance, z: 0 },
      target,
      zoom: 1,
    };
  }

  if (mode === 'front') {
    return {
      position: { x: 0, y: distance * 0.28, z: distance },
      target,
      zoom: 1,
    };
  }

  if (mode === 'side') {
    return {
      position: { x: distance, y: distance * 0.28, z: 0 },
      target,
      zoom: 1,
    };
  }

  return {
    position: { x: 0, y: distance * 0.46, z: distance },
    target,
    zoom: 1,
  };
}

function createCameraOrbitPresetState(
  preset: VisualizerCameraOrbitPreset,
  current: VisualizerWorkspaceCameraState,
  viewport: VisualizerViewportInfo
): VisualizerWorkspaceCameraState {
  const currentDistance = new THREE.Vector3(
    current.position.x - current.target.x,
    current.position.y - current.target.y,
    current.position.z - current.target.z
  ).length();
  const defaultDistance = cameraDistanceForViewport(viewport);
  const distance = preset === 'home'
    ? defaultDistance
    : Number.isFinite(currentDistance) && currentDistance > 1
    ? currentDistance
    : defaultDistance;
  const target = current.target;
  const poleOffset = Math.max(0.1, distance * 0.001);

  if (preset === 'home') {
    return createDefaultCameraState('top', viewport);
  }

  if (preset === 'x-positive') {
    return {
      position: { x: target.x + distance, y: target.y, z: target.z },
      target,
      zoom: current.zoom,
    };
  }

  if (preset === 'x-negative') {
    return {
      position: { x: target.x - distance, y: target.y, z: target.z },
      target,
      zoom: current.zoom,
    };
  }

  if (preset === 'y-positive') {
    return {
      position: { x: target.x, y: target.y, z: target.z + distance },
      target,
      zoom: current.zoom,
    };
  }

  if (preset === 'y-negative') {
    return {
      position: { x: target.x, y: target.y, z: target.z - distance },
      target,
      zoom: current.zoom,
    };
  }

  if (preset === 'z-positive') {
    return {
      position: { x: target.x, y: target.y + distance, z: target.z + poleOffset },
      target,
      zoom: current.zoom,
    };
  }

  if (preset === 'z-negative') {
    return {
      position: { x: target.x, y: target.y - distance, z: target.z - poleOffset },
      target,
      zoom: current.zoom,
    };
  }

  return createDefaultCameraState(DEFAULT_VIEW_MODE, viewport);
}

function sanitizeCameraState(
  value: unknown,
  fallback: VisualizerWorkspaceCameraState
): VisualizerWorkspaceCameraState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Partial<VisualizerWorkspaceCameraState>;
  return {
    position: sanitizeVector3(record.position, fallback.position),
    target: sanitizeVector3(record.target, fallback.target),
    zoom: clamp(readFiniteNumber(record.zoom, fallback.zoom), 0.1, 8),
  };
}

function isPureCameraState(value: unknown): value is VisualizerWorkspaceCameraState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return 'position' in record || 'target' in record || 'zoom' in record;
}

function sanitizeCameraStorage(
  value: unknown,
  viewport: VisualizerViewportInfo
): Record<string, SceneCameraStorage> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const next: Record<string, SceneCameraStorage> = {};
  for (const [sceneId, sceneValue] of Object.entries(value as Record<string, unknown>)) {
    if (isPureCameraState(sceneValue)) {
      next[sceneId] = sanitizeCameraState(sceneValue, createDefaultCameraState(DEFAULT_VIEW_MODE, viewport));
      continue;
    }

    if (!sceneValue || typeof sceneValue !== 'object' || Array.isArray(sceneValue)) continue;
    const sceneRecord = sceneValue as Record<string, unknown>;
    const cameraSet: Partial<Record<VisualizerWorkspaceViewMode, VisualizerWorkspaceCameraState>> = {};
    for (const mode of VIEW_MODES) {
      if (mode in sceneRecord) {
        cameraSet[mode] = sanitizeCameraState(sceneRecord[mode], createDefaultCameraState(mode, viewport));
      }
    }
    next[sceneId] = cameraSet;
  }

  return next;
}

function cloneCameraState(state: VisualizerWorkspaceCameraState): VisualizerWorkspaceCameraState {
  return {
    position: { ...state.position },
    target: { ...state.target },
    zoom: state.zoom,
  };
}

function readSceneCameraState(
  storage: SceneCameraStorage | undefined,
  mode: VisualizerWorkspaceViewMode
): VisualizerWorkspaceCameraState | null {
  if (!storage) return null;
  if (isPureCameraState(storage)) {
    return cloneCameraState(storage);
  }
  return storage[mode] ? cloneCameraState(storage[mode]) : null;
}

function writeSceneCameraState(
  storage: SceneCameraStorage | undefined,
  mode: VisualizerWorkspaceViewMode,
  state: VisualizerWorkspaceCameraState
): SceneCameraStorage {
  const next: SceneCameraSet =
    storage && !isPureCameraState(storage) ? { ...storage } : {};
  next[mode] = cloneCameraState(state);
  return next;
}

export function readStoredVisualizerWorkspaceViewMode(sceneId: string): VisualizerWorkspaceViewMode {
  const raw = readJson<unknown>(STORAGE_KEYS.VISUALIZER_LAYOUT_V1, null);
  if (!isLayoutStorage(raw)) return DEFAULT_VIEW_MODE;

  const viewModes = sanitizeViewModes(raw.viewModes);
  return viewModes[sceneId] ?? DEFAULT_VIEW_MODE;
}

function configureGridHelper(helper: THREE.GridHelper, opacity: number): THREE.GridHelper {
  helper.position.y = WORLD_GRID_Y;
  helper.renderOrder = 0;
  const material = helper.material as THREE.LineBasicMaterial;
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  material.toneMapped = false;
  return helper;
}

export class VisualizerWorkspaceRuntime {
  private readonly canvas: HTMLCanvasElement;

  private readonly resizeTarget: HTMLElement;

  private componentHostRoot: HTMLElement | null;

  private readonly renderer: THREE.WebGLRenderer;

  private readonly scene = new THREE.Scene();

  private readonly perspectiveCamera = new THREE.PerspectiveCamera(45, 1, CAMERA_NEAR, CAMERA_FAR);

  private readonly topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);

  private readonly frontCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);

  private readonly sideCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);

  private activeCamera: WorkspaceCamera = this.perspectiveCamera;

  private readonly orbitControls: OrbitControls;

  private readonly transformControls: TransformControls;

  private readonly transformControlsHelper: THREE.Object3D;

  private readonly raycaster = new THREE.Raycaster();

  private readonly pointer = new THREE.Vector2();

  private readonly surfaceGroup = new THREE.Group();

  private readonly componentNodeRoot = new THREE.Group();

  private readonly worldGridGroup = new THREE.Group();

  private readonly surfaceCanvas = document.createElement('canvas');

  private readonly surfaceContext: CanvasRenderingContext2D;

  private readonly surfaceTexture: THREE.CanvasTexture;

  private readonly surfaceMesh: THREE.Mesh;

  private readonly audioBus: AudioDataBus;

  private readonly registry = new ComponentRegistry();

  private readonly sceneComponents: ActiveVisualizerComponent[] = [];

  private readonly sceneComponentMap = new Map<string, ActiveVisualizerComponent>();

  private viewport: VisualizerViewportInfo = createViewportInfo(1, 1, 1);

  private readonly viewState: VisualizerCanvasViewState = {
    panX: 0,
    panY: 0,
    zoom: DEFAULT_ZOOM,
  };

  private surfaceFrame: VisualizerSurfaceFrame = {
    centerX: 0,
    centerY: 0,
    width: 1,
    height: 1,
    viewport: createViewportInfo(1, 1, 1),
    viewState: {
      panX: 0,
      panY: 0,
      zoom: DEFAULT_ZOOM,
    },
  };

  private readonly editState: VisualizerCanvasEditState = {
    panX: 0,
    panY: 0,
    zoom: DEFAULT_ZOOM,
    editMode: false,
    hoveredComponentId: null,
    selectedComponentId: null,
    selectedComponentIds: [],
    draggingComponentId: null,
    resizingComponentId: null,
    hoveredHandle: null,
    activeHandle: null,
    snapToGrid: true,
    gridSize: EDIT_GRID_SIZE,
  };

  private layoutStore: VisualizerLayoutStorageV1 = { version: 3, scenes: {}, views: {}, viewModes: {}, cameras: {} };

  private layoutOverrides: LayoutOverrides = {};

  private layoutPersistTimer: number | null = null;

  private quality: VisualizerComponentQuality;

  private sceneId: string;

  private viewMode: VisualizerWorkspaceViewMode;

  private frameNumber = 0;

  private globalRotation = 0;

  private lastFrameAt = 0;

  private rafId: number | null = null;

  private resizeObserver: ResizeObserver | null = null;

  private resizeTimerId: number | null = null;

  private resizePending = false;

  private pointerDrag: PointerDragState | null = null;

  private disposed = false;

  private readonly cleanupTasks: Array<() => void> = [];

  private readonly onViewGizmoChange: ((state: VisualizerViewGizmoState) => void) | null;

  private viewGizmoSignature = '';

  private readonly progressHoverInfo = {
    active: false,
    angle: 0,
    distance: 0,
  };

  constructor(options: VisualizerRuntimeOptions) {
    this.canvas = options.canvas;
    this.resizeTarget = this.canvas.parentElement ?? this.canvas;
    this.componentHostRoot = options.componentHostRoot ?? null;
    this.onViewGizmoChange = options.onViewGizmoChange ?? null;
    this.quality = options.quality;
    this.sceneId = options.sceneId;
    this.viewMode = options.viewMode ?? readStoredVisualizerWorkspaceViewMode(options.sceneId);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color('#050505'), 1);

    const surfaceContext = this.surfaceCanvas.getContext('2d');
    if (!surfaceContext) {
      throw new Error('Visualizer workspace surface 2D context is unavailable');
    }
    this.surfaceContext = surfaceContext;
    this.surfaceTexture = new THREE.CanvasTexture(this.surfaceCanvas);
    this.surfaceTexture.colorSpace = THREE.SRGBColorSpace;
    this.surfaceTexture.generateMipmaps = false;
    this.surfaceTexture.minFilter = THREE.LinearFilter;
    this.surfaceTexture.magFilter = THREE.LinearFilter;
    this.surfaceTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const surfaceMaterial = new THREE.MeshBasicMaterial({
      map: this.surfaceTexture,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.surfaceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surfaceMaterial);
    this.surfaceMesh.name = 'visualizer-web-surface';
    this.surfaceMesh.frustumCulled = false;
    this.surfaceMesh.renderOrder = 2;
    this.surfaceMesh.userData = {
      visualizerRole: 'webSurfaceRoot',
      editableUnitId: SURFACE_ROOT_ID,
    };
    this.surfaceGroup.name = 'visualizer-component-host-root';
    this.surfaceGroup.userData = {
      visualizerRole: 'componentHostRoot',
      editableUnitId: SURFACE_ROOT_ID,
    };
    this.componentNodeRoot.name = 'visualizer-scene-component-nodes';
    this.componentNodeRoot.userData = {
      visualizerRole: 'sceneGraphRoot',
      editableUnitId: SURFACE_ROOT_ID,
    };
    this.surfaceGroup.rotation.x = -Math.PI / 2;
    this.surfaceGroup.add(this.surfaceMesh, this.componentNodeRoot);
    this.configureWorldGrid();
    this.scene.add(this.worldGridGroup);
    this.scene.add(this.surfaceGroup);

    this.orbitControls = new OrbitControls(this.activeCamera, this.canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.minDistance = 120;
    this.orbitControls.maxDistance = CAMERA_FAR * 0.6;
    this.orbitControls.minPolarAngle = PERSPECTIVE_MIN_POLAR_ANGLE;
    this.orbitControls.maxPolarAngle = PERSPECTIVE_MAX_POLAR_ANGLE;
    this.orbitControls.minZoom = 0.2;
    this.orbitControls.maxZoom = 8;

    this.transformControls = new TransformControls(this.activeCamera, this.canvas);
    this.transformControls.setMode('translate');
    this.transformControls.setSpace('world');
    this.transformControls.setSize(0.75);
    this.transformControlsHelper = resolveTransformControlsHelper(this.transformControls);
    this.transformControlsHelper.visible = false;
    this.scene.add(this.transformControlsHelper);

    this.audioBus = new AudioDataBus(options.audioService);
    this.registry.registerMany(REFERENCE_VISUALIZER_COMPONENT_DEFINITIONS);
    this.configureComponentHostRoot();
    this.attachControls();
    this.attachResizeObserver();
    this.attachInteractionListeners();
    this.resize();
    this.layoutStore = this.loadLayoutStore();
    this.layoutOverrides = this.layoutStore.scenes[this.sceneId] ?? {};
    this.applyStoredViewState(this.sceneId);
    this.applyStoredViewMode(options.viewMode ?? this.layoutStore.viewModes?.[this.sceneId] ?? this.viewMode);
    this.activateScene(this.sceneId);
    this.updateViewGizmoState();
  }

  private get cameraByMode(): Record<VisualizerWorkspaceViewMode, WorkspaceCamera> {
    return {
      perspective: this.perspectiveCamera,
      top: this.topCamera,
      front: this.frontCamera,
      side: this.sideCamera,
    };
  }

  private configureWorldGrid(): void {
    this.worldGridGroup.name = 'visualizer-world-grid';
    this.worldGridGroup.visible = this.viewMode === 'perspective';

    const minorGrid = configureGridHelper(
      new THREE.GridHelper(WORLD_GRID_SIZE, WORLD_GRID_MINOR_DIVISIONS, 0x191919, 0x0d0d0d),
      0.62
    );
    minorGrid.name = 'visualizer-world-grid-minor';

    const majorGrid = configureGridHelper(
      new THREE.GridHelper(WORLD_GRID_SIZE, WORLD_GRID_MAJOR_DIVISIONS, 0x2f2f2f, 0x171717),
      0.68
    );
    majorGrid.name = 'visualizer-world-grid-major';
    majorGrid.position.y = WORLD_GRID_Y + 0.005;

    this.worldGridGroup.add(minorGrid, majorGrid);
  }

  private attachControls(): void {
    const onOrbitChange = () => {
      this.scheduleLayoutPersist();
      this.requestFrame();
    };
    const onTransformChange = () => {
      this.requestFrame();
    };
    const onObjectChange = () => {
      this.scheduleLayoutPersist();
      this.requestFrame();
    };
    const onDraggingChanged = (event: { value: unknown }) => {
      this.orbitControls.enabled = !event.value;
      this.requestFrame();
    };

    this.orbitControls.addEventListener('change', onOrbitChange);
    this.transformControls.addEventListener('change', onTransformChange);
    this.transformControls.addEventListener('objectChange', onObjectChange);
    this.transformControls.addEventListener('dragging-changed', onDraggingChanged);

    this.cleanupTasks.push(
      () => this.orbitControls.removeEventListener('change', onOrbitChange),
      () => this.transformControls.removeEventListener('change', onTransformChange),
      () => this.transformControls.removeEventListener('objectChange', onObjectChange),
      () => this.transformControls.removeEventListener('dragging-changed', onDraggingChanged)
    );
  }

  private attachResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleResize();
    });
    this.resizeObserver.observe(this.resizeTarget);
  }

  private attachInteractionListeners(): void {
    if (typeof window === 'undefined') return;

    const onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
    const onCanvasPointerMove = (event: PointerEvent) => {
      if (!this.pointerDrag) {
        this.handlePointerMove(event);
      }
    };
    const onWindowPointerMove = (event: PointerEvent) => {
      if (this.pointerDrag) {
        this.handlePointerMove(event);
      }
    };
    const onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
    const onPointerCancel = (event: PointerEvent) => this.handlePointerUp(event);
    const onPointerLeave = () => {
      this.progressHoverInfo.active = false;
      if (this.editState.editMode && !this.pointerDrag) {
        this.editState.hoveredComponentId = null;
        this.editState.hoveredHandle = null;
        this.updateCursor(null);
      }
      this.requestFrame();
    };
    const onResize = () => {
      this.scheduleResize();
    };
    const onWheel = (event: WheelEvent) => this.handleWheel(event);
    const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    const onBlur = () => {
      if (this.pointerDrag) {
        this.finishPointerDrag(true);
      }
    };

    this.canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    this.canvas.addEventListener('pointermove', onCanvasPointerMove);
    this.canvas.addEventListener('pointerleave', onPointerLeave);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    this.cleanupTasks.push(
      () => this.canvas.removeEventListener('pointerdown', onPointerDown, true),
      () => this.canvas.removeEventListener('pointermove', onCanvasPointerMove),
      () => this.canvas.removeEventListener('pointerleave', onPointerLeave),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('pointermove', onWindowPointerMove),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointercancel', onPointerCancel),
      () => window.removeEventListener('keydown', onKeyDown, true),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('resize', onResize),
      () => window.visualViewport?.removeEventListener('resize', onResize)
    );
  }

  private readLayoutSize(): { width: number; height: number } {
    const targetRect = this.resizeTarget.getBoundingClientRect();
    const parent = this.canvas.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    const root = document.documentElement;

    const widthCandidates = [
      targetRect.width,
      this.resizeTarget.clientWidth,
      parentRect?.width,
      parent?.clientWidth,
      canvasRect.width,
      this.canvas.clientWidth,
      root?.clientWidth,
      window.innerWidth,
    ];
    const heightCandidates = [
      targetRect.height,
      this.resizeTarget.clientHeight,
      parentRect?.height,
      parent?.clientHeight,
      canvasRect.height,
      this.canvas.clientHeight,
      root?.clientHeight,
      window.innerHeight,
    ];

    const readPositive = (values: Array<number | undefined>): number => {
      const value = values.find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0);
      return Math.max(1, Math.round(value ?? 1));
    };

    return {
      width: readPositive(widthCandidates),
      height: readPositive(heightCandidates),
    };
  }

  private scheduleResize(): void {
    if (this.disposed) return;

    this.resizePending = true;
    this.stop();

    if (this.resizeTimerId !== null) {
      window.clearTimeout(this.resizeTimerId);
    }

    this.resizeTimerId = window.setTimeout(() => {
      this.resizeTimerId = null;
      if (this.disposed) return;

      this.resizePending = false;
      this.resize();
      this.requestFrame();
    }, 96);
  }

  private loadLayoutStore(): VisualizerLayoutStorageV1 {
    const raw = readJson<unknown>(STORAGE_KEYS.VISUALIZER_LAYOUT_V1, null);
    if (isLayoutStorage(raw)) {
      const scenes: Record<string, LayoutOverrides> = {};
      for (const [sceneId, sceneValue] of Object.entries(raw.scenes)) {
        scenes[sceneId] = sanitizeLayoutOverrides(sceneValue, this.viewport);
      }
      return {
        version: 3,
        scenes,
        views: raw.version >= 2 ? sanitizeViewStates((raw as { views?: unknown }).views) : {},
        viewModes: sanitizeViewModes(raw.viewModes),
        cameras: sanitizeCameraStorage(raw.cameras, this.viewport),
      };
    }

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        version: 3,
        scenes: {
          [this.sceneId]: sanitizeLayoutOverrides(raw, this.viewport),
        },
        views: {},
        viewModes: {},
        cameras: {},
      };
    }

    return { version: 3, scenes: {}, views: {}, viewModes: {}, cameras: {} };
  }

  private cloneCurrentLayout(): LayoutOverrides {
    const next: LayoutOverrides = {};
    for (const [id, transform] of Object.entries(this.layoutOverrides)) {
      next[id] = cloneTransform(transform, this.viewport, false);
    }
    return next;
  }

  private cloneCurrentViewState(): VisualizerCanvasViewState {
    return {
      panX: this.viewState.panX,
      panY: this.viewState.panY,
      zoom: this.viewState.zoom,
    };
  }

  private cloneActiveCameraState(): VisualizerWorkspaceCameraState {
    return {
      position: {
        x: this.activeCamera.position.x,
        y: this.activeCamera.position.y,
        z: this.activeCamera.position.z,
      },
      target: {
        x: this.orbitControls.target.x,
        y: this.orbitControls.target.y,
        z: this.orbitControls.target.z,
      },
      zoom: 'zoom' in this.activeCamera ? this.activeCamera.zoom : 1,
    };
  }

  private applyStoredViewState(sceneId: string): void {
    const view = this.layoutStore.views[sceneId] ?? createDefaultViewState(this.viewport);
    this.setSurfaceViewTransform(view.panX, view.panY, view.zoom);
  }

  private scheduleLayoutPersist(): void {
    if (this.layoutPersistTimer !== null || this.disposed) return;
    this.layoutPersistTimer = window.setTimeout(() => {
      this.layoutPersistTimer = null;
      this.persistLayoutNow();
    }, 120);
  }

  private persistLayoutNow(): void {
    if (this.disposed) return;
    const cameras = this.layoutStore.cameras ?? {};
    cameras[this.sceneId] = writeSceneCameraState(cameras[this.sceneId], this.viewMode, this.cloneActiveCameraState());
    this.layoutStore = {
      version: 3,
      scenes: {
        ...this.layoutStore.scenes,
        [this.sceneId]: this.cloneCurrentLayout(),
      },
      views: {
        ...this.layoutStore.views,
        [this.sceneId]: this.cloneCurrentViewState(),
      },
      viewModes: {
        ...(this.layoutStore.viewModes ?? {}),
        [this.sceneId]: this.viewMode,
      },
      cameras,
    };
    void broadcastDataUpdate(STORAGE_KEYS.VISUALIZER_LAYOUT_V1, this.layoutStore);
  }

  private flushLayoutPersist(): void {
    if (this.layoutPersistTimer !== null) {
      window.clearTimeout(this.layoutPersistTimer);
      this.layoutPersistTimer = null;
    }
    this.persistLayoutNow();
  }

  private configureComponentHostRoot(): void {
    if (!this.componentHostRoot) return;
    this.componentHostRoot.dataset.visualizerRole = 'componentHostRoot';
    this.componentHostRoot.dataset.visualizerEditableUnitId = SURFACE_ROOT_ID;
    this.componentHostRoot.dataset.visualizerViewMode = this.viewMode;
  }

  private createWorkspaceContext(): NonNullable<Parameters<ActiveVisualizerComponent['component']['initialize']>[0]['workspace']> {
    return {
      viewMode: this.viewMode,
      camera: this.activeCamera,
      renderer: this.renderer,
      componentHostRoot: this.componentHostRoot,
    };
  }

  private updateViewGizmoState(): void {
    if (!this.onViewGizmoChange || this.disposed) return;

    const cameraQuat = new THREE.Quaternion();
    this.activeCamera.getWorldQuaternion(cameraQuat);
    const inverseQuat = cameraQuat.clone().invert();
    const nextAxes = VIEW_GIZMO_AXIS_SPECS.map((spec) => {
      const local = spec.vector.clone().applyQuaternion(inverseQuat);
      const depth = Number.isFinite(local.z) ? local.z : 0;
      const normalized = Math.min(1, Math.hypot(local.x, local.y));
      const angle = Math.atan2(local.y, local.x);
      const radius = VIEW_GIZMO_RADIUS * normalized;
      return {
        id: spec.id,
        axis: spec.axis,
        direction: spec.direction,
        label: spec.label,
        x: VIEW_GIZMO_RADIUS + Math.cos(angle) * radius,
        y: VIEW_GIZMO_RADIUS - Math.sin(angle) * radius,
        depth,
        visible: depth > VIEW_GIZMO_DEPTH_EPSILON,
      };
    });
    const signature = nextAxes
      .map((axis) => [
        axis.id,
        axis.x.toFixed(1),
        axis.y.toFixed(1),
        axis.depth.toFixed(2),
        axis.visible ? '1' : '0',
      ].join(':'))
      .join('|');
    if (signature === this.viewGizmoSignature) return;
    this.viewGizmoSignature = signature;
    this.onViewGizmoChange({
      axes: nextAxes,
    });
  }

  private resolveSceneBounds(): VisualizerSceneBounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const entry of this.sceneComponents) {
      if (!entry.transform.visible) continue;
      const baseSize = resolveComponentBaseSize(entry.component.manifest.geometry);
      const scale = normalizeScale(entry.transform.scale);
      const rotation = getTransformRotation(entry.transform);
      const rawWidth = baseSize.width * scale.x;
      const rawHeight = baseSize.height * scale.y;
      const absCos = Math.abs(Math.cos(rotation));
      const absSin = Math.abs(Math.sin(rotation));
      const halfWidth = (rawWidth * absCos + rawHeight * absSin) / 2;
      const halfHeight = (rawWidth * absSin + rawHeight * absCos) / 2;
      const x = Number.isFinite(entry.transform.position.x) ? entry.transform.position.x : 0;
      const y = Number.isFinite(entry.transform.position.y) ? entry.transform.position.y : 0;
      minX = Math.min(minX, x - halfWidth);
      minY = Math.min(minY, y - halfHeight);
      maxX = Math.max(maxX, x + halfWidth);
      maxY = Math.max(maxY, y + halfHeight);
    }

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      const halfSize = REFERENCE_STAGE_SIZE / 2;
      minX = -halfSize;
      minY = -halfSize;
      maxX = halfSize;
      maxY = halfSize;
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
      minX,
      minY,
      maxX,
      maxY,
      centerX: minX + width / 2,
      centerY: minY + height / 2,
      width,
      height,
    };
  }

  private activateScene(sceneId: string): void {
    for (const entry of this.sceneComponents) {
      try {
        entry.component.dispose();
      } catch {
        // ignore
      }
    }
    this.sceneComponents.length = 0;
    this.sceneComponentMap.clear();

    const scene = resolveVisualizerScene(sceneId);

    for (const placement of scene.components) {
      const definition = this.registry.get(placement.id);
      if (!definition) {
        telemetry.warn('visualizer.scene.component.missing', {
          fields: { sceneId, componentId: placement.id },
        });
        continue;
      }

      const instance = definition.create();
      const baseTransform = cloneTransform({
        ...instance.manifest.defaultTransform,
        ...(placement.transform ?? {}),
        position: {
          ...instance.manifest.defaultTransform.position,
          ...(placement.transform?.position ?? {}),
        },
      });
      const transform = mergeTransforms(baseTransform, this.layoutOverrides[placement.id]);
      const config = {
        ...(placement.config ?? {}),
        ...(placement.id === REFERENCE_COMPONENT_IDS.progress
          ? { hoverInfo: this.progressHoverInfo }
          : {}),
      };
      const activeComponent: ActiveVisualizerComponent = {
        id: placement.id,
        component: instance,
        transform,
        config,
      };
      this.sceneComponents.push(activeComponent);
      this.sceneComponentMap.set(placement.id, activeComponent);

      void Promise.resolve(
        instance.initialize({
          audio: this.audioBus,
          viewport: this.viewport,
          transform,
          config,
          quality: this.quality,
          qualityLevel: this.quality.level,
          workspace: this.createWorkspaceContext(),
          requestRedraw: () => this.requestFrame(),
        })
      ).catch((error) => {
        telemetry.warn('visualizer.component.initialize.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: { componentId: instance.manifest.id },
        });
      });
    }

    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.rafId !== null || this.disposed) return;
    if (this.resizePending) {
      return;
    }

    this.rafId = window.requestAnimationFrame((timestamp) => {
      this.rafId = null;
      this.tick(timestamp);
    });
  }

  private tick(timestamp: number): void {
    if (this.disposed) return;
    if (this.resizePending) {
      return;
    }

    const fpsLimit = Math.max(MIN_VISUALIZER_FPS, this.quality.fpsLimit);
    const frameInterval = fpsLimit > 0 ? 1000 / fpsLimit : 0;
    if (
      frameInterval > 0 &&
      this.lastFrameAt > 0 &&
      timestamp - this.lastFrameAt + FRAME_INTERVAL_EPSILON_MS < frameInterval
    ) {
      this.requestFrame();
      return;
    }

    const deltaTime = this.lastFrameAt > 0 ? timestamp - this.lastFrameAt : 0;
    this.lastFrameAt = timestamp;
    const snapshot = this.audioBus.sample(timestamp);
    this.globalRotation += 0.001;
    this.orbitControls.update();
    this.updateViewGizmoState();
    const surfaceFrame = this.updateSurfaceFrame();
    const frameEditState: VisualizerCanvasEditState = {
      ...this.editState,
      panX: surfaceFrame.viewState.panX,
      panY: surfaceFrame.viewState.panY,
      zoom: surfaceFrame.viewState.zoom,
    };

    renderSceneFrame({
      ctx: this.surfaceContext,
      viewport: surfaceFrame.viewport,
      audioSnapshot: snapshot,
      frame: {
        timestamp,
        deltaTime,
        frameNumber: (this.frameNumber += 1),
        globalRotation: this.globalRotation,
      },
      scene: resolveVisualizerScene(this.sceneId),
      components: this.sceneComponents,
      quality: this.quality,
      viewState: surfaceFrame.viewState,
      editState: frameEditState,
      workspace: this.createWorkspaceContext(),
    });
    this.surfaceTexture.needsUpdate = true;

    this.renderer.render(this.scene, this.activeCamera);
    this.requestFrame();
  }

  private createSurfaceFrame(): VisualizerSurfaceFrame {
    const aspect = this.viewport.width / Math.max(1, this.viewport.height);
    const fallbackWidth = Math.max(this.viewport.width, REFERENCE_STAGE_SIZE + SURFACE_STAGE_PADDING * 2);
    const fallbackHeight = Math.max(this.viewport.height, fallbackWidth / aspect);
    const sceneBounds = this.resolveSceneBounds();

    const centerX = 0;
    const centerY = 0;
    let width = fallbackWidth;
    let height = fallbackHeight;
    width = Math.max(
      width,
      sceneBounds.width + SURFACE_STAGE_PADDING * 2,
      Math.max(Math.abs(sceneBounds.minX), Math.abs(sceneBounds.maxX), REFERENCE_STAGE_SIZE / 2) * 2 +
        SURFACE_STAGE_PADDING * 2
    );
    height = Math.max(
      height,
      sceneBounds.height + SURFACE_STAGE_PADDING * 2,
      Math.max(Math.abs(sceneBounds.minY), Math.abs(sceneBounds.maxY), REFERENCE_STAGE_SIZE / 2) * 2 +
        SURFACE_STAGE_PADDING * 2
    );

    const currentAspect = width / Math.max(1, height);
    if (currentAspect < aspect) {
      width = height * aspect;
    } else if (currentAspect > aspect) {
      height = width / aspect;
    }

    const maxWidth = Math.max(this.viewport.width, SURFACE_STAGE_MAX_SIZE);
    const maxHeight = Math.max(this.viewport.height, SURFACE_STAGE_MAX_SIZE / aspect);
    const clampScale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
    width = Math.max(REFERENCE_STAGE_SIZE, width * clampScale);
    height = Math.max(REFERENCE_STAGE_SIZE / aspect, height * clampScale);

    const maxTextureScale = SURFACE_TEXTURE_MAX_SIDE / Math.max(1, width, height);
    const texturePixelRatio = Math.max(
      0.75,
      Math.min(this.viewport.devicePixelRatio, maxTextureScale)
    );
    const frameViewport = createViewportInfo(width, height, texturePixelRatio);
    return {
      centerX,
      centerY,
      width: frameViewport.width,
      height: frameViewport.height,
      viewport: frameViewport,
      viewState: {
        panX: this.viewState.panX,
        panY: this.viewState.panY,
        zoom: this.viewState.zoom,
      },
    };
  }

  private updateSurfaceCanvasSize(frame: VisualizerSurfaceFrame): void {
    const ratio = Math.max(0.75, frame.viewport.devicePixelRatio);
    const width = Math.max(1, Math.round(frame.viewport.width * ratio));
    const height = Math.max(1, Math.round(frame.viewport.height * ratio));

    if (this.surfaceCanvas.width !== width) this.surfaceCanvas.width = width;
    if (this.surfaceCanvas.height !== height) this.surfaceCanvas.height = height;
    this.surfaceCanvas.style.width = `${frame.viewport.width}px`;
    this.surfaceCanvas.style.height = `${frame.viewport.height}px`;
    this.surfaceContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private updateSurfaceFrame(): VisualizerSurfaceFrame {
    const frame = this.createSurfaceFrame();

    this.surfaceFrame = frame;
    this.surfaceMesh.position.set(0, 0, 0);
    this.surfaceMesh.scale.set(frame.width, frame.height, 1);
    this.updateSurfaceCanvasSize(frame);

    return frame;
  }

  private setSurfaceViewTransform(panX: number, panY: number, zoom: number): void {
    const nextPanX = Number.isFinite(panX) ? panX : 0;
    const nextPanY = Number.isFinite(panY) ? panY : 0;
    const nextZoom = Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : DEFAULT_ZOOM;

    this.viewState.panX = nextPanX;
    this.viewState.panY = nextPanY;
    this.viewState.zoom = nextZoom;
    this.editState.panX = nextPanX;
    this.editState.panY = nextPanY;
    this.editState.zoom = nextZoom;
  }

  private getSurfacePoint(
    clientX: number,
    clientY: number,
    allowPlaneFallback = false
  ): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);

    const [hit] = this.raycaster.intersectObject(this.surfaceMesh, false);
    if (hit?.uv) {
      return {
        x: hit.uv.x * this.surfaceFrame.viewport.width,
        y: (1 - hit.uv.y) * this.surfaceFrame.viewport.height,
      };
    }

    if (!allowPlaneFallback) return null;

    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.surfaceMesh.matrixWorld).normalize();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.surfaceMesh.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const worldPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, worldPoint)) return null;

    const localPoint = this.surfaceMesh.worldToLocal(worldPoint.clone());
    return {
      x: (localPoint.x + 0.5) * this.surfaceFrame.viewport.width,
      y: (0.5 - localPoint.y) * this.surfaceFrame.viewport.height,
    };
  }

  private updateProgressHover(surfaceX: number, surfaceY: number): void {
    const progressEntry = this.sceneComponentMap.get(REFERENCE_COMPONENT_IDS.progress);
    if (!progressEntry?.transform.visible) {
      this.progressHoverInfo.active = false;
      return;
    }

    if (
      surfaceX < 0 ||
      surfaceY < 0 ||
      surfaceX > this.surfaceFrame.viewport.width ||
      surfaceY > this.surfaceFrame.viewport.height
    ) {
      this.progressHoverInfo.active = false;
      return;
    }

    const world = screenToWorld(surfaceX, surfaceY, this.surfaceFrame.viewport, this.surfaceFrame.viewState);
    const scaleValue = progressEntry.transform.scale;
    const scale =
      typeof scaleValue === 'number'
        ? scaleValue
        : (Math.max(0.05, scaleValue.x) + Math.max(0.05, scaleValue.y)) / 2;
    const localX = (world.x - progressEntry.transform.position.x) / scale;
    const localY = (world.y - progressEntry.transform.position.y) / scale;
    const distance = Math.hypot(localX, localY);
    const baseSize = resolveComponentBaseSize(progressEntry.component.manifest.geometry);
    const progressRadius = Math.min(baseSize.width, baseSize.height) * 0.28;

    if (Math.abs(distance - progressRadius) > PROGRESS_HOVER_TOLERANCE) {
      this.progressHoverInfo.active = false;
      return;
    }

    let angle = Math.atan2(localY, localX);
    if (angle < 0) {
      angle += Math.PI * 2;
    }
    this.progressHoverInfo.active = true;
    this.progressHoverInfo.angle = angle;
    this.progressHoverInfo.distance = distance;
  }

  private getHitTarget(clientX: number, clientY: number): VisualizerEditHitTarget | null {
    if (!this.editState.editMode) return null;

    const surfacePoint = this.getSurfacePoint(clientX, clientY, true);
    if (!surfacePoint) return null;

    const candidates = [...this.sceneComponents].sort((left, right) => {
      const leftActive =
        left.id === this.editState.selectedComponentId ||
        left.id === this.editState.hoveredComponentId ||
        left.id === this.editState.draggingComponentId ||
        left.id === this.editState.resizingComponentId;
      const rightActive =
        right.id === this.editState.selectedComponentId ||
        right.id === this.editState.hoveredComponentId ||
        right.id === this.editState.draggingComponentId ||
        right.id === this.editState.resizingComponentId;
      if (leftActive !== rightActive) return rightActive ? 1 : -1;
      return right.transform.zIndex - left.transform.zIndex;
    });

    const metricsById = getVisualizerEditMetricsById(
      candidates,
      this.surfaceFrame.viewport,
      this.surfaceFrame.viewState,
      this.surfaceContext
    );

    for (const entry of candidates) {
      if (!entry.transform.visible) continue;
      const isHandleVisible =
        entry.id === this.editState.selectedComponentId ||
        entry.id === this.editState.hoveredComponentId ||
        entry.id === this.editState.draggingComponentId ||
        entry.id === this.editState.resizingComponentId;
      if (!isHandleVisible) continue;

      const metrics = metricsById.get(entry.id);
      if (!metrics) continue;
      if (containsVisualizerEditRect(metrics.scaleHandle, surfacePoint.x, surfacePoint.y)) {
        return {
          type: 'scale-handle',
          componentId: entry.id,
          handle: 'scale',
        };
      }
    }

    for (const entry of candidates) {
      if (!entry.transform.visible) continue;
      const metrics = metricsById.get(entry.id);
      if (metrics && containsVisualizerEditRect(metrics.label, surfacePoint.x, surfacePoint.y)) {
        return {
          type: 'label',
          componentId: entry.id,
        };
      }
    }

    return null;
  }

  private selectComponent(componentId: string | null): void {
    if (this.editState.selectedComponentId === componentId) return;

    const previousId = this.editState.selectedComponentId;
    if (previousId) {
      this.sceneComponentMap.get(previousId)?.component.onFocusChange?.(false);
    }

    this.editState.selectedComponentId = componentId;

    if (componentId) {
      this.sceneComponentMap.get(componentId)?.component.onFocusChange?.(true);
    }
  }

  private getCurrentHoverTarget(): VisualizerEditHitTarget | null {
    if (!this.editState.hoveredComponentId) return null;
    return {
      type: this.editState.hoveredHandle === 'scale' ? 'scale-handle' : 'label',
      componentId: this.editState.hoveredComponentId,
      handle: this.editState.hoveredHandle ?? undefined,
    };
  }

  private updateCursor(target: VisualizerEditHitTarget | null, dragging = false): void {
    if (dragging) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (!this.editState.editMode) {
      this.canvas.style.cursor = 'grab';
      return;
    }

    if (target?.type === 'scale-handle' || this.pointerDrag?.mode === 'resize') {
      this.canvas.style.cursor = 'nwse-resize';
      return;
    }

    this.canvas.style.cursor = target?.componentId ? 'grab' : 'default';
  }

  private clearCanvasInteractionCursor(): void {
    this.canvas.style.removeProperty('cursor');
  }

  private updateComponentTransform(
    componentId: string,
    updater: (current: VisualizerComponentTransform) => VisualizerComponentTransform
  ): void {
    const entry = this.sceneComponentMap.get(componentId);
    if (!entry) return;

    const nextTransform = updater(entry.transform);
    entry.transform = nextTransform;
    this.layoutOverrides[componentId] = nextTransform;
    entry.component.onTransformChange?.(nextTransform);
    this.scheduleLayoutPersist();
    this.requestFrame();
  }

  private finishPointerDrag(forcePersist = false): void {
    if (!this.pointerDrag) return;

    if (forcePersist) {
      this.flushLayoutPersist();
    } else {
      this.scheduleLayoutPersist();
    }

    this.editState.draggingComponentId = null;
    this.editState.resizingComponentId = null;
    this.editState.activeHandle = null;
    this.pointerDrag = null;
    this.orbitControls.enabled = true;
    this.updateCursor(this.getCurrentHoverTarget(), false);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.disposed || event.button !== 0) return;

    const hit = this.getHitTarget(event.clientX, event.clientY);
    const surfacePoint = this.getSurfacePoint(event.clientX, event.clientY, true);
    if (!surfacePoint) return;

    const world = screenToWorld(
      surfacePoint.x,
      surfacePoint.y,
      this.surfaceFrame.viewport,
      this.surfaceFrame.viewState
    );

    if (this.editState.editMode && hit?.type === 'scale-handle') {
      const entry = this.sceneComponentMap.get(hit.componentId);
      if (!entry) return;

      const initialTransform = cloneTransform(entry.transform, this.viewport, false);
      this.selectComponent(hit.componentId);
      this.pointerDrag = {
        mode: 'resize',
        pointerId: event.pointerId,
        startWorldX: world.x,
        startWorldY: world.y,
        componentId: hit.componentId,
        initialTransform,
        initialScale: getVisualizerUniformScale(initialTransform),
        initialResizeDistance: Math.max(
          1,
          Math.hypot(world.x - initialTransform.position.x, world.y - initialTransform.position.y)
        ),
        resizeCenterX: initialTransform.position.x,
        resizeCenterY: initialTransform.position.y,
        handle: hit.handle,
      };
      this.editState.resizingComponentId = hit.componentId;
      this.editState.hoveredComponentId = hit.componentId;
      this.editState.hoveredHandle = hit.handle ?? null;
      this.editState.activeHandle = hit.handle ?? null;
      this.orbitControls.enabled = false;
      this.updateCursor(hit, true);
      this.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
      this.requestFrame();
      return;
    }

    if (this.editState.editMode && hit?.type) {
      const entry = this.sceneComponentMap.get(hit.componentId);
      if (!entry) return;

      this.selectComponent(hit.componentId);
      this.pointerDrag = {
        mode: 'component',
        pointerId: event.pointerId,
        startWorldX: world.x,
        startWorldY: world.y,
        componentId: hit.componentId,
        initialTransform: cloneTransform(entry.transform, this.viewport, false),
      };
      this.editState.draggingComponentId = hit.componentId;
      this.editState.hoveredComponentId = hit.componentId;
      this.editState.hoveredHandle = null;
      this.editState.activeHandle = null;
      this.orbitControls.enabled = false;
      this.updateCursor(hit, true);
      this.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
      this.requestFrame();
      return;
    }

    if (this.editState.editMode) {
      this.selectComponent(null);
      this.editState.hoveredComponentId = null;
      this.editState.hoveredHandle = null;
      this.editState.activeHandle = null;
      this.clearCanvasInteractionCursor();
      this.requestFrame();
      return;
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.disposed) return;

    if (this.pointerDrag && this.pointerDrag.pointerId === event.pointerId) {
      const surfacePoint = this.getSurfacePoint(event.clientX, event.clientY, true);
      if (!surfacePoint) return;

      const world = screenToWorld(
        surfacePoint.x,
        surfacePoint.y,
        this.surfaceFrame.viewport,
        this.surfaceFrame.viewState
      );

      if (this.pointerDrag.mode === 'component') {
        const deltaX = world.x - this.pointerDrag.startWorldX;
        const deltaY = world.y - this.pointerDrag.startWorldY;
        const snapToGrid = this.editState.snapToGrid && !event.altKey;
        const gridSize = Math.max(4, this.editState.gridSize);

        this.updateComponentTransform(this.pointerDrag.componentId, (current) => {
          const initial = this.pointerDrag?.initialTransform ?? current;
          const nextX = initial.position.x + deltaX;
          const nextY = initial.position.y + deltaY;
          const snappedX = snapToGrid ? Math.round(nextX / gridSize) * gridSize : nextX;
          const snappedY = snapToGrid ? Math.round(nextY / gridSize) * gridSize : nextY;
          return {
            ...current,
            position: {
              x: snappedX,
              y: snappedY,
              z: initial.position.z,
            },
          };
        });
      } else if (this.pointerDrag.mode === 'resize') {
        const centerX = this.pointerDrag.resizeCenterX ?? this.pointerDrag.initialTransform.position.x;
        const centerY = this.pointerDrag.resizeCenterY ?? this.pointerDrag.initialTransform.position.y;
        const initialDistance = Math.max(1, this.pointerDrag.initialResizeDistance ?? 1);
        const initialScale = this.pointerDrag.initialScale ?? getVisualizerUniformScale(this.pointerDrag.initialTransform);
        const distance = Math.max(1, Math.hypot(world.x - centerX, world.y - centerY));
        const rawScale = initialScale * (distance / initialDistance);
        const nextScale = event.shiftKey ? Math.round(rawScale / 0.05) * 0.05 : rawScale;

        this.updateComponentTransform(this.pointerDrag.componentId, (current) =>
          withUniformScale(current, nextScale)
        );
      }

      this.requestFrame();
      return;
    }

    if (this.editState.editMode) {
      this.progressHoverInfo.active = false;
      const hit = this.getHitTarget(event.clientX, event.clientY);
      this.editState.hoveredComponentId = hit?.componentId ?? null;
      this.editState.hoveredHandle = hit?.handle ?? null;
      this.updateCursor(hit, false);
      this.requestFrame();
      return;
    }

    const surfacePoint = this.getSurfacePoint(event.clientX, event.clientY, false);
    if (!surfacePoint) {
      this.progressHoverInfo.active = false;
      this.requestFrame();
      return;
    }

    this.updateProgressHover(surfacePoint.x, surfacePoint.y);
    this.requestFrame();
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.disposed) return;
    if (!this.pointerDrag || this.pointerDrag.pointerId !== event.pointerId) return;

    this.finishPointerDrag(true);
    this.canvas.releasePointerCapture?.(event.pointerId);
    const hit = this.getHitTarget(event.clientX, event.clientY);
    this.editState.hoveredComponentId = hit?.componentId ?? null;
    this.editState.hoveredHandle = hit?.handle ?? null;
    this.updateCursor(hit, false);
    this.requestFrame();
  }

  private handleWheel(event: WheelEvent): void {
    if (this.disposed) return;

    const hit = this.editState.editMode ? this.getHitTarget(event.clientX, event.clientY) : null;
    const targetId = hit?.componentId ?? null;
    const zoomFactor = event.deltaY < 0 ? 1.05 : 0.95;

    if (this.editState.editMode && targetId) {
      event.preventDefault();
      event.stopPropagation();
      this.selectComponent(targetId);
      this.editState.hoveredComponentId = targetId;
      this.editState.hoveredHandle = hit?.handle ?? null;
      this.updateComponentTransform(targetId, (current) =>
        withUniformScale(current, getVisualizerUniformScale(current) * zoomFactor)
      );
      this.updateCursor(hit, false);
      return;
    }

    if (!this.editState.editMode) {
      const surfacePoint = this.getSurfacePoint(event.clientX, event.clientY, false);
      if (surfacePoint) {
        this.updateProgressHover(surfacePoint.x, surfacePoint.y);
      }
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.disposed || !this.editState.editMode) return;
    if (event.defaultPrevented) return;

    const targetId = this.editState.selectedComponentId ?? this.editState.hoveredComponentId;
    if (!targetId) return;

    if (event.key === '[' || event.key === '-') {
      event.preventDefault();
      event.stopPropagation();
      this.updateComponentTransform(targetId, (current) => ({
        ...current,
        zIndex: current.zIndex - 1,
      }));
      return;
    }

    if (event.key === ']' || event.key === '=' || event.key === '+') {
      event.preventDefault();
      event.stopPropagation();
      this.updateComponentTransform(targetId, (current) => ({
        ...current,
        zIndex: current.zIndex + 1,
      }));
    }
  }

  private updateCameraProjection(): void {
    const aspect = this.viewport.width / Math.max(1, this.viewport.height);
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const halfWidth = this.viewport.width / 2;
    const halfHeight = this.viewport.height / 2;
    for (const camera of [this.topCamera, this.frontCamera, this.sideCamera]) {
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.near = CAMERA_NEAR;
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }

  private applyCameraState(mode: VisualizerWorkspaceViewMode, state: VisualizerWorkspaceCameraState): void {
    const camera = this.cameraByMode[mode];
    camera.position.set(state.position.x, state.position.y, state.position.z);
    camera.up.set(0, 1, 0);
    if (mode === 'top') {
      camera.up.set(0, 0, -1);
    }
    if ('zoom' in camera) {
      camera.zoom = state.zoom;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(state.target.x, state.target.y, state.target.z);
  }

  private applyStoredCameraState(mode: VisualizerWorkspaceViewMode): void {
    const stored = readSceneCameraState(this.layoutStore.cameras?.[this.sceneId], mode);
    this.applyCameraState(mode, stored ?? createDefaultCameraState(mode, this.viewport));
  }

  private rebindControls(): void {
    this.activeCamera = this.cameraByMode[this.viewMode];
    this.orbitControls.object = this.activeCamera;
    this.orbitControls.target.copy(
      readSceneCameraState(this.layoutStore.cameras?.[this.sceneId], this.viewMode)?.target ??
        createDefaultCameraState(this.viewMode, this.viewport).target
    );
    this.orbitControls.enableRotate = this.viewMode === 'perspective';
    this.orbitControls.minPolarAngle =
      this.viewMode === 'perspective' ? PERSPECTIVE_MIN_POLAR_ANGLE : 0;
    this.orbitControls.maxPolarAngle =
      this.viewMode === 'perspective' ? PERSPECTIVE_MAX_POLAR_ANGLE : Math.PI;
    this.orbitControls.enablePan = true;
    this.orbitControls.enableZoom = true;
    this.orbitControls.update();
    this.worldGridGroup.visible = this.viewMode === 'perspective';
    this.transformControls.camera = this.activeCamera;
    this.transformControls.enabled = false;
    this.transformControls.detach();
    this.transformControlsHelper.visible = false;
    this.configureComponentHostRoot();
  }

  private applyStoredViewMode(mode: VisualizerWorkspaceViewMode): void {
    this.viewMode = mode;
    this.applyStoredCameraState(mode);
    this.rebindControls();
  }

  resize(): boolean {
    if (this.disposed) return false;
    const { width: cssWidth, height: cssHeight } = this.readLayoutSize();
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const scaledRatio = pixelRatio * Math.max(0.5, this.quality.renderScale);
    const nextRatio = Math.max(0.5, Math.min(2, scaledRatio));
    const changed =
      this.viewport.width !== cssWidth ||
      this.viewport.height !== cssHeight ||
      this.viewport.devicePixelRatio !== nextRatio;

    this.renderer.setPixelRatio(nextRatio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    this.viewport = createViewportInfo(cssWidth, cssHeight, nextRatio);
    this.updateCameraProjection();

    return changed;
  }

  setQuality(nextQuality: VisualizerComponentQuality): void {
    this.quality = nextQuality;
    if (!this.resizePending) {
      this.resize();
    }
    this.requestFrame();
  }

  setScene(sceneId: string): void {
    if (this.sceneId === sceneId) return;

    this.flushLayoutPersist();
    this.sceneId = sceneId;
    this.layoutOverrides = this.layoutStore.scenes[this.sceneId] ?? {};
    this.applyStoredViewState(sceneId);
    this.applyStoredViewMode(this.layoutStore.viewModes?.[sceneId] ?? this.viewMode);
    this.selectComponent(null);
    this.editState.hoveredComponentId = null;
    this.editState.draggingComponentId = null;
    this.editState.resizingComponentId = null;
    this.editState.hoveredHandle = null;
    this.editState.activeHandle = null;
    this.pointerDrag = null;
    this.activateScene(sceneId);
    this.updateViewGizmoState();
    this.requestFrame();
  }

  setViewMode(mode: VisualizerWorkspaceViewMode): void {
    if (!isViewMode(mode) || this.viewMode === mode) return;

    this.flushLayoutPersist();
    this.viewMode = mode;
    this.applyStoredCameraState(mode);
    this.rebindControls();
    this.scheduleLayoutPersist();
    this.updateViewGizmoState();
    this.requestFrame();
  }

  setCameraOrbitPreset(preset: VisualizerCameraOrbitPreset): void {
    if (this.disposed) return;

    if (preset === 'home') {
      const defaultView = createDefaultViewState(this.viewport);
      this.setSurfaceViewTransform(0, 0, defaultView.zoom);
    }

    const nextViewMode: VisualizerWorkspaceViewMode = preset === 'home' ? DEFAULT_VIEW_MODE : 'perspective';
    const currentCamera = this.cloneActiveCameraState();
    const nextCamera = createCameraOrbitPresetState(
      preset,
      {
        ...currentCamera,
        target: { x: 0, y: 0, z: 0 },
      },
      this.viewport
    );
    this.viewMode = nextViewMode;
    this.activeCamera = this.cameraByMode[nextViewMode];
    this.applyCameraState(nextViewMode, nextCamera);
    this.orbitControls.object = this.activeCamera;
    this.orbitControls.target.set(nextCamera.target.x, nextCamera.target.y, nextCamera.target.z);
    this.orbitControls.enableRotate = nextViewMode === 'perspective';
    this.orbitControls.minPolarAngle = nextViewMode === 'perspective' ? PERSPECTIVE_MIN_POLAR_ANGLE : 0;
    this.orbitControls.maxPolarAngle = nextViewMode === 'perspective' ? PERSPECTIVE_MAX_POLAR_ANGLE : Math.PI;
    this.orbitControls.enablePan = true;
    this.orbitControls.enableZoom = true;
    this.orbitControls.update();
    this.worldGridGroup.visible = nextViewMode === 'perspective';
    this.transformControls.camera = this.activeCamera;
    this.configureComponentHostRoot();
    this.scheduleLayoutPersist();
    this.updateViewGizmoState();
    this.requestFrame();
  }

  centerCanvas(): void {
    if (this.disposed) return;

    const currentView = this.cloneCurrentViewState();
    const currentCamera = this.cloneActiveCameraState();
    const cameraOffset = new THREE.Vector3(
      currentCamera.position.x - currentCamera.target.x,
      currentCamera.position.y - currentCamera.target.y,
      currentCamera.position.z - currentCamera.target.z
    );
    this.setSurfaceViewTransform(0, 0, currentView.zoom);
    this.applyCameraState(this.viewMode, {
      position: {
        x: cameraOffset.x,
        y: cameraOffset.y,
        z: cameraOffset.z,
      },
      target: { x: 0, y: 0, z: 0 },
      zoom: currentCamera.zoom,
    });
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();
    this.scheduleLayoutPersist();
    this.updateViewGizmoState();
    this.requestFrame();
  }

  resetCanvasSize(): void {
    if (this.disposed) return;

    const defaultView = createDefaultViewState(this.viewport);
    this.setSurfaceViewTransform(this.viewState.panX, this.viewState.panY, defaultView.zoom);
    this.applyCameraState(this.viewMode, createDefaultCameraState(this.viewMode, this.viewport));
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();
    this.scheduleLayoutPersist();
    this.updateViewGizmoState();
    this.requestFrame();
  }

  setEditMode(editMode: boolean): void {
    if (this.editState.editMode === editMode) return;

    this.editState.editMode = editMode;
    this.progressHoverInfo.active = false;

    if (editMode) {
      this.orbitControls.enabled = true;
      this.transformControls.detach();
      this.transformControls.enabled = false;
      this.transformControlsHelper.visible = false;
      this.updateCursor(this.getCurrentHoverTarget(), false);
    } else {
      this.finishPointerDrag(true);
      this.orbitControls.enabled = true;
      this.editState.hoveredComponentId = null;
      this.editState.draggingComponentId = null;
      this.editState.resizingComponentId = null;
      this.editState.hoveredHandle = null;
      this.editState.activeHandle = null;
      this.selectComponent(null);
      this.transformControls.detach();
      this.transformControls.enabled = false;
      this.transformControlsHelper.visible = false;
      this.flushLayoutPersist();
      this.clearCanvasInteractionCursor();
    }

    this.requestFrame();
  }

  setComponentVisibilityOverrides(
    overrides: Readonly<Record<string, boolean>> | null | undefined
  ): void {
    if (this.disposed || !overrides) return;

    for (const [componentId, visible] of Object.entries(overrides)) {
      if (typeof visible !== 'boolean') continue;
      const entry = this.sceneComponentMap.get(componentId);
      if (!entry || entry.transform.visible === visible) continue;
      this.updateComponentTransform(componentId, (current) => ({
        ...current,
        visible,
      }));
    }
  }

  resetLayout(): void {
    this.layoutOverrides = {};
    this.layoutStore.scenes[this.sceneId] = {};
    const defaultView = createDefaultViewState(this.viewport);
    this.setSurfaceViewTransform(defaultView.panX, defaultView.panY, defaultView.zoom);
    this.applyCameraState(this.viewMode, createDefaultCameraState(this.viewMode, this.viewport));
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();
    this.surfaceGroup.position.set(0, 0, 0);
    this.surfaceGroup.rotation.set(-Math.PI / 2, 0, 0);
    this.surfaceGroup.scale.set(1, 1, 1);
    this.editState.hoveredComponentId = null;
    this.editState.draggingComponentId = null;
    this.editState.resizingComponentId = null;
    this.editState.hoveredHandle = null;
    this.editState.activeHandle = null;
    this.selectComponent(null);
    this.pointerDrag = null;

    for (const entry of this.sceneComponents) {
      const defaultTransform = cloneTransform(
        {
          ...entry.component.manifest.defaultTransform,
          position: {
            ...entry.component.manifest.defaultTransform.position,
          },
        },
        this.viewport,
        false
      );
      entry.transform = defaultTransform;
      entry.component.onTransformChange?.(defaultTransform);
      const sceneEntry = this.sceneComponentMap.get(entry.id);
      if (sceneEntry) {
        sceneEntry.transform = defaultTransform;
      }
    }

    this.flushLayoutPersist();
    this.updateViewGizmoState();
    this.requestFrame();
  }

  start(): void {
    if (this.disposed || this.rafId !== null) return;
    telemetry.info('visualizer.workspace.runtime.start', {
      fields: { sceneId: this.sceneId, viewMode: this.viewMode },
    });
    this.requestFrame();
  }

  stop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.flushLayoutPersist();
    this.disposed = true;
    this.stop();
    if (this.resizeTimerId !== null) {
      window.clearTimeout(this.resizeTimerId);
      this.resizeTimerId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const cleanup of this.cleanupTasks.splice(0)) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
    for (const entry of this.sceneComponents) {
      try {
        entry.component.dispose();
      } catch {
        // ignore
      }
    }
    this.sceneComponents.length = 0;
    this.sceneComponentMap.clear();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbitControls.dispose();
    for (const object of this.worldGridGroup.children) {
      const line = object as THREE.LineSegments;
      line.geometry?.dispose();
      const lineMaterial = line.material;
      if (Array.isArray(lineMaterial)) {
        for (const entry of lineMaterial) entry.dispose();
      } else {
        lineMaterial?.dispose();
      }
    }
    this.worldGridGroup.clear();
    this.surfaceTexture.dispose();
    this.surfaceMesh.geometry.dispose();
    const material = this.surfaceMesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
    this.renderer.dispose();
    this.audioBus.dispose();
    this.registry.dispose();
    this.canvas.style.removeProperty('width');
    this.canvas.style.removeProperty('height');
    telemetry.info('visualizer.workspace.runtime.dispose', {
      fields: { sceneId: this.sceneId, viewMode: this.viewMode },
    });
  }
}
