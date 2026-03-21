import { isThemeBindingEmpty } from './bindings';
import { isComponentThemeEmpty } from './surfaces';
import type {
  ComponentTheme,
  Theme,
  ThemeBinding,
  ThemeBindingMotionAttentionSpec,
  ThemeBindingMotionSpec,
  ThemeMotionChannelMap,
  ThemeMotionChannelSpec,
  ThemeMotionSceneSpec,
  ThemeMotionDocument,
  ThemeMotionReference,
  ThemePartStateSpec,
  ThemeSurfacePartSpec,
  ThemeSurfaceStateSpec,
  ThemeTokenAssignments,
  ThemeTokens,
} from './types/theme';
import type { ThemeImportCandidate } from './types/themeImport';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function cloneMotionChannels(value: ThemeMotionChannelMap | undefined): ThemeMotionChannelMap | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const channels: ThemeMotionChannelMap = {};
  for (const [channelName, channelSpec] of Object.entries(value)) {
    if (isPlainObject(channelSpec)) {
      channels[channelName] = { ...channelSpec };
    }
  }

  return Object.keys(channels).length > 0 ? channels : undefined;
}

function cloneThemeBindingMotionSpec(value: ThemeBindingMotionSpec | undefined): ThemeBindingMotionSpec | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const next: ThemeBindingMotionSpec = {};
  const presence = isPlainObject(value.presence)
    ? (value.presence as Record<string, ThemeMotionReference | undefined>)
    : undefined;
  const layout = isPlainObject(value.layout)
    ? (value.layout as Record<string, unknown> & {
        move?: ThemeMotionReference;
        resize?: ThemeMotionReference;
      })
    : undefined;
  const attention = isPlainObject(value.attention)
    ? (value.attention as Record<string, ThemeMotionReference | undefined>)
    : undefined;
  const visibility = isPlainObject(value.visibility)
    ? (value.visibility as Record<string, ThemeMotionReference | undefined>)
    : undefined;

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

    if (idle) nextAttention.idle = idle;
    if (hover) nextAttention.hover = hover;
    if (active) nextAttention.active = active;
    if (success) nextAttention.success = success;
    if (warning) nextAttention.warning = warning;

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

