import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import { useTheme } from './contexts/ThemeContextWithSync';
import type { ComponentTheme, Theme, ThemeBindingId, ThemeSurfaceId, ThemeTokenAssignments, ThemeTokenPrimitive } from './types/theme';

const TOKEN_REFERENCE_PATTERN = /^\{([^}]+)\}$/;

export interface ResolvedThemePart {
  name: string;
  classes: string[];
  className?: string;
  style: CSSProperties;
  tokens: ThemeTokenAssignments;
}

export interface SkinElementOptions {
  part?: string;
  state?: string;
  primitive?: string;
  bindingId?: ThemeBindingId;
  className?: string;
  style?: CSSProperties;
  includeSurfaceTokens?: boolean;
}

export interface ResolvedSkinSurfaceModel {
  surfaceId: ThemeSurfaceId;
  theme: ComponentTheme;
  variant?: string;
  root: ResolvedThemePart;
  getPart: (partName: string, options?: { state?: string; includeSurfaceTokens?: boolean }) => ResolvedThemePart;
  getElementProps: (options?: SkinElementOptions) => {
    className?: string;
    style?: CSSProperties;
    'data-pmp-surface': string;
    'data-pmp-part': string;
    'data-pmp-state'?: string;
    'data-pmp-primitive'?: string;
    'data-pmp-binding'?: string;
    'data-pmp-variant'?: string;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function classesToString(classes: string[]): string | undefined {
  return classes.length > 0 ? classes.join(' ') : undefined;
}

function mergeClassLists(...entries: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      entries
        .flatMap((entry) => entry ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
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

function resolveTokenValue(
  theme: Theme,
  assignments: ThemeTokenAssignments,
  tokenValue: ThemeTokenPrimitive,
  stack: Set<string> = new Set()
): ThemeTokenPrimitive {
  if (typeof tokenValue !== 'string') {
    return tokenValue;
  }

  const match = tokenValue.match(TOKEN_REFERENCE_PATTERN);
  if (!match) {
    return tokenValue;
  }

  const tokenId = match[1]?.trim();
  if (!tokenId || stack.has(tokenId)) {
    return tokenValue;
  }

  const localValue = assignments[tokenId];
  if (typeof localValue !== 'undefined') {
    const nextStack = new Set(stack);
    nextStack.add(tokenId);
    return resolveTokenValue(theme, assignments, localValue, nextStack);
  }

  const rootTokens = flattenThemeTokens(theme);
  const rootValue = rootTokens[tokenId];
  if (typeof rootValue === 'undefined') {
    return tokenValue;
  }

  const nextStack = new Set(stack);
  nextStack.add(tokenId);
  return resolveTokenValue(theme, assignments, rootValue, nextStack);
}

function toCssVariableName(tokenId: string): string {
  return `--pmp-${tokenId.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

function buildTokenStyle(theme: Theme, assignments: ThemeTokenAssignments): CSSProperties {
  const style: CSSProperties = {};
  const styleRecord = style as Record<string, string>;

  for (const [tokenId, tokenValue] of Object.entries(assignments)) {
    const resolved = resolveTokenValue(theme, assignments, tokenValue);
    styleRecord[toCssVariableName(tokenId)] = String(resolved);
  }

  return style;
}

function mergeTokenAssignments(...entries: Array<ThemeTokenAssignments | undefined>): ThemeTokenAssignments {
  return Object.assign({}, ...entries.filter(isPlainObject));
}

export function resolveThemePart(
  theme: Theme,
  surfaceTheme: ComponentTheme,
  partName: string,
  options: { state?: string; includeSurfaceTokens?: boolean } = {}
): ResolvedThemePart {
  const { state, includeSurfaceTokens = partName === 'root' } = options;
  const part = surfaceTheme.parts?.[partName];
  const partState = state ? part?.states?.[state] : undefined;
  const surfaceState = state ? surfaceTheme.states?.[state] : undefined;
  const surfaceStatePart = state ? surfaceState?.parts?.[partName] : undefined;

  const classes = mergeClassLists(
    partName === 'root' ? surfaceState?.classes : undefined,
    part?.classes,
    partState?.classes,
    surfaceStatePart?.classes
  );

  const tokens = mergeTokenAssignments(
    includeSurfaceTokens ? surfaceTheme.tokens : undefined,
    partName === 'root' ? surfaceState?.tokens : undefined,
    part?.tokens,
    partState?.tokens,
    surfaceStatePart?.tokens
  );

  return {
    name: partName,
    classes,
    className: classesToString(classes),
    tokens,
    style: {
      ...buildTokenStyle(theme, tokens),
      ...(partName === 'root' && isPlainObject(surfaceState?.style) ? (surfaceState.style as CSSProperties) : {}),
      ...(isPlainObject(part?.style) ? (part.style as CSSProperties) : {}),
      ...(isPlainObject(partState?.style) ? (partState.style as CSSProperties) : {}),
      ...(isPlainObject(surfaceStatePart?.style) ? (surfaceStatePart.style as CSSProperties) : {}),
    },
  };
}

export function createResolvedSkinSurfaceModel(
  theme: Theme,
  surfaceId: ThemeSurfaceId,
  surfaceTheme: ComponentTheme
): ResolvedSkinSurfaceModel {
  const getPart = (partName: string, options?: { state?: string; includeSurfaceTokens?: boolean }) =>
    resolveThemePart(theme, surfaceTheme, partName, options);

  const root = getPart('root');

  return {
    surfaceId,
    theme: surfaceTheme,
    variant: surfaceTheme.variant,
    root,
    getPart,
    getElementProps: (options = {}) => {
      const { part = 'root', state, primitive, bindingId, className, style, includeSurfaceTokens } = options;
      const resolvedPart = getPart(part, { state, includeSurfaceTokens });

      return {
        className: [className, resolvedPart.className].filter(Boolean).join(' ') || undefined,
        style: { ...resolvedPart.style, ...style },
        'data-pmp-surface': surfaceId,
        'data-pmp-part': part,
        ...(state ? { 'data-pmp-state': state } : {}),
        ...(primitive ? { 'data-pmp-primitive': primitive } : {}),
        ...(bindingId ? { 'data-pmp-binding': bindingId } : {}),
        ...(surfaceTheme.variant ? { 'data-pmp-variant': surfaceTheme.variant } : {}),
      };
    },
  };
}

export function useSkinSurfaceModel(surfaceId: ThemeSurfaceId): ResolvedSkinSurfaceModel {
  const { theme, getSurfaceTheme } = useTheme();
  const surfaceTheme = getSurfaceTheme(surfaceId);

  return useMemo(
    () => createResolvedSkinSurfaceModel(theme, surfaceId, surfaceTheme),
    [theme, surfaceId, surfaceTheme]
  );
}
