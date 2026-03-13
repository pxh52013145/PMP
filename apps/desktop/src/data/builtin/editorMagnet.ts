import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createCenteredSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';

const EDITOR_BUTTON_CHROME = createControlChromePreset();
const EDITOR_BUTTON_LAYOUT = createCenteredSingleControlLayoutPreset();

/**
 * 编辑器按钮 Magnet
 * 点击进入/退出编辑模式
 */
export const EDITOR_BUTTON_MAGNET: Magnet = {
  id: 'btn-editor',
  type: 'custom',
  name: '编辑器',
  previewText: 'Edit',
  anchorType: 'single',
  anchors: [],
  ...EDITOR_BUTTON_LAYOUT,
  content: '\u270e', // ✎
  style: EDITOR_BUTTON_CHROME.style,
  animation: EDITOR_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      // 这个会在 App.tsx 中被覆盖为实际的切换编辑模式函数
      console.log('Toggle editor mode');
    },
  },
};
