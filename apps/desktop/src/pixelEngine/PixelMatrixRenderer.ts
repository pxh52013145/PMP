import * as PIXI from 'pixi.js';
import { BACKGROUND_RENDER_THROTTLE_FPS, type RenderMode } from '../contracts/performance';
import { MATRIX_CONFIG, PIXEL_COLORS } from '../constants/config';
import { readString } from '../modules/storage';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { computePixelGridLayout, hitTestPixelGridFromPoint, PixelGridLayout } from '../utils/pixelGrid';

type PixelShape = 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';

/**
 * Pixel Matrix 渲染引擎
 * 使用 PixiJS 实现高性能像素矩阵渲染
 */
export class PixelMatrixRenderer {
  private static readonly HIGH_DPR_THRESHOLD = 2;
  private static readonly HIGH_DPR_RENDER_SCALE_CAP = 0.75;

  private app: PIXI.Application;
  private pixelContainer: PIXI.ParticleContainer;
  private pixels: PIXI.Sprite[] = [];
  private pixelTexture: PIXI.Texture = PIXI.Texture.EMPTY;
  private pixelShape: PixelShape = 'circle';
  private pixelSizeScale: number = 1.0; // Pixel 尺寸缩放比例 (0.5-1.0)
  private pixelOpacity: number = 1.0; // Pixel 透明度 (0.0-1.0)
  private isActive: boolean = true;
  private renderMode: RenderMode = 'full';
  private width: number;
  private height: number;
  private renderScale: number = 1.0;
  private fpsCapFull: number = 0;
  private fpsCapThrottle: number = BACKGROUND_RENDER_THROTTLE_FPS;
  private layout: PixelGridLayout;
  private hoveredIndex: number | null = null;
  private hoveredBaseTint: PIXI.ColorSource | null = null;
  private pointerMoveRaf: number | null = null;
  private pendingPointerMove: { x: number; y: number } | null = null;
  private readonly roundPixels: boolean;

  constructor(
    width: number,
    height: number,
    options: { renderScale?: number; fpsCapFull?: number; fpsCapThrottle?: number } = {}
  ) {
    this.width = width;
    this.height = height;
    if (typeof options.renderScale === 'number' && Number.isFinite(options.renderScale)) {
      this.renderScale = Math.max(0.25, Math.min(1.0, options.renderScale));
    }
    if (typeof options.fpsCapFull === 'number' && Number.isFinite(options.fpsCapFull)) {
      this.fpsCapFull = Math.max(0, Math.min(240, options.fpsCapFull));
    }
    if (
      typeof options.fpsCapThrottle === 'number' &&
      Number.isFinite(options.fpsCapThrottle) &&
      options.fpsCapThrottle > 0
    ) {
      this.fpsCapThrottle = Math.max(1, Math.min(240, options.fpsCapThrottle));
    }

    // 初始化 PixiJS 应用
    this.roundPixels = import.meta.env.VITE_PERF_ROUND_PIXELS === '1';
    const useAntialias = import.meta.env.VITE_PERF_PIXEL_ANTIALIAS !== '0';

    this.app = new PIXI.Application({
      width,
      height,
      backgroundAlpha: 0, // 完全透明背景
      antialias: useAntialias,
      resolution: this.computeRendererResolution(),
      autoDensity: true,
    });

    (this.app.stage as PIXI.Container & { roundPixels?: boolean }).roundPixels = this.roundPixels;

    // 创建像素容器（批量渲染）
    this.pixelContainer = new PIXI.ParticleContainer(MATRIX_CONFIG.COLUMNS * MATRIX_CONFIG.ROWS, {
      position: true,
      alpha: true,
      tint: true,
    });
    this.app.stage.addChild(this.pixelContainer);

    this.layout = computePixelGridLayout(width, height);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointermove', this.handlePointerMove, this);
    this.app.stage.on('pointertap', this.handlePointerTap, this);
    this.app.stage.on('pointerout', this.handlePointerOut, this);

    (this.app.view as HTMLCanvasElement).style.cursor = 'pointer';

    this.pixelTexture = this.createPixelTexture(this.pixelShape);

    // 初始化像素网格
    this.initPixels();
  }

  private computeRendererResolution(): number {
    const dpr = window.devicePixelRatio || 1;
    const highDprScaleCap =
      dpr >= PixelMatrixRenderer.HIGH_DPR_THRESHOLD
        ? PixelMatrixRenderer.HIGH_DPR_RENDER_SCALE_CAP
        : 1.0;
    return dpr * Math.min(this.renderScale, highDprScaleCap);
  }