function normalizeThemePartStateSpec(value: unknown): ThemePartStateSpec | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const next: ThemePartStateSpec = {};
  if (Array.isArray(value.classes)) {
    const classes = value.classes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (classes.length > 0) {
      next.classes = [...new Set(classes)];
    }
  }
  if (isPlainObject(value.style)) {
    next.style = { ...value.style };
  }
  if (isPlainObject(value.tokens)) {
    next.tokens = { ...value.tokens } as ThemeTokenAssignments;
  }
  const motion = cloneMotionChannels(value.motion as ThemeMotionChannelMap | undefined);
  if (motion) {
    next.motion = motion;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeThemeSurfacePartSpec(value: unknown): ThemeSurfacePartSpec | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const next: ThemeSurfacePartSpec = {
    ...(normalizeThemePartStateSpec(value) ?? {}),
  };

  if (isPlainObject(value.states)) {
    const states = Object.fromEntries(
      Object.entries(value.states)
        .map(([stateName, stateValue]) => [stateName, normalizeThemePartStateSpec(stateValue)])
        .filter((entry): entry is [string, ThemePartStateSpec] => Boolean(entry[1]))
    );
    if (Object.keys(states).length > 0) {
      next.states = states;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeThemeSurfaceStateSpec(value: unknown): ThemeSurfaceStateSpec | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const next: ThemeSurfaceStateSpec = {
    ...(normalizeThemePartStateSpec(value) ?? {}),
  };

  if (isPlainObject(value.parts)) {
    const parts = Object.fromEntries(
      Object.entries(value.parts)
        .map(([partName, partValue]) => [partName, normalizeThemePartStateSpec(partValue)])
        .filter((entry): entry is [string, ThemePartStateSpec] => Boolean(entry[1]))
    );
    if (Object.keys(parts).length > 0) {
      next.parts = parts;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeComponentTheme(value: unknown): ComponentTheme {
  if (!isPlainObject(value)) {
    return {};
  }

  const next: ComponentTheme = {};

  if (typeof value.extends === 'string' && value.extends.trim().length > 0) {
    next.extends = value.extends.trim();
  }
  if (typeof value.variant === 'string' && value.variant.trim().length > 0) {
    next.variant = value.variant.trim();
  }
  if (isPlainObject(value.tokens)) {
    next.tokens = { ...value.tokens } as ThemeTokenAssignments;
  }
  if (isPlainObject(value.parts)) {
    const parts = Object.fromEntries(
      Object.entries(value.parts)
        .map(([partName, partValue]) => [partName, normalizeThemeSurfacePartSpec(partValue)])
        .filter((entry): entry is [string, ThemeSurfacePartSpec] => Boolean(entry[1]))
    );
    if (Object.keys(parts).length > 0) {
      next.parts = parts;
    }
  }
  if (isPlainObject(value.states)) {
    const states = Object.fromEntries(
      Object.entries(value.states)
        .map(([stateName, stateValue]) => [stateName, normalizeThemeSurfaceStateSpec(stateValue)])
        .filter((entry): entry is [string, ThemeSurfaceStateSpec] => Boolean(entry[1]))
    );
    if (Object.keys(states).length > 0) {
      next.states = states;
    }
  }
  if (isPlainObject(value.metadata) && typeof value.metadata.description === 'string') {
    next.metadata = { description: value.metadata.description };
  }

  return next;
}

function normalizeThemeTokens(tokens: ThemeTokens | undefined): ThemeTokens | undefined {
  if (!isPlainObject(tokens)) {
    return undefined;
  }

  const next: ThemeTokens = {};
  const categories: Array<keyof ThemeTokens> = ['color', 'motion', 'typography', 'radius', 'space', 'size', 'shadow', 'border'];
  for (const category of categories) {
    if (isPlainObject(tokens[category])) {
      next[category] = { ...tokens[category] } as never;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeThemeMotionDocument(motion: ThemeMotionDocument | undefined): ThemeMotionDocument | undefined {
  if (!isPlainObject(motion)) {
    return undefined;
  }

  const next: ThemeMotionDocument = {};
  if (isPlainObject(motion.presets)) {
    const presets: Record<string, ThemeMotionChannelSpec> = {};
    for (const [presetId, presetValue] of Object.entries(motion.presets as Record<string, unknown>)) {
      if (isPlainObject(presetValue)) {
        presets[presetId] = { ...presetValue };
      }
    }
    if (Object.keys(presets).length > 0) {
      next.presets = presets;
    }
  }
  if (isPlainObject(motion.scenes)) {
    const scenes: Record<string, ThemeMotionSceneSpec> = {};
    for (const [sceneId, sceneValue] of Object.entries(motion.scenes as Record<string, unknown>)) {
      if (isPlainObject(sceneValue)) {
        scenes[sceneId] = { ...sceneValue };
      }
    }
    if (Object.keys(scenes).length > 0) {
      next.scenes = scenes;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeBinding(binding: unknown): ThemeBinding | undefined {
  if (!isPlainObject(binding)) {
    return undefined;
  }

  const next: ThemeBinding = {};
  if (typeof binding.surface === 'string' && binding.surface.trim().length > 0) {
    next.surface = binding.surface.trim();
  }
  if (typeof binding.renderer === 'string' && binding.renderer.trim().length > 0) {
    next.renderer = binding.renderer.trim();
  }
  if (typeof binding.variant === 'string' && binding.variant.trim().length > 0) {
    next.variant = binding.variant.trim();
  }
  if (isPlainObject(binding.props)) {
    next.props = { ...binding.props };
  }

  const motion = cloneThemeBindingMotionSpec(binding.motion as ThemeBindingMotionSpec | undefined);
  if (motion) {
    next.motion = motion;
  }

  const capabilities = isPlainObject(binding.capabilities)
    ? (binding.capabilities as Record<string, unknown>)
    : undefined;

  if (isPlainObject(capabilities?.dynamicColor)) {
    next.capabilities = {
      dynamicColor: { ...capabilities.dynamicColor },
    };
  }

  return isThemeBindingEmpty(next) ? undefined : next;
}

function normalizeBindings(bindings: Theme['bindings'] | undefined): Theme['bindings'] {
  if (!isPlainObject(bindings)) {
    return undefined;
  }

  const nextBindings = Object.fromEntries(
    Object.entries(bindings)
      .map(([bindingId, binding]) => [bindingId, normalizeBinding(binding)])
      .filter((entry): entry is [string, ThemeBinding] => Boolean(entry[1]))
  );

  return Object.keys(nextBindings).length > 0 ? nextBindings : undefined;
}

function normalizeSurfaces(surfaces: Theme['surfaces'] | undefined): Theme['surfaces'] {
  if (!isPlainObject(surfaces)) {
    return undefined;
  }

  const nextSurfaces: Record<string, ComponentTheme> = {};
  for (const [surfaceId, surface] of Object.entries(surfaces as Record<string, unknown>)) {
    const normalizedSurface = normalizeComponentTheme(surface);
    if (!isComponentThemeEmpty(normalizedSurface)) {
      nextSurfaces[surfaceId] = normalizedSurface;
    }
  }

  return Object.keys(nextSurfaces).length > 0 ? nextSurfaces : undefined;
}

export function normalizeTheme(theme: ThemeImportCandidate): Theme {
  const normalizedBindings = normalizeBindings(theme.bindings);
  const normalizedSurfaces = normalizeSurfaces(theme.surfaces);
  const normalizedTokens = normalizeThemeTokens(theme.tokens);
  const normalizedMotion = normalizeThemeMotionDocument(theme.motion);

  return {
    id: theme.id,
    name: theme.name,
    ...(typeof theme.author === 'string' ? { author: theme.author } : {}),
    version: theme.version,
    ...(typeof theme.description === 'string' ? { description: theme.description } : {}),
    ...(typeof theme.thumbnail === 'string' ? { thumbnail: theme.thumbnail } : {}),
    ...(normalizedTokens ? { tokens: normalizedTokens } : {}),
    ...(normalizedMotion ? { motion: normalizedMotion } : {}),
    pixel: {
      shape: theme.pixel.shape,
      size: theme.pixel.size,
      opacity: theme.pixel.opacity,
      colors: {
        default: { ...theme.pixel.colors.default },
        hover: { ...theme.pixel.colors.hover },
        active: { ...theme.pixel.colors.active },
        occupied: { ...theme.pixel.colors.occupied },
      },
    },
    background: {
      maximized: { ...theme.background.maximized },
      windowed: { ...theme.background.windowed },
    },
    fonts: {
      primary: theme.fonts.primary,
      ...(typeof theme.fonts.secondary === 'string' ? { secondary: theme.fonts.secondary } : {}),
      ...(typeof theme.fonts.mono === 'string' ? { mono: theme.fonts.mono } : {}),
    },
    ...(isPlainObject(theme.globalEffects) ? { globalEffects: { ...theme.globalEffects } } : {}),
    ...(normalizedSurfaces ? { surfaces: normalizedSurfaces } : {}),
    ...(normalizedBindings ? { bindings: normalizedBindings } : {}),
  };
}
