import { Magnet } from '../../types/pixel';

/**
 * 编辑器按钮 Magnet
 * 点击进入/退出编辑模式
 */
export const EDITOR_BUTTON_MAGNET: Magnet = {
  id: 'btn-editor',
  type: 'custom',
  name: '编辑器',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 19,
      gridY: 16,
      role: 'anchor',
    },
  ],
  content: '✏️',
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(255, 149, 0, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(255, 149, 0, 0.3)',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.1)',
      filter: 'brightness(1.2)',
      boxShadow: '0 4px 12px rgba(255, 149, 0, 0.5)',
    },
    activeStyle: {
      transform: 'scale(0.95)',
      filter: 'brightness(0.9)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      // 这个会在 App.tsx 中被覆盖为实际的切换编辑模式函数
      console.log('Toggle editor mode');
    },
  },
};