  /**
   * 初始化像素网格
   */
  private initPixels(): void {
    const { COLUMNS, ROWS } = MATRIX_CONFIG;
    const total = COLUMNS * ROWS;

    for (let index = 0; index < total; index++) {
      const pixel = new PIXI.Sprite(this.pixelTexture);

      // 初始位置设为0，后续通过 updateLayout 更新
      pixel.x = 0;
      pixel.y = 0;
      pixel.alpha = this.pixelOpacity;

      this.pixelContainer.addChild(pixel);
      this.pixels.push(pixel);
    }
  }

  private handlePointerOut(): void {
    this.pendingPointerMove = null;
    if (this.pointerMoveRaf !== null) {
      window.cancelAnimationFrame(this.pointerMoveRaf);
      this.pointerMoveRaf = null;
    }
    if (this.hoveredIndex === null) return;
    const prev = this.pixels[this.hoveredIndex];
    if (prev && this.hoveredBaseTint !== null) prev.tint = this.hoveredBaseTint;
    this.hoveredIndex = null;
    this.hoveredBaseTint = null;
  }

  private handlePointerMove(event: PIXI.FederatedPointerEvent): void {
    if (!this.isActive) return;

    this.pendingPointerMove = { x: event.global.x, y: event.global.y };
    if (this.pointerMoveRaf !== null) return;

    this.pointerMoveRaf = window.requestAnimationFrame(() => {
      this.pointerMoveRaf = null;
      const pending = this.pendingPointerMove;
      this.pendingPointerMove = null;
      if (!pending) return;
      this.processPointerMove(pending.x, pending.y);
    });
  }

  private processPointerMove(x: number, y: number): void {
    const hit = hitTestPixelGridFromPoint(x, y, this.layout);
    const nextIndex = hit ? hit.gridY * MATRIX_CONFIG.COLUMNS + hit.gridX : null;

    if (nextIndex === this.hoveredIndex) return;

    if (this.hoveredIndex !== null) {
      const prev = this.pixels[this.hoveredIndex];
      if (prev && this.hoveredBaseTint !== null) prev.tint = this.hoveredBaseTint;
    }

    this.hoveredIndex = nextIndex;
    if (this.hoveredIndex !== null) {
      const next = this.pixels[this.hoveredIndex];
      if (next) {
        this.hoveredBaseTint = next.tint;
        next.tint = 0x00ff88;
      }
    } else {
      this.hoveredBaseTint = null;
    }
  }

  private handlePointerTap(event: PIXI.FederatedPointerEvent): void {
    if (!this.isActive) return;

    const hit = hitTestPixelGridFromPoint(event.global.x, event.global.y, this.layout);
    if (!hit) return;

    console.log(`Pixel clicked: (${hit.gridX}, ${hit.gridY})`);
  }

  private normalizePixelShape(shape: string): PixelShape {
    switch (shape) {
      case 'circle':
      case 'square':
      case 'rounded-square':
      case 'diamond':
      case 'hexagon':
        return shape;
      default:
        return 'circle';
    }
  }

  /**
   * 生成共享像素纹理
   */
  private createPixelTexture(shape: PixelShape): PIXI.Texture {
    const { PIXEL_SIZE } = MATRIX_CONFIG;
    const pixelGraphic = new PIXI.Graphics();
    pixelGraphic.beginFill(PIXEL_COLORS.DEFAULT);

    // 应用尺寸缩放
    const size = PIXEL_SIZE * this.pixelSizeScale;
    const half = size / 2;

    // 计算居中偏移（让缩小的 pixel 保持在中心）
    const baseSize = PIXEL_SIZE;
    const offset = (baseSize - size) / 2;

    switch (shape) {
      case 'circle':
        pixelGraphic.drawCircle(half + offset, half + offset, half);
        break;

      case 'square':
        pixelGraphic.drawRect(offset, offset, size, size);
        break;

      case 'rounded-square':
        pixelGraphic.drawRoundedRect(offset, offset, size, size, size * 0.2);
        break;

      case 'diamond':
        pixelGraphic.moveTo(half + offset, offset);
        pixelGraphic.lineTo(size + offset, half + offset);
        pixelGraphic.lineTo(half + offset, size + offset);
        pixelGraphic.lineTo(offset, half + offset);
        pixelGraphic.lineTo(half + offset, offset);
        break;

      case 'hexagon': {
        const angle = (Math.PI * 2) / 6;
        const centerX = half + offset;
        const centerY = half + offset;
        pixelGraphic.moveTo(centerX + half * Math.cos(0), centerY + half * Math.sin(0));
        for (let i = 1; i <= 6; i++) {
          pixelGraphic.lineTo(centerX + half * Math.cos(angle * i), centerY + half * Math.sin(angle * i));
        }
        break;
      }

      default:
        pixelGraphic.drawCircle(half + offset, half + offset, half);
    }

    pixelGraphic.endFill();

    const texture = this.app.renderer.generateTexture(pixelGraphic, {
      region: new PIXI.Rectangle(0, 0, PIXEL_SIZE, PIXEL_SIZE),
      resolution: this.app.renderer.resolution,
    });

    pixelGraphic.destroy();
    return texture;
  }

