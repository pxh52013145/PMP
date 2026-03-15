import type { BackgroundConfig } from '../../types/background';

export type DynamicColorEffect = 'tone' | 'gradient' | 'dynamic';
export type ThemeSurfaceNamespace = 'magnet' | 'page' | 'overlay' | 'primitive';
export type ThemeBindingNamespace = ThemeSurfaceNamespace;
export type ThemeSurfaceId = `${ThemeSurfaceNamespace}.${string}` | string;
export type ThemeBindingId = `${ThemeBindingNamespace}.${string}`;

export type ThemeColorTokens = Record<string, string>;
export type ThemeMotionTokens = Record<string, string | number | boolean>;
export type ThemeTypographyTokens = Record<string, string | number>;
export type ThemeRadiusTokens = Record<string, string | number>;
export type ThemeSpaceTokens = Record<string, string | number>;
export type ThemeSizeTokens = Record<string, string | number>;
export type ThemeShadowTokens = Record<string, string>;
export type ThemeBorderTokens = Record<string, string | number>;
export type ThemeTokenPrimitive = string | number | boolean;
export type ThemeTokenReference = `{${string}}`;
export type ThemeTokenAssignments = Record<string, ThemeTokenPrimitive>;
export type ThemeMotionValue = string | number;

export interface ThemeMotionChannelSpec {
  preset?: string;
  duration?: ThemeMotionValue;
  easing?: ThemeMotionValue;
  delay?: ThemeMotionValue;
  iterationCount?: number | 'infinite';
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
  playState?: 'running' | 'paused';
  distance?: ThemeMotionValue;
  scale?: number;
  origin?: string;
}

export type ThemeMotionChannelMap = Record<string, ThemeMotionChannelSpec>;

export interface DynamicColorConfig {
  extractFromCover?: boolean;
  effect?: DynamicColorEffect;
  gradientAngle?: number;
  dynamicSpeed?: number;
  applyMode?: 'full' | 'glow-only' | 'blend' | 'none';
  blendRatio?: number;
  colorAdjust?: {
    saturation?: number;
    brightness?: number;
    hueShift?: number;
  };
}

export interface ThemeBindingDynamicColorCapability {
  enabled?: boolean;
  source?: 'cover';
  mode?: DynamicColorEffect;
  apply?: 'full' | 'glow-only' | 'blend' | 'none';
  blendRatio?: number;
  gradientAngle?: number;
  dynamicSpeed?: number;
  colorAdjust?: DynamicColorConfig['colorAdjust'];
}

export interface ThemeBindingMotionLayoutPolicy {
  strategy?: 'none' | 'position' | 'transform' | 'flip';
  largeChange?: 'snap' | 'animate';
  sharedKey?: string;
}

export interface ThemeBindingMotionCapability {
  enabled?: boolean;
  mode?: 'full' | 'reduced' | 'off';
  layout?: ThemeBindingMotionLayoutPolicy;
  channels?: ThemeMotionChannelMap;
}

export interface ThemeBindingCapabilities {
  dynamicColor?: ThemeBindingDynamicColorCapability;
  motion?: ThemeBindingMotionCapability;
}

export interface ThemeBinding {
  surface?: ThemeSurfaceId;
  renderer?: string;
  variant?: string;
  props?: Record<string, unknown>;
  capabilities?: ThemeBindingCapabilities;
}

export interface ThemeTokens {
  color?: ThemeColorTokens;
  motion?: ThemeMotionTokens;
  typography?: ThemeTypographyTokens;
  radius?: ThemeRadiusTokens;
  space?: ThemeSpaceTokens;
  size?: ThemeSizeTokens;
  shadow?: ThemeShadowTokens;
  border?: ThemeBorderTokens;
}

export interface ThemePartStateSpec {
  classes?: string[];
  style?: Record<string, unknown>;
  tokens?: ThemeTokenAssignments;
  motion?: ThemeMotionChannelMap;
}

export interface ThemeSurfacePartSpec extends ThemePartStateSpec {
  states?: Record<string, ThemePartStateSpec>;
}

export interface ThemeSurfaceStateSpec extends ThemePartStateSpec {
  parts?: Record<string, ThemePartStateSpec>;
}

export interface ComponentTheme {
  extends?: ThemeSurfaceId;
  variant?: string;
  tokens?: ThemeTokenAssignments;
  parts?: Record<string, ThemeSurfacePartSpec>;
  states?: Record<string, ThemeSurfaceStateSpec>;
  metadata?: {
    description?: string;
  };
}

export interface Theme {
  id: string;
  name: string;
  author?: string;
  version: string;
  description?: string;
  thumbnail?: string;

  tokens?: ThemeTokens;

  pixel: {
    shape: 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';
    size: number;
    opacity: number;
    colors: {
      default: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; alpha?: number };
      hover: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; state?: 'hover' };
      active: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; state?: 'active' };
      occupied: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; alpha?: number };
    };
  };

  background: {
    maximized: BackgroundConfig;
    windowed: BackgroundConfig;
  };

  fonts: {
    primary: string;
    secondary?: string;
    mono?: string;
  };

  globalEffects?: {
    blur?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };

  surfaces?: Record<string, ComponentTheme>;
  bindings?: Record<string, ThemeBinding>;
}
