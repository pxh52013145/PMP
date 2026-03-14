import { mergeComponentThemes } from './mergeComponentTheme';
import { assignThemeSurface } from './surfaces';
import type {
  ComponentTheme,
  DynamicColorConfig,
  Theme,
  ThemeBinding,
  ThemeBindingDynamicColorCapability,
  ThemeBindingId,
} from './types/theme';

export type ResolvedThemeBindingSource = 'binding' | 'surface' | 'none';

export interface ResolvedThemeBinding {
  id: ThemeBindingId;
  binding: ThemeBinding;
  source: ResolvedThemeBindingSource;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dynamicColorConfigToCapability(
  config: DynamicColorConfig | undefined
): ThemeBindingDynamicColorCapability | undefined {
  if (!config) {
    return undefined;
  }

  return {
    enabled: config.extractFromCover,
    source: 'cover',
    mode: config.effect,
    apply: config.applyMode,
    blendRatio: config.blendRatio,
    gradientAngle: config.gradientAngle,
    dynamicSpeed: config.dynamicSpeed,
    colorAdjust: config.colorAdjust ? { ...config.colorAdjust } : undefined,
  };
}

function dynamicColorCapabilityToConfig(
  capability: ThemeBindingDynamicColorCapability | undefined
): DynamicColorConfig | undefined {
  if (!capability) {
    return undefined;
  }

  return {
    extractFromCover: capability.enabled,
    effect: capability.mode,
    gradientAngle: capability.gradientAngle,
    dynamicSpeed: capability.dynamicSpeed,
    applyMode: capability.apply,
    blendRatio: capability.blendRatio,
    colorAdjust: capability.colorAdjust ? { ...capability.colorAdjust } : undefined,
  };
}

export function componentThemeToBinding(bindingId: ThemeBindingId, componentTheme: ComponentTheme): ThemeBinding {
  return {
    surface: bindingId,
    ...(typeof componentTheme.variant === 'string' ? { variant: componentTheme.variant } : {}),
    ...(isPlainObject(componentTheme.variantConfig) ? { props: componentTheme.variantConfig } : {}),
    ...(componentTheme.dynamicColor
      ? {
          capabilities: {
            dynamicColor: dynamicColorConfigToCapability(componentTheme.dynamicColor),
          },
        }
      : {}),
  };
}

export function bindingToComponentTheme(binding: ThemeBinding): ComponentTheme {
  const dynamicColor = dynamicColorCapabilityToConfig(binding.capabilities?.dynamicColor);
  const props = isPlainObject(binding.props) ? binding.props : undefined;

  return {
    ...(typeof binding.variant === 'string' ? { variant: binding.variant } : {}),
    ...(props ? { variantConfig: props } : {}),
    ...(dynamicColor ? { dynamicColor } : {}),
  };
}

export function resolveThemeBinding(theme: Theme, bindingId: ThemeBindingId): ResolvedThemeBinding {
  const directBinding = theme.bindings?.[bindingId];
  if (directBinding) {
    return {
      id: bindingId,
      binding: directBinding,
      source: 'binding',
    };
  }

  if (theme.surfaces?.[bindingId]) {
    return {
      id: bindingId,
      binding: { surface: bindingId },
      source: 'surface',
    };
  }

  return {
    id: bindingId,
    binding: {},
    source: 'none',
  };
}

export function materializeThemeBinding(theme: Theme, bindingId: ThemeBindingId): ComponentTheme {
  const resolvedBinding = resolveThemeBinding(theme, bindingId);
  const surfaceId = resolvedBinding.binding.surface;
  const surfaceTheme = surfaceId ? theme.surfaces?.[surfaceId] ?? {} : {};
  const bindingTheme = bindingToComponentTheme(resolvedBinding.binding);

  return mergeComponentThemes(surfaceTheme, bindingTheme);
}

export function assignThemeBinding(theme: Theme, bindingId: ThemeBindingId, binding: ThemeBinding): Theme {
  return {
    ...theme,
    bindings: {
      ...theme.bindings,
      [bindingId]: binding,
    },
  };
}

export function assignMagnetComponentTheme(theme: Theme, componentId: string, componentTheme: ComponentTheme): Theme {
  const bindingId = `magnet.${componentId}` as ThemeBindingId;
  const currentBinding = resolveThemeBinding(theme, bindingId).binding;
  const nextTheme = assignThemeSurface(theme, bindingId, componentTheme);

  return assignThemeBinding(nextTheme, bindingId, {
    surface: bindingId,
    ...(currentBinding.renderer ? { renderer: currentBinding.renderer } : {}),
  });
}

export function isThemeBindingEmpty(binding: ThemeBinding | null | undefined): boolean {
  if (!binding) {
    return true;
  }

  return !binding.surface && !binding.renderer && !binding.variant && !binding.props && !binding.capabilities;
}

export function removeThemeBinding(theme: Theme, bindingId: ThemeBindingId): Theme {
  if (!theme.bindings?.[bindingId]) {
    return theme;
  }

  const nextBindings = { ...theme.bindings };
  delete nextBindings[bindingId];

  return {
    ...theme,
    ...(Object.keys(nextBindings).length > 0 ? { bindings: nextBindings } : { bindings: undefined }),
  };
}
