/**
 * Magnet 编辑器工具函数
 */

import { Magnet, PixelAnchor } from '../types/pixel';
import {
  MagnetImportSchema,
  MagnetValidationResult,
  PixelOccupancy,
  FreeAreaResult,
} from '../types/editor';
import { MATRIX_CONFIG } from '../constants/config';

/**
 * 计算所有 Magnet 占用的 Pixel
 */
export function calculatePixelOccupancy(magnets: Magnet[]): Map<string, PixelOccupancy> {
  const occupancyMap = new Map<string, PixelOccupancy>();

  // 初始化所有 pixel 为未占用
  for (let y = 0; y < MATRIX_CONFIG.ROWS; y++) {
    for (let x = 0; x < MATRIX_CONFIG.COLUMNS; x++) {
      occupancyMap.set(`${x},${y}`, {
        pixel: { x, y },
        isOccupied: false,
        occupiedBy: null,
        magnetType: null,
      });
    }
  }

  // 标记被 Magnet 占用的 pixel
  magnets.forEach((magnet) => {
    const occupiedPixels = getMagnetOccupiedPixels(magnet);
    occupiedPixels.forEach((pixel) => {
      const key = `${pixel.x},${pixel.y}`;
      occupancyMap.set(key, {
        pixel,
        isOccupied: true,
        occupiedBy: magnet.id,
        magnetType: magnet.type,
      });
    });
  });

  return occupancyMap;
}

/**
 * 获取单个 Magnet 占用的所有 Pixel
 */
export function getMagnetOccupiedPixels(magnet: Magnet): Array<{ x: number; y: number }> {
  const pixels: Array<{ x: number; y: number }> = [];

  switch (magnet.anchorType) {
    case 'single': {
      // 单锚点：只占用锚点位置的 pixel
      const anchor = magnet.anchors[0];
      pixels.push({ x: anchor.gridX, y: anchor.gridY });
      break;
    }

    case 'horizontal': {
      // 水平锚点：占用左右锚点之间的所有 pixel
      const leftAnchor = magnet.anchors[0];
      const rightAnchor = magnet.anchors[1];
      const minX = Math.min(leftAnchor.gridX, rightAnchor.gridX);
      const maxX = Math.max(leftAnchor.gridX, rightAnchor.gridX);
      const y = leftAnchor.gridY;

      for (let x = minX; x <= maxX; x++) {
        pixels.push({ x, y });
      }
      break;
    }

    case 'vertical': {
      // 垂直锚点：占用顶底锚点之间的所有 pixel
      const topAnchor = magnet.anchors[0];
      const bottomAnchor = magnet.anchors[1];
      const minY = Math.min(topAnchor.gridY, bottomAnchor.gridY);
      const maxY = Math.max(topAnchor.gridY, bottomAnchor.gridY);
      const x = topAnchor.gridX;

      for (let y = minY; y <= maxY; y++) {
        pixels.push({ x, y });
      }
      break;
    }

    case 'rectangular': {
      // 矩形锚点：占用四个角围成的矩形区域内的所有 pixel
      const topLeft = magnet.anchors[0];
      const topRight = magnet.anchors[1];
      const bottomLeft = magnet.anchors[2];

      const minX = Math.min(topLeft.gridX, topRight.gridX);
      const maxX = Math.max(topLeft.gridX, topRight.gridX);
      const minY = Math.min(topLeft.gridY, bottomLeft.gridY);
      const maxY = Math.max(topLeft.gridY, bottomLeft.gridY);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          pixels.push({ x, y });
        }
      }
      break;
    }
  }

  return pixels;
}

/**
 * 验证 Magnet 导入格式
 */
