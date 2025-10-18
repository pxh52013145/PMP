/**
 * 内置 Magnet 配置统一导出
 */

export { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
export { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
export { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
export { EDITOR_BUTTON_MAGNET } from './editorMagnet';
export { MUSIC_PLAYER_SIMULATOR } from './musicPlayerSimulator';
export { PLAY_QUEUE_MAGNET, PLAYLISTS_MAGNET, MUSIC_LIBRARY_MAGNET } from './musicMagnets';

import { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
import { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
import { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
import { EDITOR_BUTTON_MAGNET } from './editorMagnet';
import { MUSIC_PLAYER_SIMULATOR } from './musicPlayerSimulator';
import { PLAY_QUEUE_MAGNET, PLAYLISTS_MAGNET, MUSIC_LIBRARY_MAGNET } from './musicMagnets';
import { Magnet } from '../../types/pixel';

/**
 * 所有内置 Magnet 列表
 */
export const ALL_BUILTIN_MAGNETS: Magnet[] = [
  ...WINDOW_CONTROL_MAGNETS,
  DRAG_HANDLE_MAGNET,
  ...MUSIC_PLAYER_MAGNETS,
  EDITOR_BUTTON_MAGNET,
  PLAY_QUEUE_MAGNET,
  PLAYLISTS_MAGNET,
  MUSIC_LIBRARY_MAGNET,
  MUSIC_PLAYER_SIMULATOR,
];

/**
 * 内置 Magnet ID 集合（用于快速查找）
 * ⚠️ 已废弃：请使用 constants/magnets.ts 中的 BUILTIN_MAGNET_IDS
 * @deprecated Use BUILTIN_MAGNET_IDS from constants/magnets.ts instead
 */
export const BUILTIN_MAGNET_IDS = new Set<string>(ALL_BUILTIN_MAGNETS.map((m) => m.id));
