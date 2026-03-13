import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import { createPanelLayoutPreset } from '../../modules/magnets/layoutPresets';

const NAVIGATION_PAGE_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
  },
  hoverStyle: {
    border: '1px solid rgba(255, 255, 255, 0.15)',
    boxShadow: '0 6px 32px rgba(0, 0, 0, 0.5)',
  },
});
const NAVIGATION_PAGE_LAYOUT = createPanelLayoutPreset();

/**
 * 导航页面 Magnet
 * 主要内容展示区域，可显示不同页面（首页、歌曲详情等）
 * 通过与其他 Magnet 交互来切换页面内容
 */
export const NAVIGATION_PAGE_MAGNET: Magnet = {
  id: 'navigation-page',
  type: 'navigation',
  name: '导航页面',
  anchorType: 'rectangular',
  anchors: [],
  ...NAVIGATION_PAGE_LAYOUT,
  gridFootprint: { width: 21, height: 17 },
  content: '', // 内容由 NavigationPage 组件渲染
  style: NAVIGATION_PAGE_CHROME.style,
  animation: NAVIGATION_PAGE_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
