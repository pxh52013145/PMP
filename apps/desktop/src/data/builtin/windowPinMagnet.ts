import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createCenteredSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';

const WINDOW_PIN_CHROME = createControlChromePreset();
const WINDOW_PIN_LAYOUT = createCenteredSingleControlLayoutPreset();

/**
 * 窗口置顶按钮 Magnet 配置
 * 单锚点类型，用于切换窗口置顶状态
 *
 * 注意：具体实现由 renderer 提供（桌面端绑定到 Tauri，Web/Mobile 可提供对应实现或降级）。
 */
export const WINDOW_PIN_MAGNET: Magnet = {
  id: 'btn-window-pin',
  type: 'window-control',
  name: '窗口置顶',
  renderer: 'btn-window-pin',
  previewText: 'Pin',
  anchorType: 'single',
  anchors: [],
  ...WINDOW_PIN_LAYOUT,
  content: '📌',
  style: WINDOW_PIN_CHROME.style,
  animation: WINDOW_PIN_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false, // 点击由 renderer 内部处理
  },
};
