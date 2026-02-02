import { Magnet } from '../../types/pixel';

/**
 * 编辑器按钮 Magnet
 * 点击进入/退出编辑模式
 */
export const EDITOR_BUTTON_MAGNET: Magnet = {
  id: 'btn-editor',
  type: 'custom',
  name: '编辑器',
  previewText: 'Edit',
  anchorType: 'single',
  anchors: [],
  content: '\u270e', // ✎
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2.7px',
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
    draggable: false,
    clickable: true,
    onClick: () => {
      // 这个会在 App.tsx 中被覆盖为实际的切换编辑模式函数
      console.log('Toggle editor mode');
    },
  },
};
