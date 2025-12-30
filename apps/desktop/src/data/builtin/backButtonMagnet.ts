import { Magnet } from '../../types/pixel';

/**
 * 返回按钮 Magnet
 * 用于导航页面的返回操作
 */
export const BACK_BUTTON_MAGNET: Magnet = {
  id: 'btn-back',
  type: 'navigation',
  name: '返回',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 0,
      gridY: 0,
      role: 'anchor',
    },
  ],
  content: '←',
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.05)',
      backgroundColor: 'rgba(60, 60, 60, 0.9)',
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
    },
    activeStyle: {
      transform: 'scale(0.95)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('返回按钮点击');
    },
  },
};
