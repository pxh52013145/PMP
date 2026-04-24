import type { OrnamentItem } from '../../modules/ornaments-v2/store';

export type OrnamentRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function ornamentRect(item: OrnamentItem, viewportWidth: number, viewportHeight: number): OrnamentRect {
  const { width, height, offsetX, offsetY, anchor } = item.placement;
  let baseLeft = (viewportWidth - width) / 2;
  let baseTop = (viewportHeight - height) / 2;

  if (anchor.includes('left')) baseLeft = 0;
  if (anchor.includes('right')) baseLeft = viewportWidth - width;
  if (anchor.startsWith('top')) baseTop = 0;
  if (anchor.startsWith('bottom')) baseTop = viewportHeight - height;

  return {
    left: baseLeft + offsetX,
    top: baseTop + offsetY,
    width,
    height,
  };
}

export function offsetFromRect(
  item: OrnamentItem,
  rect: OrnamentRect,
  viewportWidth: number,
  viewportHeight: number
): { offsetX: number; offsetY: number } {
  const base = ornamentRect(
    { ...item, placement: { ...item.placement, offsetX: 0, offsetY: 0, width: rect.width, height: rect.height } },
    viewportWidth,
    viewportHeight
  );
  return {
    offsetX: Math.round(rect.left - base.left),
    offsetY: Math.round(rect.top - base.top),
  };
}

export function sortedOrnaments(items: readonly OrnamentItem[]): OrnamentItem[] {
  return [...items]
    .filter((item) => item.enabled)
    .sort((a, b) => a.layer.plane - b.layer.plane || a.layer.order - b.layer.order);
}
