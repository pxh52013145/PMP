import { Magnet } from '../../types/pixel';

/**
 * 窗口置顶按钮 Magnet 配置
 * 单锚点类型，用于切换窗口置顶状态
 *
 * 注意：具体实现由 renderer 提供（桌面端绑定到 Tauri，Web/Mobile 可提供对应实现或降级）。
 */
export const WINDOW_PIN_MAGNET: Magnet = {
  id: 'btn-window-pin',
  type: 'window-control',
  name: '窗口置顶',
  renderer: 'btn-window-pin',
  previewText: 'Pin',
  anchorType: 'single',
  anchors: [],
  content: '📌',
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
    clickable: false, // 点击由 renderer 内部处理
  },
};