  private refreshPixelTexture(shape: string, force: boolean = false): void {
    const normalizedShape = this.normalizePixelShape(shape);
    if (!force && normalizedShape === this.pixelShape) {
      return;
    }

    const nextTexture = this.createPixelTexture(normalizedShape);
    const previousTexture = this.pixelTexture;

    this.pixelTexture = nextTexture;
    this.pixelShape = normalizedShape;

    for (const pixel of this.pixels) {
      pixel.texture = nextTexture;
    }

    if (previousTexture !== PIXI.Texture.EMPTY && previousTexture !== nextTexture) {
      previousTexture.destroy(true);
    }
  }

  /**
   * 更新所有 Pixel 的形状
   */
  public updatePixelShape(shape: string): void {
    this.refreshPixelTexture(shape);
  }

  /**
   * 更新 Pixel 尺寸（缩放比例 0.5-1.0）
   */
  public updatePixelSize(scale: number): void {
    // 限制范围 50%-100%
    this.pixelSizeScale = Math.max(0.5, Math.min(1.0, scale));

    // 获取当前形状（使用统一的 STORAGE_KEYS）
    const currentShape =
      typeof window !== 'undefined'
        ? readString(STORAGE_KEYS.PIXEL_SHAPE) || readString('pixel-shape') || this.pixelShape
        : this.pixelShape;

    this.refreshPixelTexture(currentShape, true);
  }

  /**
   * 更新 Pixel 透明度（0.0-1.0）
   */
  public updatePixelOpacity(opacity: number): void {
    // 限制范围 0%-100%
    this.pixelOpacity = Math.max(0.0, Math.min(1.0, opacity));

    // 应用透明度到所有 pixel
    for (const pixel of this.pixels) {
      pixel.alpha = this.pixelOpacity;
    }
  }

