/**
 * Magnet 位置冲突检测和自动调整工具
 * 在初始化时自动检测并解决magnet之间的位置冲突
 */

import { Magnet } from '../types/pixel';
import { MATRIX_CONFIG } from '../constants/config';

/**
 * 计算单个magnet占用的所有像素位置
 */
function getMagnetOccupiedPixels(magnet: Magnet): { x: number; y: number }[] {
  const pixels: { x: number; y: number }[] = [];

  if (magnet.anchorType === 'single') {
    const anchor = magnet.anchors[0];
    // 单锚点占用一个pixel
    pixels.push({ x: anchor.gridX, y: anchor.gridY });
  } else if (magnet.anchorType === 'horizontal') {
    const left = magnet.anchors.find((a) => a.id === 'left' || a.role === 'anchor')!;
    const right = magnet.anchors.find((a) => a.id === 'right' || a.role === 'boundary')!;
    // 水平占用一行
    for (let x = left.gridX; x <= right.gridX; x++) {
      pixels.push({ x, y: left.gridY });
    }
  } else if (magnet.anchorType === 'vertical') {
    const top = magnet.anchors.find((a) => a.id === 'top' || a.role === 'anchor')!;
    const bottom = magnet.anchors.find((a) => a.id === 'bottom' || a.role === 'boundary')!;
    // 垂直占用一列
    for (let y = top.gridY; y <= bottom.gridY; y++) {
      pixels.push({ x: top.gridX, y });
    }
  } else if (magnet.anchorType === 'rectangular') {
    const topLeft = magnet.anchors.find((a) => a.id === 'top-left' || a.role === 'anchor')!;
    const bottomRight = magnet.anchors.find((a) => a.id === 'bottom-right')!;
    // 矩形占用整个区域
    for (let x = topLeft.gridX; x <= bottomRight.gridX; x++) {
      for (let y = topLeft.gridY; y <= bottomRight.gridY; y++) {
        pixels.push({ x, y });
      }
    }
  }

  return pixels;
}

/**
 * 计算两个位置之间的曼哈顿距离
 */
function manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * 收集网格中所有未被占用的空闲位置
 */
function collectEmptyPositions(
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): Array<{ x: number; y: number }> {
  const emptyPositions: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const key = `${x},${y}`;
      if (!occupiedPixels.has(key)) {
        emptyPositions.push({ x, y });
      }
    }
  }

  return emptyPositions;
}

/**
 * 智能寻找最佳空余位置（单锚点）
 * 策略：
 * 1. 优先选择离原位置最近的空位
 * 2. 如果距离相同，优先选择边缘位置（右侧、底部）
 * 3. 全局扫描，不受限于搜索半径
 */
function findBestEmptyPosition(
  originalX: number,
  originalY: number,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): { x: number; y: number } | null {
  // 检查原位置是否可用
  const key = `${originalX},${originalY}`;
  if (!occupiedPixels.has(key)) {
    return { x: originalX, y: originalY };
  }

  // 收集所有空闲位置
  const emptyPositions = collectEmptyPositions(occupiedPixels, gridWidth, gridHeight);

  if (emptyPositions.length === 0) {
    return null; // 没有空位
  }

  // 计算每个空位的评分
  const scoredPositions = emptyPositions.map((pos) => {
    const distance = manhattanDistance(originalX, originalY, pos.x, pos.y);

    // 边缘位置加分（右侧和底部更适合放置按钮）
    let edgeBonus = 0;
    if (pos.x >= gridWidth - 3) edgeBonus += 2; // 右侧边缘
    if (pos.y >= gridHeight - 3) edgeBonus += 1; // 底部边缘
    if (pos.y <= 2) edgeBonus += 1; // 顶部边缘

    // 评分：距离越近越好，边缘位置加分
    const score = distance - edgeBonus;

    return { pos, distance, edgeBonus, score };
  });

  // 按评分排序，选择最佳位置
  scoredPositions.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // 评分相同时，优先选择右下角
    if (a.pos.x !== b.pos.x) return b.pos.x - a.pos.x;
    return b.pos.y - a.pos.y;
  });

  const bestPosition = scoredPositions[0].pos;
  const bestScore = scoredPositions[0];

  console.log(
    `📍 为位置 (${originalX},${originalY}) 找到最佳空位 (${bestPosition.x},${bestPosition.y}), ` +
      `距离=${bestScore.distance}, 边缘加分=${bestScore.edgeBonus} [网格: ${gridWidth}x${gridHeight}]`
  );

  return bestPosition;
}

/**
 * 检查指定矩形区域是否与已占用像素冲突
 */
