import { Magnet } from '../../types/pixel';

/**
 * 音乐播放器控制按钮 Magnet 配置
 * 位于窗口底部中央区域，提供音乐播放控制功能
 */

// ==================== 播放控制按钮（单锚点）====================

/**
 * 上一首按钮
 */
export const PREVIOUS_BUTTON: Magnet = {
  id: 'btn-previous',
  type: 'playback-control',
  name: '上一首',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 9,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '⟪',
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
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Previous track');
      // TODO: 集成音乐播放器API
    },
  },
};

/**
 * 播放/暂停按钮
 */
export const PLAY_PAUSE_BUTTON: Magnet = {
  id: 'btn-play-pause',
  type: 'playback-control',
  name: '播放/暂停',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 11,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '▶', // 默认显示播放
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 123, 255, 0.8)', // 主要操作使用醒目的蓝色
    border: '2px solid rgba(255, 255, 255, 0.2)',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.05)',
      backgroundColor: 'rgba(0, 123, 255, 1)',
      boxShadow: '0 4px 8px rgba(0, 123, 255, 0.3)',
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
      console.log('Toggle play/pause');
      // TODO: 集成音乐播放器API
      // TODO: 切换按钮显示内容（▶ ⇄ ⏸）
    },
  },
};

/**
 * 下一首按钮
 */
export const NEXT_BUTTON: Magnet = {
  id: 'btn-next',
  type: 'playback-control',
  name: '下一首',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 13,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '⟫',
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
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Next track');
      // TODO: 集成音乐播放器API
    },
  },
};

/**
 * 播放模式按钮（顺序播放、单曲循环、随机播放）
 */
export const PLAYBACK_MODE_BUTTON: Magnet = {
  id: 'btn-mode',
  type: 'playback-control',
  name: '播放模式',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 15,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '↻', // 默认循环播放
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
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Toggle playback mode');
      // TODO: 切换播放模式（顺序 → 单曲循环 → 随机播放）
    },
  },
};

/**
 * 音量控制按钮
 */
export const VOLUME_BUTTON: Magnet = {
  id: 'btn-volume',
  type: 'playback-control',
  name: '音量',
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 17,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '♪', // 音量图标
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
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Toggle volume/mute');
      // TODO: 显示音量滑块或切换静音
    },
  },
};

// ==================== 进度条（水平锚点）====================

/**
 * 播放进度条
 * 水平锚点类型，宽度自适应窗口大小
 */
export const PROGRESS_BAR: Magnet = {
  id: 'progress-bar',
  type: 'progress-bar',
  name: '播放进度条',
  anchorType: 'horizontal',
  anchors: [
    {
      id: 'left',
      gridX: 6, // 左端点
      gridY: 18,
      role: 'anchor',
    },
    {
      id: 'right',
      gridX: 26, // 右端点
      gridY: 18,
      role: 'boundary',
    },
  ],
  content: '', // 进度条内容由React组件渲染
  style: {
    height: '24px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Seek to position');
      // TODO: 根据点击位置跳转播放进度
    },
  },
};

// ==================== 歌曲信息显示（矩形锚点）====================

/**
 * 歌曲信息显示区域
 * 显示当前播放的歌曲封面、标题、艺术家等信息
 */
export const TRACK_INFO: Magnet = {
  id: 'track-info',
  type: 'track-info',
  name: '歌曲信息',
  anchorType: 'rectangular',
  anchors: [
    {
      id: 'top-left',
      gridX: 0,
      gridY: 14,
      role: 'anchor',
    },
    {
      id: 'top-right',
      gridX: 5,
      gridY: 14,
      role: 'boundary',
    },
    {
      id: 'bottom-left',
      gridX: 0,
      gridY: 17,
      role: 'boundary',
    },
    {
      id: 'bottom-right',
      gridX: 5,
      gridY: 17,
      role: 'boundary',
    },
  ],
  content: '', // 内容由React组件渲染
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '8px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    color: '#ffffff',
    fontSize: '12px',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      console.log('Show track details');
      // TODO: 显示歌曲详情弹窗
    },
  },
};

// ==================== 导出所有音乐播放器 Magnet ====================

/**
 * 所有音乐播放器相关的 Magnet 配置
 */
export const MUSIC_PLAYER_MAGNETS: Magnet[] = [
  PREVIOUS_BUTTON,
  PLAY_PAUSE_BUTTON,
  NEXT_BUTTON,
  PLAYBACK_MODE_BUTTON,
  VOLUME_BUTTON,
  PROGRESS_BAR,
  TRACK_INFO,
];