  /**
   * 根据窗口尺寸更新像素布局
   */
  public updateLayout(windowWidth: number, windowHeight: number): void {
    const { COLUMNS, ROWS, EDGE_PADDING } = MATRIX_CONFIG;

    this.width = windowWidth;
    this.height = windowHeight;
    this.layout = computePixelGridLayout(windowWidth, windowHeight);
    const { stepX, stepY } = this.layout;

    // 更新每个像素的位置
    let index = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const pixel = this.pixels[index];
        if (pixel) {
          const nextX = EDGE_PADDING + col * stepX;
          const nextY = EDGE_PADDING + row * stepY;
          pixel.x = this.roundPixels ? Math.round(nextX) : nextX;
          pixel.y = this.roundPixels ? Math.round(nextY) : nextY;
        }
        index++;
      }
    }

    // 更新 canvas 尺寸
    this.app.renderer.resize(windowWidth, windowHeight);
    this.app.stage.hitArea = this.app.screen;
  }

  public setQuality(options: { renderScale?: number; fpsCapFull?: number; fpsCapThrottle?: number }): void {
    let changed = false;
    let renderScaleChanged = false;

    if (typeof options.renderScale === 'number' && Number.isFinite(options.renderScale)) {
      const next = Math.max(0.25, Math.min(1.0, options.renderScale));
      if (next !== this.renderScale) {
        this.renderScale = next;
        changed = true;
        renderScaleChanged = true;
      }
    }

    if (typeof options.fpsCapFull === 'number' && Number.isFinite(options.fpsCapFull)) {
      const next = Math.max(0, Math.min(240, options.fpsCapFull));
      if (next !== this.fpsCapFull) {
        this.fpsCapFull = next;
        changed = true;
      }
    }

    if (
      typeof options.fpsCapThrottle === 'number' &&
      Number.isFinite(options.fpsCapThrottle) &&
      options.fpsCapThrottle > 0
    ) {
      const next = Math.max(1, Math.min(240, options.fpsCapThrottle));
      if (next !== this.fpsCapThrottle) {
        this.fpsCapThrottle = next;
        changed = true;
      }
    }

    if (!changed) return;

    try {
      this.app.renderer.resolution = this.computeRendererResolution();
      this.app.renderer.resize(this.width, this.height);
      if (renderScaleChanged) {
        this.refreshPixelTexture(this.pixelShape, true);
      }
    } catch {
      // best-effort
    }

    this.applyFpsCapForCurrentMode();

    try {
      this.app.render();
    } catch {
      // ignore
    }
  }

  /**
   * 更新单个像素
   */
  public updatePixel(x: number, y: number, color: number): void {
    const { COLUMNS } = MATRIX_CONFIG;
    const index = y * COLUMNS + x;
    const pixel = this.pixels[index];

    if (pixel) {
      if (this.hoveredIndex === index) {
        this.hoveredBaseTint = color;
        pixel.tint = 0x00ff88;
      } else {
        pixel.tint = color;
      }
    }
  }

  /**
   * 获取单个 Pixel 的实际像素位置
   * @param gridX 网格列坐标（0-26）
   * @param gridY 网格行坐标（0-19）
   * @returns 该 Pixel 在画布上的像素坐标，如果不存在则返回 null
   */
  public getPixelPosition(gridX: number, gridY: number): { x: number; y: number } | null {
    const { COLUMNS, ROWS } = MATRIX_CONFIG;

    // 边界检查
    if (gridX < 0 || gridX >= COLUMNS || gridY < 0 || gridY >= ROWS) {
      console.warn(`Pixel position out of bounds: (${gridX}, ${gridY})`);
      return null;
    }

    const index = gridY * COLUMNS + gridX;
    const pixel = this.pixels[index];

    if (!pixel) {
      return null;
    }

    return {
      x: pixel.x,
      y: pixel.y,
    };
  }

  /**
   * 获取所有 Pixel 的位置映射
   * @returns Map<"x,y", {x, y}> 键为网格坐标字符串，值为实际像素坐标
   */
  public getAllPixelPositions(): Map<string, { x: number; y: number }> {
    const { COLUMNS, ROWS } = MATRIX_CONFIG;
    const positions = new Map<string, { x: number; y: number }>();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const index = row * COLUMNS + col;
        const pixel = this.pixels[index];

        if (pixel) {
          const key = `${col},${row}`;
          positions.set(key, { x: pixel.x, y: pixel.y });
        }
      }
    }

    return positions;
  }

  /**
   * 获取 Canvas 视图
   */
  public getView(): HTMLCanvasElement {
    return this.app.view as HTMLCanvasElement;
  }

  /**
   * Backward compatible: pause/resume Pixi's render loop using a boolean flag.
   */
  public setActive(active: boolean): void {
    this.setInteractionEnabled(active);
    this.setRenderMode(active ? 'full' : 'pause');
  }

  public setInteractionEnabled(active: boolean): void {
    if (this.isActive === active) return;
    this.isActive = active;

    if (!active) {
      this.handlePointerOut();
    }
  }

  private applyFpsCapForCurrentMode(): void {
    try {
      const ticker = this.app.ticker;
      if (!ticker) return;
      if (this.renderMode === 'pause') return;
      if (this.renderMode === 'throttle') {
        ticker.maxFPS = this.fpsCapThrottle;
        return;
      }
      ticker.maxFPS = this.fpsCapFull > 0 ? this.fpsCapFull : 0;
    } catch {
      // ignore
    }
  }

  public setRenderMode(mode: RenderMode): void {
    if (this.renderMode === mode) return;
    this.renderMode = mode;

    if (mode === 'pause') {
      try {
        this.app.stop();
      } catch {
        try {
          this.app.ticker?.stop();
        } catch {
          // ignore
        }
      }
      return;
    }

    this.applyFpsCapForCurrentMode();

    try {
      this.app.start();
    } catch {
      try {
        this.app.ticker?.start();
      } catch {
        // ignore
      }
    }

    try {
      this.app.render();
    } catch {
      // ignore
    }
  }

  /**
   * 销毁渲染器
   */
  public destroy(): void {
    this.app.stage.off('pointermove', this.handlePointerMove, this);
    this.app.stage.off('pointertap', this.handlePointerTap, this);
    this.app.stage.off('pointerout', this.handlePointerOut, this);
    if (this.pointerMoveRaf !== null) {
      window.cancelAnimationFrame(this.pointerMoveRaf);
      this.pointerMoveRaf = null;
    }
    this.pendingPointerMove = null;
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
  }
}
