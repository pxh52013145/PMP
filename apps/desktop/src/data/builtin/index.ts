/**
 * 内置 Magnet 配置统一导出
 */

export { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
export { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
export { WINDOW_PIN_MAGNET } from './windowPinMagnet';
export { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
export { EDITOR_BUTTON_MAGNET } from './editorMagnet';
export { PLAY_QUEUE_MAGNET, PLAYLISTS_MAGNET, MUSIC_LIBRARY_MAGNET } from './musicMagnets';
export { NAVIGATION_PAGE_MAGNET } from './navigationPageMagnet';
export { BACK_BUTTON_MAGNET } from './backButtonMagnet';
export { DEBUG_BUTTON_MAGNET } from './debugButtonMagnet';
export { AUDIO_VISUALIZER_MAGNET } from './audioVisualizerMagnet';
export { MATRIX_CHANGE_MAGNET } from './matrixChangeMagnet';
export { PROCESS_PERF_MONITOR_MAGNET } from './processPerfMonitorMagnet';
export { PLATFORM_MAGNET, PLATFORM_LOGIN_MAGNET } from './platformMagnets';

import { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
import { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
import { WINDOW_PIN_MAGNET } from './windowPinMagnet';
import { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
import { EDITOR_BUTTON_MAGNET } from './editorMagnet';
import { PLAY_QUEUE_MAGNET, PLAYLISTS_MAGNET, MUSIC_LIBRARY_MAGNET } from './musicMagnets';
import { NAVIGATION_PAGE_MAGNET } from './navigationPageMagnet';
import { BACK_BUTTON_MAGNET } from './backButtonMagnet';
import { DEBUG_BUTTON_MAGNET } from './debugButtonMagnet';
import { AUDIO_VISUALIZER_MAGNET } from './audioVisualizerMagnet';
import { MATRIX_CHANGE_MAGNET } from './matrixChangeMagnet';
import { PROCESS_PERF_MONITOR_MAGNET } from './processPerfMonitorMagnet';
import { PLATFORM_MAGNET, PLATFORM_LOGIN_MAGNET } from './platformMagnets';
import { Magnet } from '../../types/pixel';

/**
 * 所有内置 Magnet 列表
 */
export const ALL_BUILTIN_MAGNETS: Magnet[] = [
  ...WINDOW_CONTROL_MAGNETS,
  DRAG_HANDLE_MAGNET,
  WINDOW_PIN_MAGNET,
  ...MUSIC_PLAYER_MAGNETS,
  EDITOR_BUTTON_MAGNET,
  DEBUG_BUTTON_MAGNET,
  MATRIX_CHANGE_MAGNET,
  AUDIO_VISUALIZER_MAGNET,
  PROCESS_PERF_MONITOR_MAGNET,
  PLAY_QUEUE_MAGNET,
  PLAYLISTS_MAGNET,
  MUSIC_LIBRARY_MAGNET,
  NAVIGATION_PAGE_MAGNET,
  PLATFORM_MAGNET,
  PLATFORM_LOGIN_MAGNET,
  BACK_BUTTON_MAGNET,
];

/**
 * 内置 Magnet ID 集合（用于快速查找）
 * ⚠️ 已废弃：请使用 constants/magnets.ts 中的 BUILTIN_MAGNET_IDS
 * @deprecated Use BUILTIN_MAGNET_IDS from constants/magnets.ts instead
 */
export const BUILTIN_MAGNET_IDS = new Set<string>(ALL_BUILTIN_MAGNETS.map((m) => m.id));
