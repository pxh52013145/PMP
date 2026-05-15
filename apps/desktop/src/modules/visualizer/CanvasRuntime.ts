/* eslint-disable no-restricted-imports */
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { readJson } from '../storage';
import { broadcastDataUpdate, STORAGE_KEYS } from '../../utils/windowCommunication';
import { AudioDataBus } from './AudioDataBus';
import { ComponentRegistry } from './ComponentRegistry';
import { clamp, createViewportInfo, resolveComponentBaseSize, screenToWorld } from './CoordinateSystem';
import {
  containsVisualizerEditRect,
  getVisualizerEditMetrics,
  getVisualizerUniformScale,
  type VisualizerEditHandleKind,
} from './editorGeometry';
import { REFERENCE_COMPONENT_IDS, REFERENCE_VISUALIZER_COMPONENT_DEFINITIONS } from './components/reference';
import { renderSceneFrame, type ActiveVisualizerComponent } from './RenderPipeline';
import { resolveVisualizerScene } from './scenes';
import type {
  VisualizerCanvasEditState,
  VisualizerCanvasViewState,
  VisualizerComponentQuality,
  VisualizerComponentPosition,
  VisualizerComponentRotation,
  VisualizerComponentScale,
  VisualizerComponentTransform,
  VisualizerRuntimeOptions,
  VisualizerViewportInfo,
} from './types';

const telemetry = getTelemetryLogger('visualizer', 'CanvasRuntime');
const EDIT_GRID_SIZE = 40;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const CANVAS_EDGE_PAN_GUARD_PX = 8;
const PROGRESS_HOVER_TOLERANCE = 40;
const MIN_VISUALIZER_FPS = 60;
const FRAME_INTERVAL_EPSILON_MS = 1;
const REFERENCE_STAGE_SIZE = 840;

type LayoutOverrides = Record<string, VisualizerComponentTransform>;

interface VisualizerLayoutStorageV1 {
  version: 1 | 2;
  scenes: Record<string, LayoutOverrides>;
  views: Record<string, VisualizerCanvasViewState>;
}

type DragMode = 'component' | 'pan' | 'resize';

interface VisualizerEditHitTarget {
  type: 'label' | 'scale-handle';
  componentId: string;
  handle?: VisualizerEditHandleKind;
}

interface PointerDragState {
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  initialPanX: number;
  initialPanY: number;
  componentId?: string;
  initialTransform?: VisualizerComponentTransform;
  initialScale?: number;
  initialResizeDistance?: number;
  resizeCenterX?: number;
  resizeCenterY?: number;
  handle?: VisualizerEditHandleKind;
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

function isLayoutStorage(value: unknown): value is VisualizerLayoutStorageV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.version === 1 || record.version === 2) &&
    !!record.scenes &&
    typeof record.scenes === 'object' &&
    !Array.isArray(record.scenes)
  );
}

export class CanvasRuntime {
  private readonly canvas: HTMLCanvasElement;

  private readonly resizeTarget: HTMLElement;

  private readonly context: CanvasRenderingContext2D;

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

  private readonly editState: VisualizerCanvasEditState = {
    panX: 0,
    panY: 0,
    zoom: DEFAULT_ZOOM,
    editMode: false,
    hoveredComponentId: null,
    selectedComponentId: null,
    draggingComponentId: null,
    resizingComponentId: null,
    hoveredHandle: null,
    activeHandle: null,
    snapToGrid: true,
    gridSize: EDIT_GRID_SIZE,
  };

  private layoutStore: VisualizerLayoutStorageV1 = { version: 2, scenes: {}, views: {} };

  private layoutOverrides: LayoutOverrides = {};

  private layoutPersistTimer: number | null = null;

  private pointerDrag: PointerDragState | null = null;

  private readonly progressHoverInfo = {
    active: false,
    angle: 0,
    distance: 0,
  };

  private quality: VisualizerComponentQuality;

  private sceneId: string;

  private frameNumber = 0;

  private globalRotation = 0;

  private lastFrameAt = 0;

  private rafId: number | null = null;

  private resizeObserver: ResizeObserver | null = null;

  private resizeTimerId: number | null = null;

  private resizePending = false;

  private disposed = false;

  private readonly cleanupTasks: Array<() => void> = [];

  constructor(options: VisualizerRuntimeOptions) {
    this.canvas = options.canvas;
    this.resizeTarget = this.canvas.parentElement ?? this.canvas;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Visualizer canvas 2D context is unavailable');
    }

