import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { drawVisualizerGrid } from './GridSystem';
import {
  getTransformOpacity,
  getTransformRotation,
  normalizeScale,
  resolveComponentBaseSize,
  resolveComponentBounds,
} from './CoordinateSystem';
import {
  getVisualizerEditMetrics,
  VISUALIZER_EDIT_LABEL_FONT,
} from './editorGeometry';
import type {
  VisualizerCanvasEditState,
  VisualizerCanvasViewState,
  VisualizerAudioSnapshot,
  VisualizerComponent,
  VisualizerComponentQuality,
  VisualizerFrameInfo,
  VisualizerRenderContext,
  VisualizerSceneDescriptor,
  VisualizerViewportInfo,
} from './types';

const telemetry = getTelemetryLogger('visualizer', 'RenderPipeline');

export interface ActiveVisualizerComponent {
  id: string;
  component: VisualizerComponent;
  transform: VisualizerRenderContext['transform'];
  config: Readonly<Record<string, unknown>>;
}

export interface RenderSceneFrameInput {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  viewport: VisualizerViewportInfo;
  audioSnapshot: VisualizerAudioSnapshot;
  frame: VisualizerFrameInfo;
  scene: VisualizerSceneDescriptor;
  components: ActiveVisualizerComponent[];
  quality: VisualizerComponentQuality;
  viewState: VisualizerCanvasViewState;
  editState: VisualizerCanvasEditState;
}

function drawBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  viewport: VisualizerViewportInfo
): void {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
}

function drawComponentInstance(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  viewport: VisualizerViewportInfo,
  audioSnapshot: VisualizerAudioSnapshot,
  frame: VisualizerFrameInfo,
  componentEntry: ActiveVisualizerComponent,
  quality: VisualizerComponentQuality,
  viewState: VisualizerCanvasViewState,
  editState: VisualizerCanvasEditState
): void {
  const { component, transform, config } = componentEntry;
  if (!transform.visible) return;

  const bounds = resolveComponentBounds(transform, component.manifest.geometry, viewport, viewState);
  const baseSize = resolveComponentBaseSize(component.manifest.geometry);
  const scale = normalizeScale(transform.scale);
  const zoom = Math.max(0.05, Number.isFinite(viewState.zoom) ? viewState.zoom : 1);
  const opacity = getTransformOpacity(transform);
  const rotation = getTransformRotation(transform);

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY);
  if (rotation !== 0) {
    ctx.rotate(rotation);
  }
  ctx.globalAlpha *= opacity;
  ctx.scale(scale.x * zoom, scale.y * zoom);
  ctx.translate(-baseSize.width / 2, -baseSize.height / 2);
  ctx.beginPath();
  ctx.rect(0, 0, baseSize.width, baseSize.height);
  ctx.clip();

  const renderContext: VisualizerRenderContext = {
    ctx,
    bounds: {
      width: baseSize.width,
      height: baseSize.height,
    },
    viewport,
    transform,
    config,
    audioSnapshot,
    quality,
    qualityLevel: quality.level,
    viewState,
    editState: {
      ...viewState,
      ...editState,
    },
  };

  try {
    component.render(frame, renderContext);
  } catch (error) {
    telemetry.warn('visualizer.component.render.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: {
        componentId: component.manifest.id,
      },
    });
  }

  ctx.restore();
}

function drawEditOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  viewport: VisualizerViewportInfo,
  components: ActiveVisualizerComponent[],
  viewState: VisualizerCanvasViewState,
  editState: VisualizerCanvasEditState
): void {
  const metricsById = new Map<string, ReturnType<typeof getVisualizerEditMetrics>>();

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const entry of components) {
    if (!entry.transform.visible) continue;
    metricsById.set(entry.id, getVisualizerEditMetrics(entry, viewport, viewState, ctx));
  }

  const originX = viewport.width / 2 + viewState.panX;
  const originY = viewport.height / 2 + viewState.panY;

  ctx.save();
  ctx.lineWidth = 1 / Math.max(0.1, viewState.zoom);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.beginPath();
  ctx.moveTo(0, originY + 0.5);
  ctx.lineTo(viewport.width, originY + 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
  ctx.beginPath();
  ctx.moveTo(originX + 0.5, 0);
  ctx.lineTo(originX + 0.5, viewport.height);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(originX, originY, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  for (const entry of components) {
    if (!entry.transform.visible) continue;
    const metrics = metricsById.get(entry.id);
    if (!metrics) continue;
    const { bounds, label, scaleHandle } = metrics;
    const isHovered = editState.hoveredComponentId === entry.id;
    const isSelected = editState.selectedComponentId === entry.id;
    const isDragging = editState.draggingComponentId === entry.id;
    const isResizing = editState.resizingComponentId === entry.id;
    const active = isHovered || isSelected || isDragging || isResizing;
    const accent = isDragging || isResizing ? 'rgba(34, 197, 94, 0.96)' : isSelected ? 'rgba(96, 165, 250, 0.96)' : 'rgba(255, 255, 255, 0.5)';

    if (active) {
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.fillStyle = 'rgba(10, 12, 16, 0.26)';
      ctx.setLineDash(isDragging || isResizing ? [8, 4] : [6, 4]);
      ctx.lineWidth = 1.8;

      if (entry.component.manifest.geometry.type === 'rectangular') {
        const radius = Math.min(10, Math.max(4, Math.min(bounds.width, bounds.height) * 0.08));
        ctx.beginPath();
        ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius);
        ctx.fill();
        ctx.stroke();
      } else {
        const radius = bounds.radius;
        ctx.beginPath();
        ctx.arc(bounds.centerX, bounds.centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = isDragging || isResizing ? 'rgba(34, 197, 94, 0.28)' : 'rgba(255, 255, 255, 0.18)';
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bounds.centerX, bounds.centerY);
      ctx.lineTo(label.centerX, label.centerY);
      ctx.stroke();
      ctx.restore();
    }

    ctx.font = VISUALIZER_EDIT_LABEL_FONT;
    ctx.fillStyle = isSelected || isDragging || isResizing ? 'rgba(14, 80, 41, 0.9)' : isHovered ? 'rgba(18, 18, 20, 0.82)' : 'rgba(8, 8, 10, 0.66)';
    ctx.strokeStyle = active ? accent : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = active ? 1.2 : 1;
    ctx.beginPath();
    ctx.roundRect(label.x, label.y, label.width, label.height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isSelected || isDragging || isResizing ? '#d7ffe6' : isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.76)';
    ctx.fillText(label.text, label.centerX, label.centerY - 1, label.width - 12);

    if (isSelected || isDragging || isResizing || isHovered) {
      ctx.save();
      ctx.fillStyle = isDragging || isResizing ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = isDragging || isResizing ? 'rgba(187, 255, 215, 0.95)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(scaleHandle.x, scaleHandle.y, scaleHandle.width, scaleHandle.height, 3);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = isDragging || isResizing ? 'rgba(6, 31, 17, 0.78)' : 'rgba(6, 6, 8, 0.7)';
      ctx.beginPath();
      ctx.moveTo(scaleHandle.x + 3, scaleHandle.y + scaleHandle.height - 3);
      ctx.lineTo(scaleHandle.x + scaleHandle.width - 3, scaleHandle.y + 3);
      ctx.moveTo(scaleHandle.x + 5, scaleHandle.y + scaleHandle.height - 3);
      ctx.lineTo(scaleHandle.x + scaleHandle.width - 3, scaleHandle.y + 5);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

export function renderSceneFrame({
  ctx,
  viewport,
  audioSnapshot,
  frame,
  scene: _scene,
  components,
  quality,
  viewState,
  editState,
}: RenderSceneFrameInput): void {
  drawBackground(ctx, viewport);
  drawVisualizerGrid(
    ctx,
    viewport,
    {
      minorStep: 40,
      majorEvery: 4,
      color: 'rgba(255, 255, 255, 0.03)',
      majorColor: 'rgba(255, 255, 255, 0.03)',
      opacity: 1,
      panX: viewState.panX,
      panY: viewState.panY,
      zoom: viewState.zoom,
    }
  );

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  const sortedComponents = [...components].sort((left, right) => {
    const leftZ = left.transform.zIndex;
    const rightZ = right.transform.zIndex;
    if (!editState.editMode) {
      return leftZ - rightZ;
    }

    const leftActive =
      left.id === editState.selectedComponentId ||
      left.id === editState.hoveredComponentId ||
      left.id === editState.draggingComponentId ||
      left.id === editState.resizingComponentId;
    const rightActive =
      right.id === editState.selectedComponentId ||
      right.id === editState.hoveredComponentId ||
      right.id === editState.draggingComponentId ||
      right.id === editState.resizingComponentId;

    if (leftActive !== rightActive) {
      return leftActive ? 1 : -1;
    }

    return leftZ - rightZ;
  });

  for (const entry of sortedComponents) {
    drawComponentInstance(ctx, viewport, audioSnapshot, frame, entry, quality, viewState, editState);
  }

  if (editState.editMode) {
    drawEditOverlay(ctx, viewport, sortedComponents, viewState, editState);
  }

  ctx.restore();
}