export function validateMagnetImport(data: unknown): MagnetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 类型检查
  if (typeof data !== 'object' || data === null) {
    return {
      valid: false,
      errors: ['数据必须是一个对象'],
      warnings: [],
    };
  }

  const schema = data as Partial<MagnetImportSchema>;

  // 必填字段检查
  if (!schema.id) errors.push('缺少必填字段: id');
  if (!schema.type) errors.push('缺少必填字段: type');
  if (!schema.name) errors.push('缺少必填字段: name');
  if (!schema.anchorType) errors.push('缺少必填字段: anchorType');
  if (!schema.anchors || !Array.isArray(schema.anchors)) {
    errors.push('缺少必填字段: anchors（必须是数组）');
  }
  if (!schema.style || typeof schema.style !== 'object') {
    errors.push('缺少必填字段: style（必须是对象）');
  }
  if (!schema.interactions || typeof schema.interactions !== 'object') {
    errors.push('缺少必填字段: interactions（必须是对象）');
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 锚点类型验证
  const validAnchorTypes = ['single', 'horizontal', 'vertical', 'rectangular'];
  if (!validAnchorTypes.includes(schema.anchorType!)) {
    errors.push(`无效的锚点类型: ${schema.anchorType}，必须是 ${validAnchorTypes.join(', ')} 之一`);
  }

  // 锚点数量验证
  const anchors = schema.anchors!;
  if (schema.anchorType === 'single' && anchors.length !== 1) {
    errors.push('单锚点类型必须恰好有 1 个锚点');
  }
  if (schema.anchorType === 'horizontal' && anchors.length !== 2) {
    errors.push('水平锚点类型必须恰好有 2 个锚点');
  }
  if (schema.anchorType === 'vertical' && anchors.length !== 2) {
    errors.push('垂直锚点类型必须恰好有 2 个锚点');
  }
  if (schema.anchorType === 'rectangular' && anchors.length !== 4) {
    errors.push('矩形锚点类型必须恰好有 4 个锚点');
  }

  // 锚点坐标验证
  anchors.forEach((anchor, index) => {
    if (typeof anchor.gridX !== 'number' || typeof anchor.gridY !== 'number') {
      errors.push(`锚点 ${index} 的坐标必须是数字`);
    }
    if (
      anchor.gridX < 0 ||
      anchor.gridX >= MATRIX_CONFIG.COLUMNS ||
      anchor.gridY < 0 ||
      anchor.gridY >= MATRIX_CONFIG.ROWS
    ) {
      errors.push(
        `锚点 ${index} 的坐标超出范围 (${anchor.gridX}, ${anchor.gridY})，` +
          `有效范围是 (0-${MATRIX_CONFIG.COLUMNS - 1}, 0-${MATRIX_CONFIG.ROWS - 1})`
      );
    }
    if (!anchor.role || !['anchor', 'boundary'].includes(anchor.role)) {
      errors.push(`锚点 ${index} 的 role 必须是 'anchor' 或 'boundary'`);
    }
  });

  // 样式验证
  const style = schema.style!;
  if (schema.anchorType === 'single') {
    if (!style.width) warnings.push('单锚点类型建议设置 width');
    if (!style.height) warnings.push('单锚点类型建议设置 height');
  }
  if (schema.anchorType === 'horizontal') {
    if (!style.height) warnings.push('水平锚点类型建议设置 height');
  }
  if (schema.anchorType === 'vertical') {
    if (!style.width) warnings.push('垂直锚点类型建议设置 width');
  }
  if (schema.anchorType === 'rectangular') {
    if (!style.height && !style.width) warnings.push('矩形锚点类型建议设置 height 或 width');
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 构造完整的 Magnet 对象
  const magnet: Magnet = {
    id: schema.id!,
    type: schema.type as any,
    name: schema.name!,
    anchorType: schema.anchorType!,
    anchors: schema.anchors!,
    content: schema.content || '',
    style: schema.style!,
    state: 'idle',
    interactions: {
      draggable: schema.interactions!.draggable ?? false,
      clickable: schema.interactions!.clickable ?? false,
    },
  };

  return {
    valid: true,
    errors: [],
    warnings,
    magnet,
  };
}

/**
 * 查找空闲区域（用于自动放置 Magnet）
 */
export function findFreeArea(
  occupancyMap: Map<string, PixelOccupancy>,
  requiredSize: { width: number; height: number },
  preferredPosition?: { x: number; y: number }
): FreeAreaResult {
  const { width, height } = requiredSize;

  // 如果指定了首选位置，优先检查该位置附近
  if (preferredPosition) {
    const nearbyPositions = getSpiralSearchPositions(preferredPosition, 5);
    for (const pos of nearbyPositions) {
      if (isAreaFree(occupancyMap, pos, width, height)) {
        return {
          found: true,
          position: pos,
          area: getAreaPixels(pos, width, height),
        };
      }
    }
  }

  // 全局搜索空闲区域
  for (let y = 0; y <= MATRIX_CONFIG.ROWS - height; y++) {
    for (let x = 0; x <= MATRIX_CONFIG.COLUMNS - width; x++) {
      const pos = { x, y };
      if (isAreaFree(occupancyMap, pos, width, height)) {
        return {
          found: true,
          position: pos,
          area: getAreaPixels(pos, width, height),
        };
      }
    }
  }

  return {
    found: false,
    position: null,
    area: [],
  };
}

/**
 * 检查指定区域是否空闲
 */
function isAreaFree(
  occupancyMap: Map<string, PixelOccupancy>,
  position: { x: number; y: number },
  width: number,
  height: number
): boolean {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const x = position.x + dx;
      const y = position.y + dy;
      const key = `${x},${y}`;
      const occupancy = occupancyMap.get(key);
      if (!occupancy || occupancy.isOccupied) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 获取区域内的所有 pixel
 */
function getAreaPixels(
  position: { x: number; y: number },
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  const pixels: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      pixels.push({ x: position.x + dx, y: position.y + dy });
    }
  }
  return pixels;
}

/**
 * 螺旋搜索位置（从中心向外扩散）
 */
