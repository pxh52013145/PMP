import type { Magnet } from '../../types/pixel';
import { createDragHandleChromePreset } from '../../modules/magnets/chromePresets';
import {
  STANDARD_HORIZONTAL_BAR_CHROME_INSET,
  createHorizontalBarLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const DRAG_HANDLE_CHROME = createDragHandleChromePreset();
const DRAG_HANDLE_LAYOUT = createHorizontalBarLayoutPreset({
  height: 36,
  chromeInset: STANDARD_HORIZONTAL_BAR_CHROME_INSET,
});

export const DRAG_HANDLE_MAGNET: Magnet = {
  id: 'drag-handle',
  type: 'drag-handle',
  name: '拖动区域',
  anchorType: 'horizontal',
  anchors: [],
  ...DRAG_HANDLE_LAYOUT,
  gridFootprint: { width: 9, height: 1 },
  content: '\u22ee\u22ee',
  style: DRAG_HANDLE_CHROME.style,
  animation: DRAG_HANDLE_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};
