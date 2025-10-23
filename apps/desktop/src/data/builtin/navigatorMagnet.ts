import { Magnet } from '../../types/pixel';

/**
 * 路由导航 Magnet
 * 提供页面导航和路由功能
 * 作为主视图容器，响应其他 Magnet 的交互来切换页面
 */
export const NAVIGATOR_MAGNET: Magnet = {
  id: 'navigator',
  type: 'navigator',
  name: '路由导航器',
  anchorType: 'rectangular',
  anchors: [
    {
      id: 'top-left',
      gridX: 0,
      gridY: 4,
      role: 'anchor',
    },
    {
      id: 'top-right',
      gridX: 26,
      gridY: 4,
      role: 'boundary',
    },
    {
      id: 'bottom-left',
      gridX: 0,
      gridY: 17,
      role: 'boundary',
    },
    {
      id: 'bottom-right',
      gridX: 26,
      gridY: 17,
      role: 'boundary',
    },
  ],
  content: '', // 内容由 Navigator 组件渲染
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0)', // 透明，让组件自己处理背景
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
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
