import { Magnet } from '../../types/pixel';
import { WINDOW_CONTROL_MAGNETS } from '../../data/builtin/windowControlMagnets';
import { DRAG_HANDLE_MAGNET } from '../../data/builtin/dragHandleMagnet';
import { WINDOW_PIN_MAGNET } from '../../data/builtin/windowPinMagnet';
import { MUSIC_PLAYER_MAGNETS } from '../../data/builtin/musicPlayerMagnets';
import { EDITOR_BUTTON_MAGNET } from '../../data/builtin/editorMagnet';
import { DEBUG_BUTTON_MAGNET } from '../../data/builtin/debugButtonMagnet';
import { MATRIX_CHANGE_MAGNET } from '../../data/builtin/matrixChangeMagnet';
import { DSP_VST_MAGNET } from '../../data/builtin/dspVstMagnet';
import { NAVIGATION_PAGE_MAGNET } from '../../data/builtin/navigationPageMagnet';
import { BACK_BUTTON_MAGNET } from '../../data/builtin/backButtonMagnet';
import { AUDIO_VISUALIZER_MAGNET } from '../../data/builtin/audioVisualizerMagnet';
import { PROCESS_PERF_MONITOR_MAGNET } from '../../data/builtin/processPerfMonitorMagnet';
import { PLUGIN_DEVELOPMENT_WORKSPACE_MAGNET } from '../../data/builtin/pluginDevelopmentWorkspaceMagnet';
import { DESKTOP_LYRICS_MAGNET } from '../../data/builtin/desktopLyricsMagnet';
import {
  PLATFORM_LOGIN_MAGNET,
  PLATFORM_MAGNET,
} from '../../data/builtin/platformMagnets';
import {
  PLAY_QUEUE_MAGNET,
  PLAYLISTS_MAGNET,
  MUSIC_LIBRARY_MAGNET,
} from '../../data/builtin/musicMagnets';

/**
 * Built-in magnet library (source of truth).
 *
 * App-level code should not manually assemble builtin magnets; import this function instead.
 */
export function createDefaultMagnetLibrary(): Magnet[] {
  return [
    DRAG_HANDLE_MAGNET,
    ...WINDOW_CONTROL_MAGNETS,
    WINDOW_PIN_MAGNET,
    ...MUSIC_PLAYER_MAGNETS,
    DESKTOP_LYRICS_MAGNET,
    AUDIO_VISUALIZER_MAGNET,
    PROCESS_PERF_MONITOR_MAGNET,
    PLUGIN_DEVELOPMENT_WORKSPACE_MAGNET,
    EDITOR_BUTTON_MAGNET,
    DEBUG_BUTTON_MAGNET,
    MATRIX_CHANGE_MAGNET,
    DSP_VST_MAGNET,
    PLAY_QUEUE_MAGNET,
    PLAYLISTS_MAGNET,
    MUSIC_LIBRARY_MAGNET,
    NAVIGATION_PAGE_MAGNET,
    PLATFORM_MAGNET,
    PLATFORM_LOGIN_MAGNET,
    BACK_BUTTON_MAGNET,
  ];
}
