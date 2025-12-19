import * as PIXI from 'pixi.js';
import { MATRIX_CONFIG, PIXEL_COLORS } from '../constants/config';
import { readString } from '../modules/storage';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { computePixelGridLayout, hitTestPixelGridFromPoint, PixelGridLayout } from '../utils/pixelGrid';

/**
 * Pixel Matrix 渲染引擎
 * 使用 PixiJS 实现高性能的像素点阵渲染
 */
export class PixelMatrixRenderer {
  private app: PIXI.Application;
  private pixelContainer: PIXI.Container;
  private pixels: PIXI.Graphics[] = [];
  private pixelSizeScale: number = 1.0; // Pixel 尺寸缩放比例 (0.5-1.0)
  private pixelOpacity: number = 1.0; // Pixel 透明度 (0.0-1.0)
  private isActive: boolean = true;
  private layout: PixelGridLayout;
  private hoveredIndex: number | null = null;
  private hoveredBaseTint: PIXI.ColorSource | null = null;
  private pointerMoveRaf: number | null = null;
  private pendingPointerMove: { x: number; y: number } | null = null;

  constructor(width: number, height: number) {
    // 初始化 PixiJS 应用
    this.app = new PIXI.Application({
      width,
      height,
      backgroundAlpha: 0, // 完全透明的背景
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // 创建像素容器
    this.pixelContainer = new PIXI.Container();
    this.app.stage.addChild(this.pixelContainer);

    this.layout = computePixelGridLayout(width, height);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointermove', this.handlePointerMove, this);
    this.app.stage.on('pointertap', this.handlePointerTap, this);
    this.app.stage.on('pointerout', this.handlePointerOut, this);

    (this.app.view as HTMLCanvasElement).style.cursor = 'pointer';

    // 初始化像素网格
    this.initPixels();
  }

  /**
   * 初始化像素网格
   */
  private initPixels(): void {
    const { COLUMNS, ROWS } = MATRIX_CONFIG;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const pixel = new PIXI.Graphics();

        // 绘制像素点（默认圆形）
        this.drawPixelShape(pixel, 'circle');

        // 初始位置设为0，后续通过 updateLayout 更新
        pixel.x = 0;
        pixel.y = 0;

        // 启用交互
        pixel.eventMode = 'none';

        this.pixelContainer.addChild(pixel);
        this.pixels.push(pixel);
      }
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

  /**
   * 绘制像素形状
   */
  private drawPixelShape(pixel: PIXI.Graphics, shape: string): void {
    const { PIXEL_SIZE } = MATRIX_CONFIG;
    pixel.clear();
    pixel.beginFill(PIXEL_COLORS.DEFAULT);

    // 应用尺寸缩放
    const size = PIXEL_SIZE * this.pixelSizeScale;
    const half = size / 2;

    // 计算居中偏移（让缩小的 pixel 保持在中心）
    const baseSize = PIXEL_SIZE;
    const offset = (baseSize - size) / 2;

    switch (shape) {
      case 'circle':
        pixel.drawCircle(half + offset, half + offset, half);
        break;

      case 'square':
        pixel.drawRect(offset, offset, size, size);
        break;

      case 'rounded-square':
        pixel.drawRoundedRect(offset, offset, size, size, size * 0.2);
        break;

      case 'diamond':
        pixel.moveTo(half + offset, offset);
        pixel.lineTo(size + offset, half + offset);
        pixel.lineTo(half + offset, size + offset);
        pixel.lineTo(offset, half + offset);
        pixel.lineTo(half + offset, offset);
        break;

      case 'hexagon': {
        const angle = (Math.PI * 2) / 6;
        const centerX = half + offset;
        const centerY = half + offset;
        pixel.moveTo(centerX + half * Math.cos(0), centerY + half * Math.sin(0));
        for (let i = 1; i <= 6; i++) {
          pixel.lineTo(centerX + half * Math.cos(angle * i), centerY + half * Math.sin(angle * i));
        }
        break;
      }

      default:
        pixel.drawCircle(half + offset, half + offset, half);
    }

    pixel.endFill();
  }

  /**
   * 更新所有 Pixel 的形状
   */
  public updatePixelShape(shape: string): void {
    for (const pixel of this.pixels) {
      const currentTint = pixel.tint;
      this.drawPixelShape(pixel, shape);
      pixel.tint = currentTint;
    }
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
        ? readString(STORAGE_KEYS.PIXEL_SHAPE) || readString('pixel-shape') || 'circle'
        : 'circle';

    // 重绘所有 pixel
    for (const pixel of this.pixels) {
      const currentTint = pixel.tint;
      this.drawPixelShape(pixel, currentShape);
      pixel.tint = currentTint;
    }
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

    this.layout = computePixelGridLayout(windowWidth, windowHeight);
    const { stepX, stepY } = this.layout;

    // 更新每个像素的位置
    let index = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const pixel = this.pixels[index];
        if (pixel) {
          pixel.x = EDGE_PADDING + col * stepX;
          pixel.y = EDGE_PADDING + row * stepY;
        }
        index++;
      }
    }

    // 更新 canvas 尺寸
    this.app.renderer.resize(windowWidth, windowHeight);
    this.app.stage.hitArea = this.app.screen;
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
   * Pause/resume Pixi's render loop to reduce CPU/GPU usage when the window is hidden.
   */
  public setActive(active: boolean): void {
    if (this.isActive === active) return;
    this.isActive = active;

    if (active) {
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
      return;
    }

    try {
      this.app.stop();
    } catch {
      try {
        this.app.ticker?.stop();
      } catch {
        // ignore
      }
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
