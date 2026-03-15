import type { CSSProperties } from 'react';

import type {
  ComponentTheme,
  DynamicColorConfig,
  Theme,
  ThemeColorTokens,
  ThemeMotionTokens,
  ThemeTypographyTokens,
} from './theme';

export interface ThemeImportSurfaceSpec extends ComponentTheme {
  variantConfig?: Record<string, unknown>;
  dynamicColor?: DynamicColorConfig;
  styleOverride?: {
    container?: CSSProperties;
    cover?: CSSProperties;
    title?: CSSProperties;
    subtitle?: CSSProperties;
    [key: string]: CSSProperties | undefined;
  };
  classNameOverride?: {
    container?: string;
    cover?: string;
    title?: string;
    subtitle?: string;
    [key: string]: string | undefined;
  };
}

export interface ThemeImportCandidate extends Omit<Theme, 'surfaces'> {
  colors?: ThemeColorTokens;
  motion?: ThemeMotionTokens;
  typography?: ThemeTypographyTokens;
  surfaces?: Record<string, ThemeImportSurfaceSpec>;
  componentThemes?: Record<string, ThemeImportSurfaceSpec>;
  shader?: unknown;
}
