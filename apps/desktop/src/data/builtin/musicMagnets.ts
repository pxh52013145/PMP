/**
 * 音乐相关的内置 Magnet 组件
 * 包括：播放列表、歌单、音乐库
 */

import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createCenteredSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';

const MUSIC_BUTTON_CHROME = createControlChromePreset();
const MUSIC_BUTTON_LAYOUT = createCenteredSingleControlLayoutPreset();

/**
 * 播放列表按钮 Magnet
 * 点击显示当前播放队列
 */
export const PLAY_QUEUE_MAGNET: Magnet = {
  id: 'btn-play-queue',
  type: 'player',
  name: '播放列表',
  renderer: 'btn-play-queue',
  previewText: 'Queue',
  description: '显示当前播放队列',
  anchorType: 'single',
  anchors: [],
  ...MUSIC_BUTTON_LAYOUT,
  content: '☰',
  style: MUSIC_BUTTON_CHROME.style,
  animation: MUSIC_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('打开播放列表');
    },
  },
};

/**
 * 歌单管理按钮 Magnet
 * 点击显示用户保存的歌单列表
 */
export const PLAYLISTS_MAGNET: Magnet = {
  id: 'btn-playlists',
  type: 'player',
  name: '歌单',
  renderer: 'btn-playlists',
  previewText: 'Playlists',
  description: '显示歌单列表',
  anchorType: 'single',
  anchors: [],
  ...MUSIC_BUTTON_LAYOUT,
  content: '♬',
  style: MUSIC_BUTTON_CHROME.style,
  animation: MUSIC_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('打开歌单管理');
    },
  },
};

/**
 * 音乐库按钮 Magnet
 * 点击显示音乐库管理界面
 */
export const MUSIC_LIBRARY_MAGNET: Magnet = {
  id: 'btn-music-library',
  type: 'player',
  name: '音乐库',
  renderer: 'btn-music-library',
  previewText: 'Library',
  description: '进入音乐库管理界面',
  anchorType: 'single',
  anchors: [],
  ...MUSIC_BUTTON_LAYOUT,
  content: '♪',
  style: MUSIC_BUTTON_CHROME.style,
  animation: MUSIC_BUTTON_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('打开音乐库');
    },
  },
};
