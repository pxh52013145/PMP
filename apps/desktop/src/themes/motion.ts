import type { CSSProperties } from 'react';

import type {
  Theme,
  ThemeBindingMotionCapability,
  ThemeBindingMotionSpec,
  ThemeBindingMotionLayoutPolicy,
  ThemeMotionChannelMap,
  ThemeMotionChannelSpec,
  ThemeMotionDocument,
  ThemeMotionReference,
  ThemeMotionSceneSpec,
  ThemeTokenAssignments,
  ThemeTokenPrimitive,
} from './types/theme';

const TOKEN_REFERENCE_PATTERN = /^\{([^}]+)\}$/;

const DEFAULT_SPACE_SWITCH_DURATION = '170ms';
const DEFAULT_SPACE_SWITCH_EXIT_DURATION = '130ms';
const DEFAULT_SPACE_SWITCH_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const DEFAULT_SPACE_SWITCH_EXIT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';

export const DEFAULT_THEME_MOTION: ThemeMotionDocument = {
  presets: {
    'magnet-space-enter': {
      preset: 'scale-in',
      duration: DEFAULT_SPACE_SWITCH_DURATION,
      easing: DEFAULT_SPACE_SWITCH_EASING,
      scale: 0.96,
    },
    'magnet-space-exit': {
      preset: 'scale-out',
      duration: DEFAULT_SPACE_SWITCH_EXIT_DURATION,
      easing: DEFAULT_SPACE_SWITCH_EXIT_EASING,
      scale: 1.035,
    },
    'magnet-space-slide-forward': {
      preset: 'shared-axis',
      duration: '190ms',
      easing: DEFAULT_SPACE_SWITCH_EASING,
      distance: '18px',
      scale: 0.985,
    },
  },
  scenes: {
    spaceSwitch: {
      enter: 'magnet-space-enter',
      exit: 'magnet-space-exit',
      stagger: {
        by: 'grid',
        from: 'center',
        step: '14ms',
      },
      match: {
        by: 'magnet-id',
      },
    },
  },
};

export function mergeDefaultThemeMotion(motion: ThemeMotionDocument | undefined): ThemeMotionDocument {
  const presets = {
    ...(DEFAULT_THEME_MOTION.presets ?? {}),
    ...(motion?.presets ?? {}),
  };
  const scenes = {
    ...(DEFAULT_THEME_MOTION.scenes ?? {}),
    ...(motion?.scenes ?? {}),
  };

  return {
    ...(Object.keys(presets).length > 0 ? { presets } : {}),
    ...(Object.keys(scenes).length > 0 ? { scenes } : {}),
  };
}

export function withDefaultThemeMotion(theme: Theme): Theme {
  return {
    ...theme,
    motion: mergeDefaultThemeMotion(theme.motion),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface ResolvedThemeMotionScene {
  enter?: ThemeMotionChannelSpec;
  exit?: ThemeMotionChannelSpec;
  stagger?: {
    by?: 'index' | 'x' | 'y' | 'grid' | 'distance';
    from?: 'start' | 'center' | 'end';
    step?: string | number;
  };
  match?: {
    by?: 'magnet-id' | 'shared-key';
  };
  sharedAxis?: 'x' | 'y' | 'scale';
}

function flattenThemeTokens(theme: Theme): Record<string, ThemeTokenPrimitive> {
  const flattened: Record<string, ThemeTokenPrimitive> = {};

  for (const [category, value] of Object.entries(theme.tokens ?? {})) {
    if (!isPlainObject(value)) {
      continue;
    }

    for (const [tokenId, tokenValue] of Object.entries(value)) {
      flattened[`${category}.${tokenId}`] = tokenValue as ThemeTokenPrimitive;
    }
  }

  return flattened;
}

function resolveMotionTokenValue(
  theme: Theme,
  value: ThemeTokenPrimitive,
  assignments: ThemeTokenAssignments = {},
  stack: Set<string> = new Set()
): string | number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return String(value);
  }

  const match = value.match(TOKEN_REFERENCE_PATTERN);
  if (!match) {
    return value;
  }

  const tokenId = match[1]?.trim();
  if (!tokenId || stack.has(tokenId)) {
    return value;
  }

  const localValue = assignments[tokenId];
  if (typeof localValue !== 'undefined') {
    const nextStack = new Set(stack);
    nextStack.add(tokenId);
    return resolveMotionTokenValue(theme, localValue, assignments, nextStack);
  }

  const rootTokens = flattenThemeTokens(theme);
  const rootValue = rootTokens[tokenId];
  if (typeof rootValue === 'undefined') {
    return value;
  }

  const nextStack = new Set(stack);
  nextStack.add(tokenId);
  return resolveMotionTokenValue(theme, rootValue, assignments, nextStack);
}