function isRectangleFree(
  x: number,
  y: number,
  width: number,
  height: number,
  occupiedPixels: Set<string>
): boolean {
  for (let px = x; px < x + width; px++) {
    for (let py = y; py < y + height; py++) {
      if (occupiedPixels.has(`${px},${py}`)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 为矩形类型的magnet寻找空闲区域
 */
function findBestEmptyRectangle(
  originalX: number,
  originalY: number,
  width: number,
  height: number,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): { x: number; y: number } | null {
  // 检查原位置是否可用
  if (isRectangleFree(originalX, originalY, width, height, occupiedPixels)) {
    return { x: originalX, y: originalY };
  }

  // 搜索所有可能的位置
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (let y = 0; y <= gridHeight - height; y++) {
    for (let x = 0; x <= gridWidth - width; x++) {
      if (isRectangleFree(x, y, width, height, occupiedPixels)) {
        const distance = manhattanDistance(originalX, originalY, x, y);
        candidates.push({ x, y, distance });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 选择距离最近的位置
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    // 距离相同时，优先右下角
    if (a.x !== b.x) return b.x - a.x;
    return b.y - a.y;
  });

  const best = candidates[0];
  console.log(
    `📍 为矩形区域 (${originalX},${originalY}) [${width}x${height}] 找到空位 (${best.x},${best.y}), 距离=${best.distance}`
  );

  return { x: best.x, y: best.y };
}

/**
 * 智能调整单个magnet的位置，避免冲突
 */
function adjustMagnetPosition(
  magnet: Magnet,
  occupiedPixels: Set<string>,
  gridWidth: number = MATRIX_CONFIG.COLUMNS,
  gridHeight: number = MATRIX_CONFIG.ROWS
): Magnet {
  // 处理单锚点类型
  if (magnet.anchorType === 'single') {
    const anchor = magnet.anchors[0];
    const newPos = findBestEmptyPosition(
      anchor.gridX,
      anchor.gridY,
      occupiedPixels,
      gridWidth,
      gridHeight
    );

    if (newPos && (newPos.x !== anchor.gridX || newPos.y !== anchor.gridY)) {
      console.log(
        `🔧 Magnet "${magnet.name}" 位置冲突，已自动调整: (${anchor.gridX},${anchor.gridY}) → (${newPos.x},${newPos.y})`
      );

      return {
        ...magnet,
        anchors: [
          {
            ...anchor,
            gridX: newPos.x,
            gridY: newPos.y,
          },
        ],
      };
    }

    return magnet;
  }

  // 处理矩形类型
  if (magnet.anchorType === 'rectangular') {
    const topLeft = magnet.anchors.find((a) => a.id === 'top-left' || a.role === 'anchor')!;
    const bottomRight = magnet.anchors.find((a) => a.id === 'bottom-right')!;

    const width = bottomRight.gridX - topLeft.gridX + 1;
    const height = bottomRight.gridY - topLeft.gridY + 1;

    const newPos = findBestEmptyRectangle(
      topLeft.gridX,
      topLeft.gridY,
      width,
      height,
      occupiedPixels,
      gridWidth,
      gridHeight
    );

    if (newPos && (newPos.x !== topLeft.gridX || newPos.y !== topLeft.gridY)) {
      const offsetX = newPos.x - topLeft.gridX;
      const offsetY = newPos.y - topLeft.gridY;

      console.log(
        `🔧 Magnet "${magnet.name}" [${width}x${height}] 位置冲突，已自动调整: ` +
          `(${topLeft.gridX},${topLeft.gridY}) → (${newPos.x},${newPos.y})`
      );

      return {
        ...magnet,
        anchors: magnet.anchors.map((anchor) => ({
          ...anchor,
          gridX: anchor.gridX + offsetX,
          gridY: anchor.gridY + offsetY,
        })),
      };
    }

    return magnet;
  }

  // 水平和垂直类型暂不支持自动调整
  return magnet;
}

/**
 * 计算magnet占用的面积（用于排序）
 */
function getMagnetArea(magnet: Magnet): number {
  if (magnet.anchorType === 'single') {
    return 1;
  } else if (magnet.anchorType === 'horizontal') {
    const left = magnet.anchors.find((a) => a.id === 'left' || a.role === 'anchor')!;
    const right = magnet.anchors.find((a) => a.id === 'right' || a.role === 'boundary')!;
    return right.gridX - left.gridX + 1;
  } else if (magnet.anchorType === 'vertical') {
    const top = magnet.anchors.find((a) => a.id === 'top' || a.role === 'anchor')!;
    const bottom = magnet.anchors.find((a) => a.id === 'bottom' || a.role === 'boundary')!;
    return bottom.gridY - top.gridY + 1;
  } else if (magnet.anchorType === 'rectangular') {
    const topLeft = magnet.anchors.find((a) => a.id === 'top-left' || a.role === 'anchor')!;
    const bottomRight = magnet.anchors.find((a) => a.id === 'bottom-right')!;
    const width = bottomRight.gridX - topLeft.gridX + 1;
    const height = bottomRight.gridY - topLeft.gridY + 1;
    return width * height;
  }
  return 0;
}

/**
 * 解析结果
 */
export interface MagnetResolutionResult {
  /** 成功放置的magnets */
  resolved: Magnet[];
  /** 因空间不足无法放置的magnets */
  skipped: Array<{
    magnet: Magnet;
    reason: string;
  }>;
}

/**
 * 解析所有magnet的位置冲突
 * 按照优先级处理：矩形 > 水平/垂直 > 单锚点
 * 相同类型的magnet，面积大的优先
 * 较大的magnet优先占用位置，较小的magnet会自动调整
 *
 * @returns 解析结果，包含成功放置的和被跳过的magnets
 */
export function resolveMagnetPositions(magnets: Magnet[]): Magnet[] {
  // 按类型和面积排序：
  // 1. 类型优先级：矩形 > 水平/垂直 > 单锚点
  // 2. 相同类型：面积大的优先
  const priorityOrder = { rectangular: 0, horizontal: 1, vertical: 1, single: 2 };
  const sortedMagnets = [...magnets].sort((a, b) => {
    const priorityDiff = priorityOrder[a.anchorType] - priorityOrder[b.anchorType];
    if (priorityDiff !== 0) return priorityDiff;
    // 相同优先级，面积大的优先
    return getMagnetArea(b) - getMagnetArea(a);
  });

  const occupiedPixels = new Set<string>();
  const resolvedMagnets: Magnet[] = [];
  const skippedMagnets: Array<{ magnet: Magnet; reason: string }> = [];

  for (const magnet of sortedMagnets) {
    // 检查当前magnet是否与已占用位置冲突
    const magnetPixels = getMagnetOccupiedPixels(magnet);
    const hasConflictWithOccupied = magnetPixels.some((p) => occupiedPixels.has(`${p.x},${p.y}`));

    let finalMagnet = magnet;

    if (hasConflictWithOccupied) {
      // 尝试调整位置
      finalMagnet = adjustMagnetPosition(magnet, occupiedPixels);

      // 检查调整后是否还有冲突
      const adjustedPixels = getMagnetOccupiedPixels(finalMagnet);
      const stillHasConflict = adjustedPixels.some((p) => occupiedPixels.has(`${p.x},${p.y}`));

      if (stillHasConflict) {
        const area = getMagnetArea(magnet);
        const reason = `空间不足，无法放置 ${area} 像素的 ${magnet.anchorType} 类型 magnet`;
        console.warn(`⚠️ Magnet "${magnet.name || magnet.id}" 被跳过: ${reason}`);
        skippedMagnets.push({ magnet, reason });
        continue; // 跳过此magnet，不添加到结果中
      }
    }

    // 标记占用的位置
    const finalPixels = getMagnetOccupiedPixels(finalMagnet);
    finalPixels.forEach((p) => occupiedPixels.add(`${p.x},${p.y}`));

    resolvedMagnets.push(finalMagnet);
  }

  // 输出统计信息
  if (skippedMagnets.length > 0) {
    console.warn(
      `📊 位置解析完成: ${resolvedMagnets.length} 个成功, ${skippedMagnets.length} 个跳过`
    );
    skippedMagnets.forEach(({ magnet, reason }) => {
      console.warn(`   ❌ ${magnet.name || magnet.id}: ${reason}`);
    });
  } else {
    console.log(`✅ 位置解析完成: 所有 ${resolvedMagnets.length} 个 magnets 已成功放置`);
  }

  // 恢复原始顺序
  return resolvedMagnets.sort((a, b) => {
    const aIndex = magnets.findIndex((m) => m.id === a.id);
    const bIndex = magnets.findIndex((m) => m.id === b.id);
    return aIndex - bIndex;
  });
}

/**
 * 检测并报告所有冲突
 * 用于调试和诊断
 */
export function detectConflicts(magnets: Magnet[]): Array<{
  magnet1: string;
  magnet2: string;
  conflictPixels: { x: number; y: number }[];
}> {
  const conflicts: Array<{
    magnet1: string;
    magnet2: string;
    conflictPixels: { x: number; y: number }[];
  }> = [];

  for (let i = 0; i < magnets.length; i++) {
    for (let j = i + 1; j < magnets.length; j++) {
      const m1 = magnets[i];
      const m2 = magnets[j];

      const pixels1 = getMagnetOccupiedPixels(m1);
      const pixels2 = getMagnetOccupiedPixels(m2);

      const conflictPixels = pixels1.filter((p1) =>
        pixels2.some((p2) => p1.x === p2.x && p1.y === p2.y)
      );

      if (conflictPixels.length > 0) {
        conflicts.push({
          magnet1: m1.name || m1.id,
          magnet2: m2.name || m2.id,
          conflictPixels,
        });
      }
    }
  }

  return conflicts;
}
