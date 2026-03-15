import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_BACKGROUND_SETTINGS } from '../../constants/defaultBackground';
import { readJson } from '../../modules/storage';
import { broadcastDataUpdate, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  assignThemeBinding,
  isThemeBindingEmpty,
  removeThemeBinding,
  resolveThemeBinding,
  resolveThemeSurfaceTargetId,
} from '../bindings';
import { normalizeTheme } from '../normalizeTheme';
import { assignThemeSurface, isComponentThemeEmpty, removeThemeSurface, resolveThemeSurface } from '../surfaces';
import type { ComponentTheme, Theme, ThemeBinding, ThemeBindingId, ThemeSurfaceId } from '../types/theme';
import type { ThemeImportCandidate } from '../types/themeImport';

const DEFAULT_THEME: Theme = {
  id: 'theme-default',
  name: '榛樿涓婚',
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

interface ThemeContextValue {
  theme: Theme;
  applyTheme: (theme: ThemeImportCandidate) => void;
  getBinding: (bindingId: ThemeBindingId) => ThemeBinding;
  updateBinding: (bindingId: ThemeBindingId, binding: ThemeBinding) => void;
  getSurfaceTheme: (surfaceId: ThemeSurfaceId) => ComponentTheme;
  updateSurfaceTheme: (surfaceId: ThemeSurfaceId, surfaceTheme: ComponentTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: ThemeImportCandidate;
}

function loadThemeFromStorage(): Theme | null {
  const theme = readJson<ThemeImportCandidate | null>(STORAGE_KEYS.THEME_CONFIG, null);
  return theme ? normalizeTheme(theme) : null;
}

async function saveAndBroadcastTheme(theme: Theme): Promise<void> {
  const normalizedTheme = normalizeTheme(theme);
  try {
    await broadcastDataUpdate(STORAGE_KEYS.THEME_CONFIG, normalizedTheme, TAURI_EVENTS.THEME_UPDATED);
  } catch (error) {
    console.error('[ThemeContextWithSync] Failed to save theme:', error);
  }
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    return loadThemeFromStorage() || (initialTheme ? normalizeTheme(initialTheme) : null) || DEFAULT_THEME;
  });

  useEffect(() => {
    const reloadTheme = () => {
      const updatedTheme = loadThemeFromStorage();
      if (updatedTheme) {
        setTheme(updatedTheme);
      }
    };

    const setupListenerAsync = async () => {
      return await setupDualListener([STORAGE_KEYS.THEME_CONFIG], [TAURI_EVENTS.THEME_UPDATED], reloadTheme);
    };

    let cleanupFn: (() => void) | null = null;
    setupListenerAsync().then((cleanup) => {
      cleanupFn = cleanup;
    });

    return () => {
      cleanupFn?.();
    };
  }, []);

  const applyTheme = useCallback(async (newTheme: ThemeImportCandidate) => {
    const normalizedTheme = normalizeTheme(newTheme);
    setTheme(normalizedTheme);
    await saveAndBroadcastTheme(normalizedTheme);
  }, []);

  const getBinding = useCallback(
    (bindingId: ThemeBindingId): ThemeBinding => resolveThemeBinding(theme, bindingId).binding,
    [theme]
  );

  const updateBinding = useCallback(
    async (bindingId: ThemeBindingId, binding: ThemeBinding) => {
      const nextTheme = isThemeBindingEmpty(binding)
        ? removeThemeBinding(theme, bindingId)
        : assignThemeBinding(theme, bindingId, binding);
      const newTheme = normalizeTheme(nextTheme);
      setTheme(newTheme);
      await saveAndBroadcastTheme(newTheme);
    },
    [theme]
  );

  const getSurfaceTheme = useCallback(
    (surfaceId: ThemeSurfaceId): ComponentTheme => {
      const targetSurfaceId =
        resolveThemeSurfaceTargetId(theme, surfaceId) ?? resolveThemeBinding(theme, surfaceId as ThemeBindingId).binding.surface;
      return targetSurfaceId ? resolveThemeSurface(theme, targetSurfaceId) : {};
    },
    [theme]
  );

  const updateSurfaceTheme = useCallback(
    async (surfaceId: ThemeSurfaceId, surfaceTheme: ComponentTheme) => {
      const nextTheme = isComponentThemeEmpty(surfaceTheme)
        ? removeThemeSurface(theme, surfaceId)
        : assignThemeSurface(theme, surfaceId, surfaceTheme);
      const newTheme = normalizeTheme(nextTheme);
      setTheme(newTheme);
      await saveAndBroadcastTheme(newTheme);
    },
    [theme]
  );

  return (
    <ThemeContext.Provider
      value={{
        theme,
        applyTheme,
        getBinding,
        updateBinding,
        getSurfaceTheme,
        updateSurfaceTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export function useThemeBinding(bindingId: ThemeBindingId): ThemeBinding {
  const { getBinding } = useTheme();
  return getBinding(bindingId);
}
