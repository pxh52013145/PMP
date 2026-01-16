import { Magnet } from '../../types/pixel';

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
  gridFootprint: { width: 21, height: 17 },
  content: '', // 内容由 NavigationPage 组件渲染
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
  },
  animation: {
    transition: 'all 0.3s ease',
    hoverStyle: {
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 6px 32px rgba(0, 0, 0, 0.5)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
