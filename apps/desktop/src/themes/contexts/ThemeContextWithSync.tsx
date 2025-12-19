/**
 * 支持窗口间同步的主题系统Context
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { Theme, ComponentTheme } from '../types/theme';
import { Shader } from '../types/shader';
import { DefaultShader } from '../shaders/default';
import { DEFAULT_BACKGROUND_SETTINGS } from '../../constants/defaultBackground';
import { broadcastDataUpdate, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { readJson } from '../../modules/storage';

const LEGACY_COMPONENT_THEME_KEYS: Record<string, string[]> = {
  'btn-play-pause': ['play-pause-button'],
  'btn-previous': ['previous-button'],
  'btn-next': ['next-button'],
  'btn-mode': ['play-mode'],
  'btn-volume': ['volume-control'],
  'btn-back': ['back-button'],
  'btn-debug': ['debug-button'],
  'btn-window-pin': ['window-pin-button'],
  'btn-play-queue': ['play-queue'],
  'btn-playlists': ['playlists-button'],
  'btn-music-library': ['music-library-button'],
};

/**
 * 默认主题
 */
const DEFAULT_THEME: Theme = {
  id: 'theme-default',
  name: '默认主题',
  version: '1.0.0',
  shader: DefaultShader,
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
  // TrackInfo 默认配置
  componentThemes: {
    'track-info': {
      variant: 'spinning-vinyl',
      dynamicColor: {
        extractFromCover: true,
        applyMode: 'full',
      },
    },
  },
};

interface ThemeContextValue {
  theme: Theme;
  shader: Shader;
  applyTheme: (theme: Theme) => void;
  applyShader: (shader: Shader) => void;
  getComponentTheme: (componentId: string) => ComponentTheme;
  updateComponentTheme: (componentId: string, componentTheme: ComponentTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: Theme;
}

/**
 * 从 localStorage 加载主题
 */
function loadThemeFromStorage(): Theme | null {
  return readJson<Theme | null>(STORAGE_KEYS.THEME_CONFIG, null);
}

/**
 * 保存主题到 localStorage 并广播
 */
async function saveAndBroadcastTheme(theme: Theme): Promise<void> {
  try {
    await broadcastDataUpdate(STORAGE_KEYS.THEME_CONFIG, theme, TAURI_EVENTS.THEME_UPDATED);
  } catch (error) {
    console.error('[ThemeContextWithSync] Failed to save theme:', error);
  }
}

/**
 * 主题Provider（支持窗口间同步）
 */
export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  // 初始化时从 localStorage 加载，如果没有则使用默认主题
  const [theme, setTheme] = useState<Theme>(() => {
    return loadThemeFromStorage() || initialTheme || DEFAULT_THEME;
  });

  // 监听其他窗口的主题更新
  useEffect(() => {
    const reloadTheme = () => {
      const updatedTheme = loadThemeFromStorage();
      if (updatedTheme) {
        setTheme(updatedTheme);
      }
    };

    // 设置双重监听（localStorage + Tauri事件）
    const setupListenerAsync = async () => {
      const cleanup = await setupDualListener(
        [STORAGE_KEYS.THEME_CONFIG],
        [TAURI_EVENTS.THEME_UPDATED],
        reloadTheme
      );
      return cleanup;
    };

    let cleanupFn: (() => void) | null = null;
    setupListenerAsync().then((cleanup) => {
      cleanupFn = cleanup;
    });

    return () => {
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, []);

  const applyTheme = useCallback(async (newTheme: Theme) => {
    setTheme(newTheme);
    await saveAndBroadcastTheme(newTheme);
  }, []);

  const applyShader = useCallback(
    async (newShader: Shader) => {
      const newTheme = { ...theme, shader: newShader };
      setTheme(newTheme);
      await saveAndBroadcastTheme(newTheme);
    },
    [theme]
  );

  const getComponentTheme = useCallback(
    (componentId: string): ComponentTheme => {
      const direct = theme.componentThemes?.[componentId];
      if (direct) return direct;

      const legacyKeys = LEGACY_COMPONENT_THEME_KEYS[componentId];
      if (legacyKeys) {
        for (const legacyKey of legacyKeys) {
          const legacyTheme = theme.componentThemes?.[legacyKey];
          if (legacyTheme) return legacyTheme;
        }
      }

      return {};
    },
    [theme]
  );

  const updateComponentTheme = useCallback(
    async (componentId: string, componentTheme: ComponentTheme) => {
      const newTheme = {
        ...theme,
        componentThemes: {
          ...theme.componentThemes,
          [componentId]: componentTheme,
        },
      };
      setTheme(newTheme);
      await saveAndBroadcastTheme(newTheme);
    },
    [theme]
  );

  return (
    <ThemeContext.Provider
      value={{
        theme,
        shader: theme.shader,
        applyTheme,
        applyShader,
        getComponentTheme,
        updateComponentTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 使用主题Hook
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

/**
 * 使用组件主题配置
 */
export function useComponentTheme(componentId: string): ComponentTheme {
  const { getComponentTheme } = useTheme();
  return getComponentTheme(componentId);
}
