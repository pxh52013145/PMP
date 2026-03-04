import type { BackgroundCropRect } from '../../types/background';

export interface GeometrySize {
  width: number;
  height: number;
}

export interface MediaCropLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SIZE = 0.0001;

function sanitizeSize(size: GeometrySize): GeometrySize | null {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  if (size.width <= 0 || size.height <= 0) return null;
  return {
    width: Math.max(size.width, MIN_SIZE),
    height: Math.max(size.height, MIN_SIZE),
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function clampCropRect(crop: BackgroundCropRect): BackgroundCropRect {
  const x = clampPercent(crop.x);
  const y = clampPercent(crop.y);
  const width = clampPercent(crop.width);
  const height = clampPercent(crop.height);
  return {
    ...crop,
    x,
    y,
    width: Math.max(0.01, Math.min(width, 100 - x)),
    height: Math.max(0.01, Math.min(height, 100 - y)),
  };
}

export function computeContainMediaBox(container: GeometrySize, media: GeometrySize): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const safeContainer = sanitizeSize(container);
  const safeMedia = sanitizeSize(media);
  if (!safeContainer || !safeMedia) return null;

  const containerRatio = safeContainer.width / safeContainer.height;
  const mediaRatio = safeMedia.width / safeMedia.height;

  if (mediaRatio >= containerRatio) {
    const width = safeContainer.width;
    const height = width / mediaRatio;
    return {
      x: 0,
      y: (safeContainer.height - height) / 2,
      width,
      height,
    };
  }

  const height = safeContainer.height;
  const width = height * mediaRatio;
  return {
    x: (safeContainer.width - width) / 2,
    y: 0,
    width,
    height,
  };
}

export function convertViewportCropToMediaCrop(
  viewportCrop: BackgroundCropRect,
  container: GeometrySize,
  media: GeometrySize
): BackgroundCropRect | null {
  const safeContainer = sanitizeSize(container);
  const containBox = computeContainMediaBox(container, media);
  if (!safeContainer || !containBox) return null;

  const normalizedViewport = clampCropRect(viewportCrop);

  const rectX = (normalizedViewport.x / 100) * safeContainer.width;
  const rectY = (normalizedViewport.y / 100) * safeContainer.height;
  const rectW = (normalizedViewport.width / 100) * safeContainer.width;
  const rectH = (normalizedViewport.height / 100) * safeContainer.height;

  const interLeft = Math.max(rectX, containBox.x);
  const interTop = Math.max(rectY, containBox.y);
  const interRight = Math.min(rectX + rectW, containBox.x + containBox.width);
  const interBottom = Math.min(rectY + rectH, containBox.y + containBox.height);

  if (interRight <= interLeft || interBottom <= interTop) {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      space: 'media',
    };
  }

  return clampCropRect({
    x: ((interLeft - containBox.x) / containBox.width) * 100,
    y: ((interTop - containBox.y) / containBox.height) * 100,
    width: ((interRight - interLeft) / containBox.width) * 100,
    height: ((interBottom - interTop) / containBox.height) * 100,
    space: 'media',
  });
}

export function convertMediaCropToViewportCrop(
  mediaCrop: BackgroundCropRect,
  container: GeometrySize,
  media: GeometrySize
): BackgroundCropRect | null {
  const safeContainer = sanitizeSize(container);
  const containBox = computeContainMediaBox(container, media);
  if (!safeContainer || !containBox) return null;

  const normalizedMedia = clampCropRect(mediaCrop);
  const left = containBox.x + (normalizedMedia.x / 100) * containBox.width;
  const top = containBox.y + (normalizedMedia.y / 100) * containBox.height;
  const width = (normalizedMedia.width / 100) * containBox.width;
  const height = (normalizedMedia.height / 100) * containBox.height;

  return clampCropRect({
    x: (left / safeContainer.width) * 100,
    y: (top / safeContainer.height) * 100,
    width: (width / safeContainer.width) * 100,
    height: (height / safeContainer.height) * 100,
    space: 'viewport',
  });
}

export function computeMediaCropLayout(
  mediaCrop: BackgroundCropRect,
  container: GeometrySize,
  media: GeometrySize
): MediaCropLayout | null {
  const safeContainer = sanitizeSize(container);
  const safeMedia = sanitizeSize(media);
  if (!safeContainer || !safeMedia) return null;

  const crop = clampCropRect(mediaCrop);
  const cropX = (crop.x / 100) * safeMedia.width;
  const cropY = (crop.y / 100) * safeMedia.height;
  const cropW = (crop.width / 100) * safeMedia.width;
  const cropH = (crop.height / 100) * safeMedia.height;

  if (cropW <= 0 || cropH <= 0) return null;

  // Anchor-mapping model:
  // map crop rectangle's 4 corners directly to container's 4 corners.
  // This guarantees editor crop anchors and real background anchors are identical.
  const scaleX = safeContainer.width / cropW;
  const scaleY = safeContainer.height / cropH;
  const width = safeMedia.width * scaleX;
  const height = safeMedia.height * scaleY;
  const left = -cropX * scaleX;
  const top = -cropY * scaleY;

  return { left, top, width, height };
}