function normalizeMotionFieldValue(field: keyof ThemeMotionChannelSpec, value: unknown): string | number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (field === 'iterationCount') {
    return typeof value === 'number' || value === 'infinite' ? value : undefined;
  }

  if (field === 'scale') {
    return typeof value === 'number' ? value : undefined;
  }

  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export function resolveThemeMotionChannelSpec(
  theme: Theme,
  spec: ThemeMotionChannelSpec | undefined,
  assignments?: ThemeTokenAssignments
): ThemeMotionChannelSpec | undefined {
  if (!spec || !isPlainObject(spec)) {
    return undefined;
  }

  const next: ThemeMotionChannelSpec = {};
  const fields: Array<keyof ThemeMotionChannelSpec> = [
    'preset',
    'duration',
    'easing',
    'delay',
    'iterationCount',
    'direction',
    'fillMode',
    'playState',
    'distance',
    'scale',
    'origin',
  ];

  for (const field of fields) {
    const rawValue = spec[field];
    if (typeof rawValue === 'undefined') {
      continue;
    }

    const resolvedValue =
      typeof rawValue === 'string' || typeof rawValue === 'number'
        ? resolveMotionTokenValue(theme, rawValue, assignments)
        : rawValue;
    const normalizedValue = normalizeMotionFieldValue(field, resolvedValue);
    if (typeof normalizedValue !== 'undefined') {
      next[field] = normalizedValue as never;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function resolveThemeMotionReference(
  theme: Theme,
  reference: ThemeMotionReference | undefined,
  assignments?: ThemeTokenAssignments
): ThemeMotionChannelSpec | undefined {
  if (!reference) {
    return undefined;
  }

  if (typeof reference === 'string') {
    const presetId = reference.trim();
    if (!presetId) {
      return undefined;
    }

    const presetSpec = theme.motion?.presets?.[presetId];
    if (presetSpec) {
      return resolveThemeMotionChannelSpec(theme, presetSpec, assignments);
    }

    return resolveThemeMotionChannelSpec(theme, { preset: presetId }, assignments);
  }

  return resolveThemeMotionChannelSpec(theme, reference, assignments);
}

export function mergeThemeMotionChannels(
  ...entries: Array<ThemeMotionChannelMap | undefined>
): ThemeMotionChannelMap | undefined {
  const keys = new Set<string>(entries.flatMap((entry) => Object.keys(entry ?? {})));
  if (keys.size === 0) {
    return undefined;
  }

  const channels: ThemeMotionChannelMap = {};
  for (const key of keys) {
    const merged = Object.assign({}, ...entries.map((entry) => entry?.[key]).filter(isPlainObject));
    if (Object.keys(merged).length > 0) {
      channels[key] = merged;
    }
  }

  return Object.keys(channels).length > 0 ? channels : undefined;
}

export function resolveThemeMotionChannels(
  theme: Theme,
  channels: ThemeMotionChannelMap | undefined,
  assignments?: ThemeTokenAssignments
): ThemeMotionChannelMap | undefined {
  if (!channels) {
    return undefined;
  }

  const resolved: ThemeMotionChannelMap = {};
  for (const [channelName, spec] of Object.entries(channels)) {
    const nextSpec = resolveThemeMotionChannelSpec(theme, spec, assignments);
    if (nextSpec) {
      resolved[channelName] = nextSpec;
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function normalizeMotionLayoutPolicy(
  layout: ThemeBindingMotionLayoutPolicy | ThemeBindingMotionSpec['layout'] | undefined
): ThemeBindingMotionLayoutPolicy | undefined {
  if (!layout) {
    return undefined;
  }

  const next: ThemeBindingMotionLayoutPolicy = {};
  if (
    layout.strategy === 'none' ||
    layout.strategy === 'position' ||
    layout.strategy === 'transform' ||
    layout.strategy === 'flip'
  ) {
    next.strategy = layout.strategy;
  }
  if (layout.largeChange === 'snap' || layout.largeChange === 'animate') {
    next.largeChange = layout.largeChange;
  }
  if (typeof layout.sharedKey === 'string' && layout.sharedKey.trim().length > 0) {
    next.sharedKey = layout.sharedKey.trim();
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildResolvedBindingMotionChannels(
  theme: Theme,
  motion: ThemeBindingMotionSpec
): ThemeMotionChannelMap | undefined {
  const channels: ThemeMotionChannelMap = {};
  const presence = motion.presence;
  const layout = motion.layout;
  const attention = motion.attention;
  const visibility = motion.visibility;

  const enter = resolveThemeMotionReference(theme, presence?.enter);
  const exit = resolveThemeMotionReference(theme, presence?.exit);
  const move = resolveThemeMotionReference(theme, layout?.move);
  const resize = resolveThemeMotionReference(theme, layout?.resize);
  const idle = resolveThemeMotionReference(theme, attention?.idle);
  const hover = resolveThemeMotionReference(theme, attention?.hover);
  const active = resolveThemeMotionReference(theme, attention?.active);
  const success = resolveThemeMotionReference(theme, attention?.success);
  const warning = resolveThemeMotionReference(theme, attention?.warning);
  const show = resolveThemeMotionReference(theme, visibility?.show);
  const hide = resolveThemeMotionReference(theme, visibility?.hide);

  if (enter) {
    channels.enter = enter;
  }
  if (exit) {
    channels.exit = exit;
  }
  if (move) {
    channels.layout = move;
  }
  if (resize) {
    channels.layoutResize = resize;
  }
  if (idle) {
    channels.attention = idle;
  }
  if (hover) {
    channels.hover = hover;
  }
  if (active) {
    channels.active = active;
  }
  if (success) {
    channels.success = success;
  }
  if (warning) {
    channels.warning = warning;
  }
  if (show) {
    channels.show = show;
  }
  if (hide) {
    channels.hide = hide;
  }

  return Object.keys(channels).length > 0 ? channels : undefined;
}

export function resolveThemeBindingMotion(
  theme: Theme,
  motion: ThemeBindingMotionSpec | undefined
): ThemeBindingMotionCapability | undefined {
  if (!motion) {
    return undefined;
  }

  const channels = buildResolvedBindingMotionChannels(theme, motion);
  const layout = normalizeMotionLayoutPolicy(motion.layout);

  const next: ThemeBindingMotionCapability = {
    ...(typeof motion.enabled === 'boolean' ? { enabled: motion.enabled } : {}),
    ...(motion.mode === 'full' || motion.mode === 'reduced' || motion.mode === 'off' ? { mode: motion.mode } : {}),
    ...(layout && Object.keys(layout).length > 0 ? { layout } : {}),
    ...(channels ? { channels } : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

export function resolveThemeMotionScene(
  theme: Theme,
  scene: string | ThemeMotionSceneSpec | undefined
): ResolvedThemeMotionScene | undefined {
  const sceneSpec = typeof scene === 'string' ? theme.motion?.scenes?.[scene] : scene;
  if (!sceneSpec) {
    return undefined;
  }

  const enter = resolveThemeMotionReference(theme, sceneSpec.enter);
  const exit = resolveThemeMotionReference(theme, sceneSpec.exit);
  const stagger = sceneSpec.stagger;
  const match = sceneSpec.match;
  const staggerStep =
    typeof stagger?.step === 'string' || typeof stagger?.step === 'number'
      ? resolveMotionTokenValue(theme, stagger.step)
      : undefined;

  const next: ResolvedThemeMotionScene = {
    ...(enter ? { enter } : {}),
    ...(exit ? { exit } : {}),
    ...(stagger
      ? {
          stagger: {
            ...(stagger.by === 'index' ||
            stagger.by === 'x' ||
            stagger.by === 'y' ||
            stagger.by === 'grid' ||
            stagger.by === 'distance'
              ? { by: stagger.by }
              : {}),
            ...(stagger.from === 'start' ||
            stagger.from === 'center' ||
            stagger.from === 'end'
              ? { from: stagger.from }
              : {}),
            ...(typeof staggerStep === 'string' || typeof staggerStep === 'number' ? { step: staggerStep } : {}),
          },
        }
      : {}),
    ...(match?.by === 'magnet-id' || match?.by === 'shared-key'
      ? { match: { by: match.by } }
      : {}),
    ...(sceneSpec.sharedAxis === 'x' || sceneSpec.sharedAxis === 'y' || sceneSpec.sharedAxis === 'scale'
      ? { sharedAxis: sceneSpec.sharedAxis }
      : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function serializeMotionCssValue(field: keyof ThemeMotionChannelSpec, value: string | number): string {
  if ((field === 'duration' || field === 'delay') && typeof value === 'number') {
    return `${value}ms`;
  }

  if (field === 'distance' && typeof value === 'number') {
    return `${value}px`;
  }

  return String(value);
}

export function listThemeMotionChannels(channels: ThemeMotionChannelMap | undefined): string | undefined {
  if (!channels) {
    return undefined;
  }

  const names = Object.keys(channels).filter(Boolean);
  return names.length > 0 ? names.join(' ') : undefined;
}

export function buildThemeMotionStyle(channels: ThemeMotionChannelMap | undefined): CSSProperties | undefined {
  if (!channels) {
    return undefined;
  }

  const style: Record<string, string> = {};
  const channelNames = listThemeMotionChannels(channels);
  if (channelNames) {
    style['--pmp-motion-channels'] = channelNames;
  }

  for (const [channelName, spec] of Object.entries(channels)) {
    for (const [fieldName, fieldValue] of Object.entries(spec)) {
      if (typeof fieldValue === 'undefined') {
        continue;
      }

      style[`--pmp-motion-${toKebabCase(channelName)}-${toKebabCase(fieldName)}`] =
        serializeMotionCssValue(fieldName as keyof ThemeMotionChannelSpec, fieldValue);
    }
  }

  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
}
