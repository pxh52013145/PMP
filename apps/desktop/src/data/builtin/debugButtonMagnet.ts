import { Magnet } from '../../types/pixel';

/**
 * 调试按钮 Magnet
 * 位置：(0, 19) - 左下角
 * 用于打开主题系统调试页面
 */
export const DEBUG_BUTTON_MAGNET: Magnet = {
  id: 'btn-debug',
  type: 'custom',
  name: '调试',

  // 单点锚定在左下角
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 0,
      gridY: 19,
      role: 'anchor',
    },
  ],

  // 内容
  content: '🛠️',

  // 样式
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },

  // 动画
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

  // 状态
  state: 'idle',

  // 交互
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('打开调试页面');
    },
  },
};
