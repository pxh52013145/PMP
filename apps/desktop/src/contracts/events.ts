import type { NavigationPageData } from './navigation';

export type AppEvents = {
  'navigation/changed': {
    currentPage: NavigationPageData;
    history: NavigationPageData[];
    currentIndex: number;
  };
  'audio/engineChanged': {
    engineType: 'web' | 'native';
    isNativeAvailable: boolean;
  };
  'audio/stateChanged': unknown;
  'audio/timeUpdated': { time: number };
  'audio/ended': null;
  'audio/error': {
    message: string;
    code?: string;
    engineType: 'web' | 'native';
  };
};
