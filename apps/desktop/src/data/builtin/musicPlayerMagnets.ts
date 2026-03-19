import { Magnet } from '../../types/pixel';
import { createControlChromePreset, createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  createCenteredSingleControlLayoutPreset,
  createPanelLayoutPreset,
} from '../../modules/magnets/layoutPresets';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const PLAYER_CONTROL_CHROME = createControlChromePreset();
const PRIMARY_PLAYER_CONTROL_CHROME = createControlChromePreset({
  style: {
    backgroundColor: 'rgba(0, 123, 255, 0.8)',
    border: '2px solid rgba(255, 255, 255, 0.2)',
  },
  hoverStyle: {
    backgroundColor: 'rgba(0, 123, 255, 1)',
    boxShadow: '0 4px 8px rgba(0, 123, 255, 0.3)',
  },
});
const PROGRESS_BAR_CHROME = createPanelChromePreset({
  style: {
    height: '24px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  hoverStyle: {
    backgroundColor: 'rgba(18, 22, 30, 0.92)',
    border: '1px solid rgba(0, 212, 255, 0.22)',
    boxShadow: '0 0 12px rgba(0, 212, 255, 0.12)',
  },
});
const TRACK_INFO_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    color: '#ffffff',
    fontSize: '12px',
  },
  hoverStyle: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
});
const PLAYER_CONTROL_LAYOUT = createCenteredSingleControlLayoutPreset();
const PROGRESS_BAR_LAYOUT = createPanelLayoutPreset();
const TRACK_INFO_LAYOUT = createPanelLayoutPreset();
const telemetry = getTelemetryLogger('magnets', 'musicPlayerMagnets');

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
  renderer: 'btn-previous',
  previewText: 'Prev',
  anchorType: 'single',
  anchors: [],
  ...PLAYER_CONTROL_LAYOUT,
  content: '⟪',
  style: PLAYER_CONTROL_CHROME.style,
  animation: PLAYER_CONTROL_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.previous.clicked');
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
  renderer: 'btn-play-pause',
  previewText: 'Play/Pause',
  anchorType: 'single',
  anchors: [],
  ...PLAYER_CONTROL_LAYOUT,
  content: '▶', // 默认显示播放
  style: PRIMARY_PLAYER_CONTROL_CHROME.style,
  animation: PRIMARY_PLAYER_CONTROL_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.play_pause.clicked');
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
  renderer: 'btn-next',
  previewText: 'Next',
  anchorType: 'single',
  anchors: [],
  ...PLAYER_CONTROL_LAYOUT,
  content: '⟫',
  style: PLAYER_CONTROL_CHROME.style,
  animation: PLAYER_CONTROL_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.next.clicked');
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
  renderer: 'btn-mode',
  previewText: 'Mode',
  anchorType: 'single',
  anchors: [],
  ...PLAYER_CONTROL_LAYOUT,
  content: '↻', // 默认循环播放
  style: PLAYER_CONTROL_CHROME.style,
  animation: PLAYER_CONTROL_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.playback_mode.clicked');
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
  renderer: 'btn-volume',
  previewText: 'Volume',
  anchorType: 'single',
  anchors: [],
  ...PLAYER_CONTROL_LAYOUT,
  content: '♪', // 音量图标
  style: PLAYER_CONTROL_CHROME.style,
  animation: PLAYER_CONTROL_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.volume.clicked');
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
  anchors: [],
  ...PROGRESS_BAR_LAYOUT,
  gridFootprint: { width: 27, height: 1 },
  content: '', // 进度条内容由React组件渲染
  style: PROGRESS_BAR_CHROME.style,
  animation: PROGRESS_BAR_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.progress.clicked');
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
  anchors: [],
  ...TRACK_INFO_LAYOUT,
  gridFootprint: { width: 6, height: 4 },
  content: '', // 内容由React组件渲染
  style: TRACK_INFO_CHROME.style,
  animation: TRACK_INFO_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
    onClick: () => {
      telemetry.debug('music_player.track_info.clicked');
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
