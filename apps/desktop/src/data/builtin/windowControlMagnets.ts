import { Magnet } from '../../types/pixel';

/**
 * 窗口控制按钮 Magnet 配置
 * 三个单锚点类型的 Magnet：最小化、最大化、关闭
 *
 * 注意：具体窗口行为（Tauri / Web / Mobile）由运行时绑定提供，避免在模板层直接依赖平台 API。
 */
export const WINDOW_CONTROL_MAGNETS: Magnet[] = [
  {
    id: 'btn-minimize',
    type: 'window-control',
    name: '最小化',
    anchorType: 'single',
    anchors: [],
    content: '\u2500', // ─
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
    },
  },
  {
    id: 'btn-maximize',
    type: 'window-control',
    name: '最大化',
    anchorType: 'single',
    anchors: [],
    content: '\u25fb', // ◻ 使用 Unicode 正方形符号，更好居中
    style: {
      width: '36px',
      height: '36px',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '2.7px',
      fontSize: '14px', // 稍微调小字体
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
    },
  },
  {
    id: 'btn-close',
    type: 'window-control',
    name: '关闭',
    anchorType: 'single',
    anchors: [],
    content: '\u2715', // ✕
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
        backgroundColor: 'rgba(220, 38, 38, 0.9)',
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
    },
  },
];
