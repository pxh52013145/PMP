/**
 * 自定义 Magnet 示例
 * 演示如何在代码中创建带功能的 Magnet
 */

import { Magnet } from '../../types/pixel';

/**
 * 示例1：带点击功能的帮助按钮
 */
export const HELP_BUTTON_MAGNET: Magnet = {
  id: 'custom-help-button',
  type: 'custom',
  name: '帮助按钮',
  anchorType: 'single',
  anchors: [{ id: 'anchor', gridX: 25, gridY: 1, role: 'anchor' }],
  content: '?',

  style: {
    width: '32px',
    height: '32px',
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.1)',
      backgroundColor: 'rgba(0, 122, 255, 1)',
    },
    activeStyle: {
      transform: 'scale(0.95)',
    },
  },

  state: 'idle',

  interactions: {
    draggable: false,
    clickable: true,
    // ✅ 在代码中可以直接定义功能
    onClick: () => {
      window.open('https://github.com/your-repo/help', '_blank');
    },
    onHover: () => {
      console.log('Help button hovered');
    },
  },
};

/**
 * 示例2：带状态切换的音量按钮
 */
export const VOLUME_TOGGLE_MAGNET: Magnet = {
  id: 'custom-volume-toggle',
  type: 'custom',
  name: '音量开关',
  anchorType: 'single',
  anchors: [{ id: 'anchor', gridX: 23, gridY: 16, role: 'anchor' }],
  content: '🔊',

  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '18px',
  },

  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.05)',
      filter: 'brightness(1.2)',
    },
  },

  state: 'idle',

  interactions: {
    draggable: false,
    clickable: true,
    // ✅ 复杂的交互逻辑
    onClick: function () {
      // 切换音量图标
      const element = document.querySelector('[data-magnet-id="custom-volume-toggle"]');
      if (element) {
        const currentContent = element.textContent;
        element.textContent = currentContent === '🔊' ? '🔇' : '🔊';
      }
      console.log('Volume toggled');
    },
  },
};

/**
 * 示例3：从Creator导出的JSON + 手动添加功能
 *
 * 工作流程：
 * 1. 在Creator中设计样式和动画
 * 2. 导出JSON
 * 3. 粘贴到这里
 * 4. 手动添加 onClick 等功能
 */
export const CUSTOM_BUTTON_FROM_CREATOR: Magnet = {
  // 👇 以下是从Creator导出的JSON
  id: 'custom-styled-button',
  type: 'custom',
  name: '样式按钮',
  anchorType: 'single',
  anchors: [{ id: 'anchor', gridX: 20, gridY: 10, role: 'anchor' }],
  content: 'Click',
  style: {
    width: '64px',
    height: '36px',
    backgroundColor: 'rgba(255, 0, 127, 0.8)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    border: '2px solid rgba(255, 255, 255, 0.3)',
  },
  animation: {
    transition: 'all 0.3s ease',
    hoverStyle: {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(255, 0, 127, 0.4)',
    },
    activeStyle: {
      transform: 'translateY(0)',
    },
  },
  state: 'idle',

  // 👇 手动添加功能
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      alert('Custom button clicked!');
      // 可以调用任何JavaScript代码
      console.log('Button action executed');
    },
  },
};
