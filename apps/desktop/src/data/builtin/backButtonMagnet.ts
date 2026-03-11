import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';

const BACK_BUTTON_CHROME = createControlChromePreset();

/**
 * 返回按钮 Magnet
 * 用于导航页面的返回操作
 */
export const BACK_BUTTON_MAGNET: Magnet = {
  id: 'btn-back',
  type: 'navigation',
  name: '返回',
  anchorType: 'single',
  anchors: [],
  content: '←',
  style: BACK_BUTTON_CHROME.style,
  animation: BACK_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('返回按钮点击');
    },
  },
};
