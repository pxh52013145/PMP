import { mergeComponentThemes } from './mergeComponentTheme';
import type { ComponentTheme, Theme, ThemeSurfaceId } from './types/theme';

function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).length > 0;
}

function resolveThemeSurfaceInternal(
  theme: Theme,
  surfaceId: ThemeSurfaceId,
  visited: Set<string>
): ComponentTheme {
  const current = theme.surfaces?.[surfaceId];
  if (!current) {
    return {};
  }

  const parentSurfaceId = typeof current.extends === 'string' ? current.extends.trim() : '';
  if (!parentSurfaceId || visited.has(surfaceId)) {
    return current;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(surfaceId);
  return mergeComponentThemes(resolveThemeSurfaceInternal(theme, parentSurfaceId, nextVisited), current);
}

export function resolveThemeSurface(theme: Theme, surfaceId: ThemeSurfaceId): ComponentTheme {
  return resolveThemeSurfaceInternal(theme, surfaceId, new Set());
}

export function isComponentThemeEmpty(themeValue: ComponentTheme | null | undefined): boolean {
  if (!themeValue) {
    return true;
  }

  return (
    !themeValue.extends &&
    !themeValue.variant &&
    !hasOwnKeys(themeValue.tokens) &&
    !hasOwnKeys(themeValue.parts) &&
    !hasOwnKeys(themeValue.states) &&
    !hasOwnKeys(themeValue.metadata)
  );
}

export function assignThemeSurface(theme: Theme, surfaceId: ThemeSurfaceId, surfaceTheme: ComponentTheme): Theme {
  return {
    ...theme,
    surfaces: {
      ...theme.surfaces,
      [surfaceId]: surfaceTheme,
    },
  };
}

export function removeThemeSurface(theme: Theme, surfaceId: ThemeSurfaceId): Theme {
  if (!theme.surfaces?.[surfaceId]) {
    return theme;
  }

  const nextSurfaces = { ...theme.surfaces };
  delete nextSurfaces[surfaceId];

  return {
    ...theme,
    ...(Object.keys(nextSurfaces).length > 0 ? { surfaces: nextSurfaces } : { surfaces: undefined }),
  };
}
