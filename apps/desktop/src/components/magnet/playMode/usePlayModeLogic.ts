/**
 * PlayModeButton 逻辑层 Hook
 * 负责播放模式切换逻辑
 */

import { PlayMode } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export const PLAY_MODE_CONFIG: Record<PlayMode, { icon: string; text: string; next: PlayMode }> = {
  sequence: { icon: '→', text: '顺序播放', next: 'loop' },
  loop: { icon: '↻', text: '列表循环', next: 'single-loop' },
  'single-loop': { icon: '⟲', text: '单曲循环', next: 'shuffle' },
  shuffle: { icon: '⧢', text: '随机播放', next: 'sequence' },
};

export interface PlayModeLogic {
  cyclePlayMode: (currentMode: PlayMode) => void;
  getNextMode: (currentMode: PlayMode) => PlayMode;
  getModeConfig: (mode: PlayMode) => { icon: string; text: string };
}

/**
 * PlayModeButton的逻辑层
 */
export function usePlayModeLogic(): PlayModeLogic {
  const audioService = useAudioService();
  const cyclePlayMode = (currentMode: PlayMode) => {
    const nextMode = PLAY_MODE_CONFIG[currentMode].next;
    audioService.setPlayMode(nextMode);
  };

  const getNextMode = (currentMode: PlayMode): PlayMode => {
    return PLAY_MODE_CONFIG[currentMode].next;
  };

  const getModeConfig = (mode: PlayMode) => {
    const config = PLAY_MODE_CONFIG[mode];
    return {
      icon: config.icon,
      text: config.text,
    };
  };

  return {
    cyclePlayMode,
    getNextMode,
    getModeConfig,
  };
}
