import { assignThemeBinding, isThemeBindingEmpty, removeThemeBinding, resolveThemeBinding } from './bindings';
import { mergeComponentThemes } from './mergeComponentTheme';
import { assignThemeSurface, isComponentThemeEmpty, removeThemeSurface, resolveThemeSurface } from './surfaces';
import type {
  ComponentTheme,
  DynamicColorConfig,
  Theme,
  ThemeBinding,
  ThemeBindingDynamicColorCapability,
  ThemeBindingMotionAttentionSpec,
  ThemeBindingMotionSpec,
  ThemeBindingId,
  ThemeMotionReference,
} from './types/theme';
import type { ThemeBindingFragment } from './types/themeImport';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function cloneMotionReference(value: ThemeMotionReference | undefined): ThemeMotionReference | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (isPlainObject(value)) {
    return { ...value };
  }

  return undefined;
}

function cloneDynamicColorCapability(
  value: ThemeBindingDynamicColorCapability | undefined
): ThemeBindingDynamicColorCapability | undefined {
  if (!value) {
    return undefined;
  }

  const next: ThemeBindingDynamicColorCapability = {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(value.source === 'cover' ? { source: value.source } : {}),
    ...(typeof value.mode === 'string' ? { mode: value.mode } : {}),
    ...(typeof value.apply === 'string' ? { apply: value.apply } : {}),
    ...(typeof value.blendRatio === 'number' ? { blendRatio: value.blendRatio } : {}),
    ...(typeof value.gradientAngle === 'number' ? { gradientAngle: value.gradientAngle } : {}),
    ...(typeof value.dynamicSpeed === 'number' ? { dynamicSpeed: value.dynamicSpeed } : {}),
    ...(value.colorAdjust ? { colorAdjust: { ...value.colorAdjust } } : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function cloneBindingMotionSpec(value: ThemeBindingMotionSpec | undefined): ThemeBindingMotionSpec | undefined {
  if (!value) {
    return undefined;
  }

  const next: ThemeBindingMotionSpec = {};
  const presence = value.presence;
  const layout = value.layout;
  const attention = value.attention;
  const visibility = value.visibility;

  if (typeof value.enabled === 'boolean') {
    next.enabled = value.enabled;
  }
  if (value.mode === 'full' || value.mode === 'reduced' || value.mode === 'off') {
    next.mode = value.mode;
  }

  const enter = cloneMotionReference(presence?.enter);
  const exit = cloneMotionReference(presence?.exit);
  if (enter || exit) {
    next.presence = {
      ...(enter ? { enter } : {}),
      ...(exit ? { exit } : {}),
    };
  }

  if (layout) {
    const nextLayout: NonNullable<ThemeBindingMotionSpec['layout']> = {};
    if (
      layout.strategy === 'none' ||
      layout.strategy === 'position' ||
      layout.strategy === 'transform' ||
      layout.strategy === 'flip'
    ) {
      nextLayout.strategy = layout.strategy;
    }
    if (layout.largeChange === 'snap' || layout.largeChange === 'animate') {
      nextLayout.largeChange = layout.largeChange;
    }
    if (typeof layout.sharedKey === 'string' && layout.sharedKey.trim().length > 0) {
      nextLayout.sharedKey = layout.sharedKey.trim();
    }

    const move = cloneMotionReference(layout.move);
    const resize = cloneMotionReference(layout.resize);
    if (move) {
      nextLayout.move = move;
    }
    if (resize) {
      nextLayout.resize = resize;
    }

    if (Object.keys(nextLayout).length > 0) {
      next.layout = nextLayout;
    }
  }

  if (attention) {
    const nextAttention: ThemeBindingMotionAttentionSpec = {};
    const idle = cloneMotionReference(attention.idle);
    const hover = cloneMotionReference(attention.hover);
    const active = cloneMotionReference(attention.active);
    const success = cloneMotionReference(attention.success);
    const warning = cloneMotionReference(attention.warning);

    if (idle) {
      nextAttention.idle = idle;
    }
    if (hover) {
      nextAttention.hover = hover;
    }
    if (active) {
      nextAttention.active = active;
    }
    if (success) {
      nextAttention.success = success;
    }
    if (warning) {
      nextAttention.warning = warning;
    }

    if (Object.keys(nextAttention).length > 0) {
      next.attention = nextAttention;
    }
  }

  if (visibility) {
    const show = cloneMotionReference(visibility.show);
    const hide = cloneMotionReference(visibility.hide);
    if (show || hide) {
      next.visibility = {
        ...(show ? { show } : {}),
        ...(hide ? { hide } : {}),
      };
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function dynamicColorConfigToCapability(
  config: DynamicColorConfig | undefined
): ThemeBindingDynamicColorCapability | undefined {
  if (!config) {
    return undefined;
  }

  const hasExplicitFields =
    typeof config.extractFromCover === 'boolean' ||
    typeof config.effect === 'string' ||
    typeof config.applyMode === 'string' ||
    typeof config.blendRatio === 'number' ||
    typeof config.gradientAngle === 'number' ||
    typeof config.dynamicSpeed === 'number' ||
    Boolean(config.colorAdjust);
  if (!hasExplicitFields) {
    return undefined;
  }

  const capability: ThemeBindingDynamicColorCapability = {
    ...(typeof config.extractFromCover === 'boolean' ? { enabled: config.extractFromCover } : {}),
    source: 'cover',
    ...(typeof config.effect === 'string' ? { mode: config.effect } : {}),
    ...(typeof config.applyMode === 'string' ? { apply: config.applyMode } : {}),
    ...(typeof config.blendRatio === 'number' ? { blendRatio: config.blendRatio } : {}),
    ...(typeof config.gradientAngle === 'number' ? { gradientAngle: config.gradientAngle } : {}),
    ...(typeof config.dynamicSpeed === 'number' ? { dynamicSpeed: config.dynamicSpeed } : {}),
    ...(config.colorAdjust ? { colorAdjust: { ...config.colorAdjust } } : {}),
  };

  return Object.keys(capability).length > 0 ? capability : undefined;
}

export function dynamicColorCapabilityToConfig(
  capability: ThemeBindingDynamicColorCapability | undefined
): DynamicColorConfig | undefined {
  if (!capability) {
    return undefined;
  }

  const config: DynamicColorConfig = {
    ...(typeof capability.enabled === 'boolean' ? { extractFromCover: capability.enabled } : {}),
    ...(typeof capability.mode === 'string' ? { effect: capability.mode } : {}),
    ...(typeof capability.gradientAngle === 'number' ? { gradientAngle: capability.gradientAngle } : {}),
    ...(typeof capability.dynamicSpeed === 'number' ? { dynamicSpeed: capability.dynamicSpeed } : {}),
    ...(typeof capability.apply === 'string' ? { applyMode: capability.apply } : {}),
    ...(typeof capability.blendRatio === 'number' ? { blendRatio: capability.blendRatio } : {}),
    ...(capability.colorAdjust ? { colorAdjust: { ...capability.colorAdjust } } : {}),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

export function bindingFragmentToBinding(fragment: ThemeBindingFragment): ThemeBinding {
  const props = hasOwnKeys(fragment.props) ? fragment.props : undefined;
  const motion = cloneBindingMotionSpec(fragment.motion);
  const dynamicColor = cloneDynamicColorCapability(fragment.capabilities?.dynamicColor);

  return {
    ...(typeof fragment.variant === 'string' ? { variant: fragment.variant } : {}),
    ...(props ? { props: { ...props } } : {}),
    ...(motion ? { motion } : {}),
    ...(dynamicColor
      ? {
          capabilities: {
            dynamicColor,
          },
        }
      : {}),
  };
}

export function bindingToFragment(binding: ThemeBinding): ThemeBindingFragment {
  const props = hasOwnKeys(binding.props) ? binding.props : undefined;
  const motion = cloneBindingMotionSpec(binding.motion);
  const dynamicColor = cloneDynamicColorCapability(binding.capabilities?.dynamicColor);

  return {
    ...(typeof binding.variant === 'string' ? { variant: binding.variant } : {}),
    ...(props ? { props: { ...props } } : {}),
    ...(motion ? { motion } : {}),
    ...(dynamicColor
      ? {
          capabilities: {
            dynamicColor,
          },
        }
      : {}),
  };
}

export function extractBindingFragmentSurfaceDocument(fragment: ThemeBindingFragment): ComponentTheme {
  const { variant, props, motion, capabilities, ...surfaceTheme } = fragment;
  void variant;
  void props;
  void motion;
  void capabilities;
  return surfaceTheme;
}

export function materializeThemeBinding(theme: Theme, bindingId: ThemeBindingId): ThemeBindingFragment {
  const resolvedBinding = resolveThemeBinding(theme, bindingId);
  const surfaceId = resolvedBinding.binding.surface ?? bindingId;
  const surfaceTheme = resolveThemeSurface(theme, surfaceId);
  const bindingTheme = bindingToFragment(resolvedBinding.binding);
  const dynamicColor = cloneDynamicColorCapability(bindingTheme.capabilities?.dynamicColor);
  const motion = cloneBindingMotionSpec(bindingTheme.motion);

  return {
    ...mergeComponentThemes(surfaceTheme, bindingTheme),
    ...(hasOwnKeys(bindingTheme.props) ? { props: { ...bindingTheme.props } } : {}),
    ...(motion ? { motion } : {}),
    ...(dynamicColor
      ? {
          capabilities: {
            dynamicColor,
          },
        }
      : {}),
  };
}

export function assignMagnetBindingFragment(
  theme: Theme,
  componentId: string,
  fragment: ThemeBindingFragment
): Theme {
  const bindingId = `magnet.${componentId}` as ThemeBindingId;
  const currentBinding = resolveThemeBinding(theme, bindingId).binding;
  const nextBinding: ThemeBinding = {
    ...currentBinding,
    ...bindingFragmentToBinding(fragment),
  };
  delete nextBinding.surface;

  const surfaceTheme = extractBindingFragmentSurfaceDocument(fragment);
  const nextTheme = isComponentThemeEmpty(surfaceTheme)
    ? removeThemeSurface(theme, bindingId)
    : assignThemeSurface(theme, bindingId, surfaceTheme);

  return isThemeBindingEmpty(nextBinding)
    ? removeThemeBinding(nextTheme, bindingId)
    : assignThemeBinding(nextTheme, bindingId, nextBinding);
}
