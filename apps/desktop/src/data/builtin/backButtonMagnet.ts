import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createDockedSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const BACK_BUTTON_CHROME = createControlChromePreset();
const BACK_BUTTON_LAYOUT = createDockedSingleControlLayoutPreset({
  dock: { x: 'start' },
});
const telemetry = getTelemetryLogger('magnets', 'backButtonMagnet');

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
  ...BACK_BUTTON_LAYOUT,
  content: '←',
  style: BACK_BUTTON_CHROME.style,
  animation: BACK_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      telemetry.debug('navigation.back_button.clicked');
    },
  },
};
