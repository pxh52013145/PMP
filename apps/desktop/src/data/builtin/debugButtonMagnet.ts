import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createCenteredSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const DEBUG_BUTTON_CHROME = createControlChromePreset();
const DEBUG_BUTTON_LAYOUT = createCenteredSingleControlLayoutPreset();
const telemetry = getTelemetryLogger('magnets', 'debugButtonMagnet');

/**
 * 设置按钮 Magnet（历史 id：btn-debug）
 * 位置：(0, 19) - 左下角
 * 用于切换到 Settings 页面
 */
export const DEBUG_BUTTON_MAGNET: Magnet = {
  id: 'btn-debug',
  type: 'custom',
  name: '设置',

  // 单点锚定在左下角
  anchorType: 'single',
  anchors: [],
  ...DEBUG_BUTTON_LAYOUT,

  // 内容
  content: '🛠️',

  // 样式
  style: DEBUG_BUTTON_CHROME.style,

  // 动画
  animation: DEBUG_BUTTON_CHROME.animation,

  // 状态
  state: 'idle',

  // 交互
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      telemetry.debug('navigation.debug_button.clicked');
    },
  },
};
