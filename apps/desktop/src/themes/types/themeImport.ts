import type { ComponentTheme, Theme, ThemeBindingDynamicColorCapability, ThemeBindingMotionSpec } from './theme';

export interface ThemeBindingFragment extends ComponentTheme {
  props?: Record<string, unknown>;
  motion?: ThemeBindingMotionSpec;
  capabilities?: {
    dynamicColor?: ThemeBindingDynamicColorCapability;
  };
}

export type ThemeImportCandidate = Theme;
