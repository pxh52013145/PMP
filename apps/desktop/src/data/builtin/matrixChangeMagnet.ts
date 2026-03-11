import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';

const MATRIX_CHANGE_CHROME = createPanelChromePreset({
  style: {
    height: '36px',
  },
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
  content: '',
  style: MATRIX_CHANGE_CHROME.style,
  animation: MATRIX_CHANGE_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};
