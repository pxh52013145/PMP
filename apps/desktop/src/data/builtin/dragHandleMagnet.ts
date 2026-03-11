import type { Magnet } from '../../types/pixel';
import { createDragHandleChromePreset } from '../../modules/magnets/chromePresets';

const DRAG_HANDLE_CHROME = createDragHandleChromePreset();

export const DRAG_HANDLE_MAGNET: Magnet = {
  id: 'drag-handle',
  type: 'drag-handle',
  name: '拖动区域',
  anchorType: 'horizontal',
  anchors: [],
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
