import { DEFAULT_BACKGROUND_SETTINGS } from '../constants/defaultBackground';
import { readJson } from '../modules/storage';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { DEFAULT_THEME_MOTION } from './motion';
import { normalizeTheme } from './normalizeTheme';
import type { Theme } from './types/theme';
import type { ThemeImportCandidate } from './types/themeImport';

export const DEFAULT_THEME: Theme = {
  id: 'theme-default',
  name: '默认主题',
  version: '1.0.0',
  pixel: {
    shape: 'circle',
    size: 1.0,
    opacity: 1.0,
    colors: {
      default: { slot: 'primary', alpha: 0.6 },
      hover: { slot: 'accent', state: 'hover' },
      active: { slot: 'primary', state: 'active' },
      occupied: { slot: 'secondary', alpha: 0.3 },
    },
  },
  background: DEFAULT_BACKGROUND_SETTINGS,
  fonts: {
    primary: 'Inter, sans-serif',
  },
  motion: DEFAULT_THEME_MOTION,
  bindings: {
    'magnet.track-info': {
      variant: 'spinning-vinyl',
      capabilities: {
        dynamicColor: {
          enabled: true,
          source: 'cover',
          apply: 'full',
        },
      },
    },
  },
};

export function loadThemeFromStorage(): Theme | null {
  const theme = readJson<ThemeImportCandidate | null>(STORAGE_KEYS.THEME_CONFIG, null);
  if (!theme) {
    return null;
  }

  try {
    return normalizeTheme(theme);
  } catch {
    return null;
  }
}

export function getStoredOrDefaultTheme(): Theme {
  return loadThemeFromStorage() ?? DEFAULT_THEME;
}