function getSpiralSearchPositions(
  center: { x: number; y: number },
  maxRadius: number
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [center];

  for (let radius = 1; radius <= maxRadius; radius++) {
    // 上边
    for (let dx = -radius; dx <= radius; dx++) {
      positions.push({ x: center.x + dx, y: center.y - radius });
    }
    // 下边
    for (let dx = -radius; dx <= radius; dx++) {
      positions.push({ x: center.x + dx, y: center.y + radius });
    }
    // 左边（不包括角）
    for (let dy = -radius + 1; dy < radius; dy++) {
      positions.push({ x: center.x - radius, y: center.y + dy });
    }
    // 右边（不包括角）
    for (let dy = -radius + 1; dy < radius; dy++) {
      positions.push({ x: center.x + radius, y: center.y + dy });
    }
  }

  // 过滤掉超出边界的位置
  return positions.filter(
    (pos) => pos.x >= 0 && pos.x < MATRIX_CONFIG.COLUMNS && pos.y >= 0 && pos.y < MATRIX_CONFIG.ROWS
  );
}

/**
 * 磁吸效果：计算最近的 Pixel 位置
 */
export function snapToNearestPixel(
  mouseX: number,
  mouseY: number,
  pixelPositions: Map<string, { x: number; y: number }>,
  snapDistance: number = 20
): { gridX: number; gridY: number; snapped: boolean } | null {
  let minDistance = Infinity;
  let closestGridX: number | null = null;
  let closestGridY: number | null = null;

  pixelPositions.forEach((pos, key) => {
    const [gridX, gridY] = key.split(',').map(Number);
    const centerX = pos.x + MATRIX_CONFIG.PIXEL_SIZE / 2;
    const centerY = pos.y + MATRIX_CONFIG.PIXEL_SIZE / 2;
    const distance = Math.sqrt(Math.pow(centerX - mouseX, 2) + Math.pow(centerY - mouseY, 2));

    if (distance < minDistance) {
      minDistance = distance;
      closestGridX = gridX;
      closestGridY = gridY;
    }
  });

  if (closestGridX !== null && closestGridY !== null && minDistance <= snapDistance) {
    return { gridX: closestGridX, gridY: closestGridY, snapped: true };
  }

  if (closestGridX !== null && closestGridY !== null) {
    return { gridX: closestGridX, gridY: closestGridY, snapped: false };
  }

  return null;
}

/**
 * 计算移动 Magnet 后的新锚点位置
 * 确保整个magnet在边界内，而不是单独限制每个锚点
 */
export function calculateNewAnchors(magnet: Magnet, deltaX: number, deltaY: number): PixelAnchor[] {
  // 计算magnet的边界
  const minX = Math.min(...magnet.anchors.map((a) => a.gridX));
  const maxX = Math.max(...magnet.anchors.map((a) => a.gridX));
  const minY = Math.min(...magnet.anchors.map((a) => a.gridY));
  const maxY = Math.max(...magnet.anchors.map((a) => a.gridY));

  // 计算移动后的边界
  const newMinX = minX + deltaX;
  const newMaxX = maxX + deltaX;
  const newMinY = minY + deltaY;
  const newMaxY = maxY + deltaY;

  // 调整delta以保持magnet在边界内
  let adjustedDeltaX = deltaX;
  let adjustedDeltaY = deltaY;

  // 检查X方向边界
  if (newMinX < 0) {
    adjustedDeltaX = -minX; // 左边界限制
  } else if (newMaxX >= MATRIX_CONFIG.COLUMNS) {
    adjustedDeltaX = MATRIX_CONFIG.COLUMNS - 1 - maxX; // 右边界限制
  }

  // 检查Y方向边界
  if (newMinY < 0) {
    adjustedDeltaY = -minY; // 上边界限制
  } else if (newMaxY >= MATRIX_CONFIG.ROWS) {
    adjustedDeltaY = MATRIX_CONFIG.ROWS - 1 - maxY; // 下边界限制
  }

  // 使用调整后的delta移动所有锚点
  return magnet.anchors.map((anchor) => ({
    ...anchor,
    gridX: anchor.gridX + adjustedDeltaX,
    gridY: anchor.gridY + adjustedDeltaY,
  }));
}

/**
 * 检查 Magnet 移动后是否与其他 Magnet 冲突
 */
export function checkMagnetCollision(
  magnet: Magnet,
  newAnchors: PixelAnchor[],
  occupancyMap: Map<string, PixelOccupancy>
): boolean {
  const tempMagnet = { ...magnet, anchors: newAnchors };
  const occupiedPixels = getMagnetOccupiedPixels(tempMagnet);

  for (const pixel of occupiedPixels) {
    const key = `${pixel.x},${pixel.y}`;
    const occupancy = occupancyMap.get(key);
    if (occupancy?.isOccupied && occupancy.occupiedBy !== magnet.id) {
      return true; // 发生冲突
    }
  }

  return false; // 无冲突
}
