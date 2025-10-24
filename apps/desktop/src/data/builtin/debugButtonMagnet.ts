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
    backgroundColor: 'rgba(255, 136, 0, 0.8)',
    border: '1px solid rgba(255, 136, 0, 0.4)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '1.2rem',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.3s ease',
  },

  // 动画
  animation: {
    hoverStyle: {
      backgroundColor: 'rgba(255, 136, 0, 1)',
      transform: 'scale(1.1)',
      boxShadow: '0 0 20px rgba(255, 136, 0, 0.6)',
    },
    activeStyle: {
      transform: 'scale(0.95)',
    },
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
