import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  STANDARD_HORIZONTAL_BAR_CHROME_INSET,
  createHorizontalBarLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const MATRIX_CHANGE_CHROME = createPanelChromePreset({
  style: {
    height: '36px',
  },
});
const MATRIX_CHANGE_LAYOUT = createHorizontalBarLayoutPreset({
  height: 36,
  chromeInset: STANDARD_HORIZONTAL_BAR_CHROME_INSET,
});

export const MATRIX_CHANGE_MAGNET: Magnet = {
  id: 'btn-matrix-change',
  type: 'custom',
  name: '空间切换',
  renderer: 'btn-matrix-change',
  previewText: 'SPACE',
  description: '管理 Magnet Spaces（点击打开面板）',
  tags: ['space', 'layout'],
  anchorType: 'horizontal',
  anchors: [],
  gridFootprint: { width: 3, height: 1 },
  ...MATRIX_CHANGE_LAYOUT,
  content: '',
  style: MATRIX_CHANGE_CHROME.style,
  animation: MATRIX_CHANGE_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};
