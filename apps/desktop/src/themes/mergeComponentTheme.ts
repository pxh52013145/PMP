import type { ComponentTheme, ThemePartStateSpec, ThemeSurfacePartSpec, ThemeSurfaceStateSpec } from './types/theme';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeClassLists(...classLists: Array<string[] | undefined>): string[] | undefined {
  const merged = classLists.flatMap((classList) => classList ?? []).map((entry) => entry.trim()).filter(Boolean);
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function mergeThemePartStateSpecs(
  base: ThemePartStateSpec | undefined,
  override: ThemePartStateSpec | undefined
): ThemePartStateSpec | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    classes: mergeClassLists(base?.classes, override?.classes),
    style: {
      ...(isPlainObject(base?.style) ? base.style : {}),
      ...(isPlainObject(override?.style) ? override.style : {}),
    },
    tokens: {
      ...(isPlainObject(base?.tokens) ? base.tokens : {}),
      ...(isPlainObject(override?.tokens) ? override.tokens : {}),
    },
  };
}

function mergeThemeSurfacePartSpecs(
  base: ThemeSurfacePartSpec | undefined,
  override: ThemeSurfacePartSpec | undefined
): ThemeSurfacePartSpec | undefined {
  const merged = mergeThemePartStateSpecs(base, override);
  if (!merged && !base?.states && !override?.states) {
    return undefined;
  }

  const stateKeys = new Set<string>([...Object.keys(base?.states ?? {}), ...Object.keys(override?.states ?? {})]);
  const states = Object.fromEntries(
    [...stateKeys]
      .map((key) => [key, mergeThemePartStateSpecs(base?.states?.[key], override?.states?.[key])])
      .filter((entry): entry is [string, ThemePartStateSpec] => Boolean(entry[1]))
  );

  return {
    ...merged,
    ...(Object.keys(states).length > 0 ? { states } : {}),
  };
}

function mergeThemeSurfaceStateSpecs(
  base: ThemeSurfaceStateSpec | undefined,
  override: ThemeSurfaceStateSpec | undefined
): ThemeSurfaceStateSpec | undefined {
  const merged = mergeThemePartStateSpecs(base, override);
  if (!merged && !base?.parts && !override?.parts) {
    return undefined;
  }

  const partKeys = new Set<string>([...Object.keys(base?.parts ?? {}), ...Object.keys(override?.parts ?? {})]);
  const parts = Object.fromEntries(
    [...partKeys]
      .map((key) => [key, mergeThemePartStateSpecs(base?.parts?.[key], override?.parts?.[key])])
      .filter((entry): entry is [string, ThemePartStateSpec] => Boolean(entry[1]))
  );

  return {
    ...merged,
    ...(Object.keys(parts).length > 0 ? { parts } : {}),
  };
}

function mergePartMaps(
  base: Record<string, ThemeSurfacePartSpec> | undefined,
  override: Record<string, ThemeSurfacePartSpec> | undefined
): Record<string, ThemeSurfacePartSpec> | undefined {
  const keys = new Set<string>([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  if (keys.size === 0) {
    return undefined;
  }

  return Object.fromEntries(
    [...keys]
      .map((key) => [key, mergeThemeSurfacePartSpecs(base?.[key], override?.[key])])
      .filter((entry): entry is [string, ThemeSurfacePartSpec] => Boolean(entry[1]))
  );
}

function mergeStateMaps(
  base: Record<string, ThemeSurfaceStateSpec> | undefined,
  override: Record<string, ThemeSurfaceStateSpec> | undefined
): Record<string, ThemeSurfaceStateSpec> | undefined {
  const keys = new Set<string>([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  if (keys.size === 0) {
    return undefined;
  }

  return Object.fromEntries(
    [...keys]
      .map((key) => [key, mergeThemeSurfaceStateSpecs(base?.[key], override?.[key])])
      .filter((entry): entry is [string, ThemeSurfaceStateSpec] => Boolean(entry[1]))
  );
}

export function mergeComponentThemes(
  ...themes: Array<ComponentTheme | null | undefined>
): ComponentTheme {
  return themes.reduce<ComponentTheme>((acc, theme) => {
    if (!theme) {
      return acc;
    }

    return {
      ...acc,
      ...theme,
      tokens: {
        ...(acc.tokens ?? {}),
        ...(theme.tokens ?? {}),
      },
      parts: mergePartMaps(acc.parts, theme.parts),
      states: mergeStateMaps(acc.states, theme.states),
      metadata: {
        ...(acc.metadata ?? {}),
        ...(theme.metadata ?? {}),
      },
    };
  }, {});
}
