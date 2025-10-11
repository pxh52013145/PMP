/**
 * 内置 Magnet 配置统一导出
 */

export { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
export { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
export { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
export { EDITOR_BUTTON_MAGNET } from './editorMagnet';

import { WINDOW_CONTROL_MAGNETS } from './windowControlMagnets';
import { DRAG_HANDLE_MAGNET } from './dragHandleMagnet';
import { MUSIC_PLAYER_MAGNETS } from './musicPlayerMagnets';
import { EDITOR_BUTTON_MAGNET } from './editorMagnet';
import { Magnet } from '../../types/pixel';

/**
 * 所有内置 Magnet 列表
 */
export const ALL_BUILTIN_MAGNETS: Magnet[] = [
  ...WINDOW_CONTROL_MAGNETS,
  DRAG_HANDLE_MAGNET,
  ...MUSIC_PLAYER_MAGNETS,
  EDITOR_BUTTON_MAGNET,
];

/**
 * 内置 Magnet ID 集合（用于快速查找）
 */
export const BUILTIN_MAGNET_IDS = new Set<string>(ALL_BUILTIN_MAGNETS.map((m) => m.id));