    this.context = context;
    this.quality = options.quality;
    this.sceneId = options.sceneId;
    this.audioBus = new AudioDataBus(options.audioService);
    this.registry.registerMany(REFERENCE_VISUALIZER_COMPONENT_DEFINITIONS);
    this.attachResizeObserver();
    this.attachInteractionListeners();
    this.resize();
    this.layoutStore = this.loadLayoutStore();
    this.layoutOverrides = this.layoutStore.scenes[this.sceneId] ?? {};
    this.applyStoredViewState(this.sceneId);
    this.activateScene(this.sceneId);
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
    const onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
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

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointerleave', onPointerLeave);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    this.cleanupTasks.push(
      () => this.canvas.removeEventListener('pointerdown', onPointerDown),
      () => this.canvas.removeEventListener('pointerleave', onPointerLeave),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('pointermove', onPointerMove),
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
        version: 2,
        scenes,
        views: raw.version === 2 ? sanitizeViewStates((raw as { views?: unknown }).views) : {},
      };
    }

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        version: 2,
        scenes: {
          [this.sceneId]: sanitizeLayoutOverrides(raw, this.viewport),
        },
        views: {},
      };
    }

    return { version: 2, scenes: {}, views: {} };
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

  private applyStoredViewState(sceneId: string): void {
    const view = this.layoutStore.views[sceneId] ?? createDefaultViewState(this.viewport);
    this.setViewTransform(view.panX, view.panY, view.zoom);
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
    this.layoutStore.scenes[this.sceneId] = this.cloneCurrentLayout();
    this.layoutStore.views[this.sceneId] = this.cloneCurrentViewState();
    void broadcastDataUpdate(STORAGE_KEYS.VISUALIZER_LAYOUT_V1, this.layoutStore);
  }

  private flushLayoutPersist(): void {
    if (this.layoutPersistTimer !== null) {
      window.clearTimeout(this.layoutPersistTimer);
      this.layoutPersistTimer = null;
    }
    this.persistLayoutNow();
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
          requestRedraw: () => this.requestFrame(),
        })
      ).catch((error) => {
        telemetry.warn('visualizer.component.initialize.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: { componentId: instance.manifest.id },
        });
      });
    }

    this.updateCursor(null);
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

    renderSceneFrame({
      ctx: this.context,
      viewport: this.viewport,
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
      viewState: this.viewState,
      editState: this.editState,
    });

    this.requestFrame();
  }

  private updateProgressHover(clientX: number, clientY: number): void {
    const progressEntry = this.sceneComponentMap.get(REFERENCE_COMPONENT_IDS.progress);
    if (!progressEntry?.transform.visible) {
      this.progressHoverInfo.active = false;
      return;
    }

    const point = this.getCanvasPoint(clientX, clientY);
    if (point.x < 0 || point.y < 0 || point.x > this.viewport.width || point.y > this.viewport.height) {
      this.progressHoverInfo.active = false;
      return;
    }

    const world = screenToWorld(point.x, point.y, this.viewport, this.viewState);
    const scale = getVisualizerUniformScale(progressEntry.transform);
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

  private setViewTransform(panX: number, panY: number, zoom: number, persist = false): void {
    const nextPanX = Number.isFinite(panX) ? panX : 0;
    const nextPanY = Number.isFinite(panY) ? panY : 0;
    const nextZoom = Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : DEFAULT_ZOOM;

    this.viewState.panX = nextPanX;
    this.viewState.panY = nextPanY;
    this.viewState.zoom = nextZoom;
    this.editState.panX = nextPanX;
    this.editState.panY = nextPanY;
    this.editState.zoom = nextZoom;

    if (persist) {
      this.scheduleLayoutPersist();
    }
  }

  private updateCursor(target: VisualizerEditHitTarget | null, dragging = false, panning = false): void {
    if (dragging || panning) {
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

    this.canvas.style.cursor = target?.componentId ? 'grab' : 'grab';
  }

  private getCanvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private isInCanvasEdgePanGuard(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return false;

    const edgeSize = Math.min(
      CANVAS_EDGE_PAN_GUARD_PX,
      Math.max(0, rect.width / 3),
      Math.max(0, rect.height / 3)
    );

    return (
      x <= edgeSize ||
      y <= edgeSize ||
      rect.width - x <= edgeSize ||
      rect.height - y <= edgeSize
    );
  }

  private clearCanvasInteractionCursor(): void {
    this.canvas.style.removeProperty('cursor');
  }

  private getHitTarget(clientX: number, clientY: number): VisualizerEditHitTarget | null {
    if (!this.editState.editMode) return null;

    const point = this.getCanvasPoint(clientX, clientY);
    const candidates = [...this.sceneComponents].sort((left, right) => {
      const leftActive = left.id === this.editState.selectedComponentId || left.id === this.editState.hoveredComponentId;
      const rightActive = right.id === this.editState.selectedComponentId || right.id === this.editState.hoveredComponentId;
      if (leftActive !== rightActive) return rightActive ? 1 : -1;
      return right.transform.zIndex - left.transform.zIndex;
    });

    for (const entry of candidates) {
      if (!entry.transform.visible) continue;
      const isHandleVisible =
        entry.id === this.editState.selectedComponentId ||
        entry.id === this.editState.hoveredComponentId ||
        entry.id === this.editState.draggingComponentId ||
        entry.id === this.editState.resizingComponentId;
      if (!isHandleVisible) continue;

      const metrics = getVisualizerEditMetrics(entry, this.viewport, this.viewState, this.context);
      if (containsVisualizerEditRect(metrics.scaleHandle, point.x, point.y)) {
        return {
          type: 'scale-handle',
          componentId: entry.id,
          handle: 'scale',
        };
      }
    }

    for (const entry of candidates) {
      if (!entry.transform.visible) continue;
      const metrics = getVisualizerEditMetrics(entry, this.viewport, this.viewState, this.context);
      if (containsVisualizerEditRect(metrics.label, point.x, point.y)) {
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

  private handlePointerDown(event: PointerEvent): void {
    if (this.disposed || event.button !== 0) return;

    const hit = this.getHitTarget(event.clientX, event.clientY);
    const point = this.getCanvasPoint(event.clientX, event.clientY);
    const world = screenToWorld(point.x, point.y, this.viewport, this.viewState);

    if (this.editState.editMode && hit?.type === 'scale-handle') {
      const entry = this.sceneComponentMap.get(hit.componentId);
      if (!entry) return;

      const initialTransform = cloneTransform(entry.transform, this.viewport, false);
      this.selectComponent(hit.componentId);
      this.pointerDrag = {
        mode: 'resize',
        pointerId: event.pointerId,
        startClientX: point.x,
        startClientY: point.y,
        startWorldX: world.x,
        startWorldY: world.y,
        initialPanX: this.viewState.panX,
        initialPanY: this.viewState.panY,
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
      this.updateCursor(hit);
      this.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      this.requestFrame();
      return;
    }

    if (this.editState.editMode && hit?.type === 'label') {
      const entry = this.sceneComponentMap.get(hit.componentId);
      if (!entry) return;

      this.selectComponent(hit.componentId);
      this.pointerDrag = {
        mode: 'component',
        pointerId: event.pointerId,
        startClientX: point.x,
        startClientY: point.y,
        startWorldX: world.x,
        startWorldY: world.y,
        initialPanX: this.viewState.panX,
        initialPanY: this.viewState.panY,
        componentId: hit.componentId,
        initialTransform: cloneTransform(entry.transform, this.viewport, false),
      };
      this.editState.draggingComponentId = hit.componentId;
      this.editState.hoveredComponentId = hit.componentId;
      this.editState.hoveredHandle = null;
      this.updateCursor(hit, true, false);
      this.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      this.requestFrame();
      return;
    }

    if (this.editState.editMode) {
      this.selectComponent(null);
      this.editState.hoveredHandle = null;
    }

    if (this.isInCanvasEdgePanGuard(event.clientX, event.clientY)) {
      this.clearCanvasInteractionCursor();
      return;
    }

    this.pointerDrag = {
      mode: 'pan',
      pointerId: event.pointerId,
      startClientX: point.x,
      startClientY: point.y,
      startWorldX: world.x,
      startWorldY: world.y,
      initialPanX: this.viewState.panX,
      initialPanY: this.viewState.panY,
    };
    if (this.editState.editMode) {
      this.editState.hoveredHandle = null;
    }
    this.updateCursor(null, false, true);
    this.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    this.requestFrame();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.disposed) return;

    const point = this.getCanvasPoint(event.clientX, event.clientY);
    const world = screenToWorld(point.x, point.y, this.viewport, this.viewState);

    if (this.pointerDrag && this.pointerDrag.pointerId === event.pointerId) {
      if (this.pointerDrag.mode === 'component' && this.pointerDrag.componentId && this.pointerDrag.initialTransform) {
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
      } else if (
        this.pointerDrag.mode === 'resize' &&
        this.pointerDrag.componentId &&
        this.pointerDrag.initialTransform
      ) {
        const centerX = this.pointerDrag.resizeCenterX ?? this.pointerDrag.initialTransform.position.x;
        const centerY = this.pointerDrag.resizeCenterY ?? this.pointerDrag.initialTransform.position.y;
        const initialDistance = Math.max(1, this.pointerDrag.initialResizeDistance ?? 1);
        const initialScale = this.pointerDrag.initialScale ?? getVisualizerUniformScale(this.pointerDrag.initialTransform);
        const distance = Math.max(1, Math.hypot(world.x - centerX, world.y - centerY));
        const rawScale = initialScale * (distance / initialDistance);
        const nextScale = event.shiftKey ? Math.round(rawScale / 0.05) * 0.05 : rawScale;

        this.updateComponentTransform(this.pointerDrag.componentId, (current) => withUniformScale(current, nextScale));
      } else if (this.pointerDrag.mode === 'pan') {
        const deltaX = point.x - this.pointerDrag.startClientX;
        const deltaY = point.y - this.pointerDrag.startClientY;
        this.setViewTransform(
          this.pointerDrag.initialPanX + deltaX,
          this.pointerDrag.initialPanY + deltaY,
          this.viewState.zoom,
          true
        );
        this.requestFrame();
      }

      this.requestFrame();
      return;
    }

    if (this.editState.editMode) {
      this.progressHoverInfo.active = false;
    } else {
      this.updateProgressHover(event.clientX, event.clientY);
    }

    const hit = this.editState.editMode ? this.getHitTarget(event.clientX, event.clientY) : null;
    this.editState.hoveredComponentId = hit?.componentId ?? null;
    this.editState.hoveredHandle = hit?.handle ?? null;

    if (!this.editState.editMode) {
      if (this.isInCanvasEdgePanGuard(event.clientX, event.clientY)) {
        this.clearCanvasInteractionCursor();
        return;
      }
      this.updateCursor(null, false, false);
      return;
    }

    if (!hit && this.isInCanvasEdgePanGuard(event.clientX, event.clientY)) {
      this.clearCanvasInteractionCursor();
      this.requestFrame();
      return;
    }

    this.updateCursor(hit, false, false);
    this.requestFrame();
  }

  private finishPointerDrag(forcePersist = false): void {
    if (!this.pointerDrag) return;

    if (this.pointerDrag.mode === 'component' && this.pointerDrag.componentId) {
      this.editState.draggingComponentId = null;
      if (forcePersist) {
        this.flushLayoutPersist();
      } else {
        this.scheduleLayoutPersist();
      }
    }

    if (this.pointerDrag.mode === 'resize' && this.pointerDrag.componentId) {
      this.editState.resizingComponentId = null;
      if (forcePersist) {
        this.flushLayoutPersist();
      } else {
        this.scheduleLayoutPersist();
      }
    }

    if (this.pointerDrag.mode === 'pan') {
      if (forcePersist) {
        this.flushLayoutPersist();
      } else {
        this.scheduleLayoutPersist();
      }
    }

    this.editState.activeHandle = null;
    this.pointerDrag = null;
    this.updateCursor(this.getCurrentHoverTarget(), false, false);
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.disposed) return;
    if (!this.pointerDrag || this.pointerDrag.pointerId !== event.pointerId) return;

    this.finishPointerDrag(true);
    this.canvas.releasePointerCapture?.(event.pointerId);
    const hit = this.getHitTarget(event.clientX, event.clientY);
    this.editState.hoveredComponentId = hit?.componentId ?? null;
    this.editState.hoveredHandle = hit?.handle ?? null;
    this.updateCursor(hit, false, false);
    this.requestFrame();
  }

  private handleWheel(event: WheelEvent): void {
    if (this.disposed) return;

    event.preventDefault();
    event.stopPropagation();

    const point = this.getCanvasPoint(event.clientX, event.clientY);
    const hit = this.editState.editMode ? this.getHitTarget(event.clientX, event.clientY) : null;
    const hitId = hit?.componentId ?? null;
    const zoomFactor = event.deltaY < 0 ? 1.05 : 0.95;

    if (hitId) {
      this.selectComponent(hitId);
      this.editState.hoveredComponentId = hitId;
      this.editState.hoveredHandle = hit?.handle ?? null;
      this.updateComponentTransform(hitId, (current) =>
        withUniformScale(current, getVisualizerUniformScale(current) * zoomFactor)
      );
      this.updateCursor(hit, false, false);
      return;
    }

    if (this.isInCanvasEdgePanGuard(event.clientX, event.clientY)) {
      if (this.editState.editMode) {
        this.editState.hoveredComponentId = null;
        this.editState.hoveredHandle = null;
        this.requestFrame();
      }
      this.clearCanvasInteractionCursor();
      return;
    }

    const worldBefore = screenToWorld(point.x, point.y, this.viewport, this.viewState);
    const nextZoom = clamp(this.viewState.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);
    const nextPanX = point.x - this.viewport.width / 2 - worldBefore.x * nextZoom;
    const nextPanY = point.y - this.viewport.height / 2 - worldBefore.y * nextZoom;
    this.setViewTransform(nextPanX, nextPanY, nextZoom, true);
    this.requestFrame();
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

  resize(): boolean {
    if (this.disposed) return false;
    const { width: cssWidth, height: cssHeight } = this.readLayoutSize();
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const scaledRatio = pixelRatio * Math.max(0.5, this.quality.renderScale);
    const nextRatio = Math.max(0.5, Math.min(2, scaledRatio));
    const width = Math.max(1, Math.round(cssWidth * nextRatio));
    const height = Math.max(1, Math.round(cssHeight * nextRatio));
    const changed =
      this.canvas.width !== width ||
      this.canvas.height !== height ||
      this.viewport.width !== cssWidth ||
      this.viewport.height !== cssHeight ||
      this.viewport.devicePixelRatio !== nextRatio;

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.context.setTransform(nextRatio, 0, 0, nextRatio, 0, 0);
    this.viewport = createViewportInfo(cssWidth, cssHeight, nextRatio);
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
    this.selectComponent(null);
    this.editState.hoveredComponentId = null;
    this.editState.draggingComponentId = null;
    this.editState.resizingComponentId = null;
    this.editState.hoveredHandle = null;
    this.editState.activeHandle = null;
    this.pointerDrag = null;
    this.activateScene(sceneId);
    this.requestFrame();
  }

  centerCanvas(): void {
    if (this.disposed) return;

    this.setViewTransform(0, 0, this.viewState.zoom, true);
    this.requestFrame();
  }

  resetCanvasSize(): void {
    if (this.disposed) return;

    this.setViewTransform(this.viewState.panX, this.viewState.panY, createDefaultViewState(this.viewport).zoom, true);
    this.requestFrame();
  }

  setEditMode(editMode: boolean): void {
    if (this.editState.editMode === editMode) return;

    this.editState.editMode = editMode;

    if (!editMode) {
      this.finishPointerDrag(true);
      this.progressHoverInfo.active = false;
      this.editState.hoveredComponentId = null;
      this.editState.draggingComponentId = null;
      this.editState.resizingComponentId = null;
      this.editState.hoveredHandle = null;
      this.editState.activeHandle = null;
      this.pointerDrag = null;
      this.updateCursor(null);
      this.flushLayoutPersist();
    } else {
      this.updateCursor(this.getCurrentHoverTarget());
    }

    this.requestFrame();
  }

  resetLayout(): void {
    this.layoutOverrides = {};
    this.layoutStore.scenes[this.sceneId] = {};
    const defaultView = createDefaultViewState(this.viewport);
    this.setViewTransform(defaultView.panX, defaultView.panY, defaultView.zoom);
    this.editState.hoveredComponentId = null;
    this.selectComponent(null);
    this.editState.draggingComponentId = null;
    this.editState.resizingComponentId = null;
    this.editState.hoveredHandle = null;
    this.editState.activeHandle = null;
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
    this.requestFrame();
  }

  start(): void {
    if (this.disposed || this.rafId !== null) return;
    telemetry.info('visualizer.canvas.runtime.start', {
      fields: { sceneId: this.sceneId },
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
    this.finishPointerDrag(true);
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
    this.audioBus.dispose();
    this.registry.dispose();
    this.canvas.style.cursor = 'default';
    this.canvas.style.removeProperty('width');
    this.canvas.style.removeProperty('height');
    telemetry.info('visualizer.canvas.runtime.dispose', {
      fields: { sceneId: this.sceneId },
    });
  }
}
