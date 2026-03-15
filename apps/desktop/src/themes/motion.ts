import type { CSSProperties } from 'react';

import type {
  Theme,
  ThemeBindingMotionCapability,
  ThemeBindingMotionLayoutPolicy,
  ThemeMotionChannelMap,
  ThemeMotionChannelSpec,
  ThemeTokenAssignments,
  ThemeTokenPrimitive,
} from './types/theme';

const TOKEN_REFERENCE_PATTERN = /^\{([^}]+)\}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  if (!channels || !isPlainObject(channels)) {
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

export function resolveThemeMotionCapability(
  theme: Theme,
  capability: ThemeBindingMotionCapability | undefined
): ThemeBindingMotionCapability | undefined {
  if (!capability || !isPlainObject(capability)) {
    return undefined;
  }

  const channels = resolveThemeMotionChannels(
    theme,
    isPlainObject(capability.channels) ? (capability.channels as ThemeMotionChannelMap) : undefined
  );
  const mode =
    capability.mode === 'full' || capability.mode === 'reduced' || capability.mode === 'off'
      ? capability.mode
      : undefined;
  let layout: ThemeBindingMotionLayoutPolicy | undefined;
  if (isPlainObject(capability.layout)) {
    layout = {
      ...(capability.layout.strategy === 'none' ||
      capability.layout.strategy === 'position' ||
      capability.layout.strategy === 'transform' ||
      capability.layout.strategy === 'flip'
        ? { strategy: capability.layout.strategy }
        : {}),
      ...(capability.layout.largeChange === 'snap' || capability.layout.largeChange === 'animate'
        ? { largeChange: capability.layout.largeChange }
        : {}),
      ...(typeof capability.layout.sharedKey === 'string' && capability.layout.sharedKey.trim().length > 0
        ? { sharedKey: capability.layout.sharedKey.trim() }
        : {}),
    };
  }
  const next: ThemeBindingMotionCapability = {
    ...(typeof capability.enabled === 'boolean' ? { enabled: capability.enabled } : {}),
    ...(mode ? { mode } : {}),
    ...(layout && Object.keys(layout).length > 0 ? { layout } : {}),
    ...(channels ? { channels } : {}),
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
