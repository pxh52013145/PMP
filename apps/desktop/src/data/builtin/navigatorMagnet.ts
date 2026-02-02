import { Magnet } from '../../types/pixel';

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
  gridFootprint: { width: 27, height: 14 },
  content: '', // 内容由 Navigator 组件渲染
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0)', // 透明，让组件自己处理背景
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2.7px',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  animation: {
    transition: 'all 0.2s ease',
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
