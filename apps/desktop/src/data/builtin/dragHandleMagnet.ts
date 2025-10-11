import { appWindow } from '@tauri-apps/api/window';
import { Magnet } from '../../types/pixel';

/**
 * 拖动手柄 Magnet
 * 第一个水平锚点类型的 Magnet
 * 位于窗口顶部中央，用于拖动窗口
 */
export const DRAG_HANDLE_MAGNET: Magnet = {
  id: 'drag-handle',
  type: 'drag-handle',
  name: '拖动区域',
  anchorType: 'horizontal',
  anchors: [
    {
      id: 'left',
      gridX: 9, // 左端点
      gridY: 0,
      role: 'anchor',
    },
    {
      id: 'right',
      gridX: 17, // 右端点（9列宽度）
      gridY: 0,
      role: 'boundary',
    },
  ],
  content: '⋮⋮', // 拖动指示符
  style: {
    height: '36px', // 固定高度（2个pixel）
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    cursor: 'move',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      opacity: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      transform: 'translateY(-1px)',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    },
    activeStyle: {
      transform: 'translateY(0)',
      opacity: 0.9,
    },
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
    onDrag: () => {
      // Tauri 的窗口拖动
      appWindow.startDragging();
    },
  },
};
