import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';

const MINIMIZE_CHROME = createControlChromePreset();
const MAXIMIZE_CHROME = createControlChromePreset({ style: { fontSize: '14px' } });
const CLOSE_CHROME = createControlChromePreset({
  hoverStyle: {
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
  },
});

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
    style: MINIMIZE_CHROME.style,
    animation: MINIMIZE_CHROME.animation,
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
    style: MAXIMIZE_CHROME.style,
    animation: MAXIMIZE_CHROME.animation,
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
    style: CLOSE_CHROME.style,
    animation: CLOSE_CHROME.animation,
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: true,
    },
  },
];
