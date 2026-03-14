import type { ComponentTheme, Theme, ThemeSurfaceId } from './types/theme';

function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).length > 0;
}

export function resolveThemeSurface(theme: Theme, surfaceId: ThemeSurfaceId): ComponentTheme {
  return theme.surfaces?.[surfaceId] ?? {};
}

export function isComponentThemeEmpty(themeValue: ComponentTheme | null | undefined): boolean {
  if (!themeValue) {
    return true;
  }

  return (
    !themeValue.variant &&
    !hasOwnKeys(themeValue.variantConfig) &&
    !hasOwnKeys(themeValue.slots) &&
    !themeValue.customRenderer &&
    !hasOwnKeys(themeValue.styleOverride) &&
    !hasOwnKeys(themeValue.classNameOverride) &&
    !hasOwnKeys(themeValue.dynamicColor)
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
