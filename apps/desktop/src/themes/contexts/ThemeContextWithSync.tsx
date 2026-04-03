import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { broadcastDataUpdate, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  assignThemeBinding,
  isThemeBindingEmpty,
  removeThemeBinding,
  resolveThemeBinding,
  resolveThemeSurfaceTargetId,
} from '../bindings';
import { normalizeTheme } from '../normalizeTheme';
import { DEFAULT_THEME, loadThemeFromStorage } from '../runtimeTheme';
import { assignThemeSurface, isComponentThemeEmpty, removeThemeSurface, resolveThemeSurface } from '../surfaces';
import type { ComponentTheme, Theme, ThemeBinding, ThemeBindingId, ThemeSurfaceId } from '../types/theme';
import type { ThemeImportCandidate } from '../types/themeImport';
const telemetry = getTelemetryLogger('theme', 'ThemeContextWithSync');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ThemeContextValue {
  theme: Theme;
  applyTheme: (theme: ThemeImportCandidate) => Promise<void>;
  getBinding: (bindingId: ThemeBindingId) => ThemeBinding;
  updateBinding: (bindingId: ThemeBindingId, binding: ThemeBinding) => Promise<void>;
  getSurfaceTheme: (surfaceId: ThemeSurfaceId) => ComponentTheme;
  updateSurfaceTheme: (surfaceId: ThemeSurfaceId, surfaceTheme: ComponentTheme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: ThemeImportCandidate;
}

async function saveAndBroadcastTheme(theme: Theme): Promise<void> {
  const normalizedTheme = normalizeTheme(theme);
  try {
    await broadcastDataUpdate(STORAGE_KEYS.THEME_CONFIG, normalizedTheme, TAURI_EVENTS.THEME_UPDATED);
  } catch (error) {
    telemetry.error('theme.save.failed', {
      message: readErrorMessage(error),
      fields: {
        themeId: normalizedTheme.id,
      },
    });
    throw error;
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
