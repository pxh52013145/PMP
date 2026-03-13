import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import { createPanelLayoutPreset } from '../../modules/magnets/layoutPresets';

const NAVIGATOR_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  hoverStyle: {
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
});
const NAVIGATOR_LAYOUT = createPanelLayoutPreset();

/**
 * 路由导航 Magnet
 * 提供页面导航和路由功能
 * 作为主视图容器，响应其他 Magnet 的交互来切换页面
 */
export const NAVIGATOR_MAGNET: Magnet = {
  id: 'navigator',
  type: 'navigation',
  name: '路由导航器',
  anchorType: 'rectangular',
  anchors: [],
  ...NAVIGATOR_LAYOUT,
  gridFootprint: { width: 27, height: 14 },
  content: '', // 内容由 Navigator 组件渲染
  style: NAVIGATOR_CHROME.style,
  animation: NAVIGATOR_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
