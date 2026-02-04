import type { NavigationPageData } from './navigation';
import type { AudioState } from '../services/audio';
import type { KeybindingsSnapshot } from '../services/keybindings/types';
import type { MemoryGovernanceRunResult } from './memoryGovernance';

export type AppEvents = {
  'navigation/changed': {
    currentPage: NavigationPageData;
    history: NavigationPageData[];
    currentIndex: number;
  };
  'memory-governance/ran': MemoryGovernanceRunResult;
  'keybindings/changed': KeybindingsSnapshot;
  'ui/commandPaletteToggleRequested': null;
  'ui/commandPaletteCloseRequested': null;
  'audio/engineChanged': {
    engineType: 'native';
    isNativeAvailable: boolean;
  };
  'audio/stateChanged': AudioState;
  'audio/timeUpdated': { time: number };
  'audio/ended': null;
  'audio/error': {
    message: string;
    code?: string;
    engineType: 'native';
  };
};
