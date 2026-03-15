import { mergeThemeImportSurfaceSpecs } from './importAdapters';
import type { ThemeSurfaceId } from './types/theme';
import type { ThemeImportCandidate, ThemeImportSurfaceSpec } from './types/themeImport';

export const LEGACY_COMPONENT_THEME_KEYS: Record<string, string[]> = {
  'btn-play-pause': ['play-pause-button'],
  'btn-previous': ['previous-button'],
  'btn-next': ['next-button'],
  'btn-mode': ['play-mode'],
  'btn-volume': ['volume-control'],
  'btn-back': ['back-button'],
  'btn-debug': ['debug-button'],
  'btn-window-pin': ['window-pin-button'],
  'btn-play-queue': ['play-queue'],
  'btn-playlists': ['playlists-button'],
  'btn-music-library': ['music-library-button'],
};

const LEGACY_COMPONENT_THEME_ALIAS_TO_MAGNET_ID = Object.entries(LEGACY_COMPONENT_THEME_KEYS).reduce<
  Record<string, string>
>((acc, [componentId, aliases]) => {
  for (const alias of aliases) {
    acc[alias] = componentId;
  }
  return acc;
}, {});

const THEME_SURFACE_NAMESPACES = new Set(['magnet', 'page', 'overlay', 'primitive']);

function isThemeSurfaceId(value: string): boolean {
  const [namespace] = value.split('.', 1);
  return THEME_SURFACE_NAMESPACES.has(namespace ?? '');
}

function getLegacySurfaceWeight(componentId: string): number {
  if (isThemeSurfaceId(componentId)) {
    return 2;
  }
  if (LEGACY_COMPONENT_THEME_ALIAS_TO_MAGNET_ID[componentId]) {
    return 0;
  }
  return 1;
}

export function resolveLegacyComponentThemeSurfaceId(componentId: string): ThemeSurfaceId {
  const normalized = componentId.trim();
  if (!normalized) {
    return 'magnet.unknown';
  }
  if (isThemeSurfaceId(normalized)) {
    return normalized;
  }
  const canonicalId = LEGACY_COMPONENT_THEME_ALIAS_TO_MAGNET_ID[normalized] ?? normalized;
  return `magnet.${canonicalId}`;
}

export function migrateLegacyComponentThemes(theme: ThemeImportCandidate): ThemeImportCandidate {
  const { componentThemes, ...restTheme } = theme;
  if (!componentThemes || Object.keys(componentThemes).length === 0) {
    return restTheme;
  }

  const legacyEntries = Object.entries(componentThemes)
    .map(([componentId, componentTheme], index) => ({
      componentId: componentId.trim(),
      componentTheme,
      index,
    }))
    .filter((entry) => entry.componentId.length > 0)
    .sort((a, b) => {
      const weightDiff = getLegacySurfaceWeight(a.componentId) - getLegacySurfaceWeight(b.componentId);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return a.index - b.index;
    });

  const migratedLegacySurfaces: Record<string, ThemeImportSurfaceSpec> = {};
  for (const entry of legacyEntries) {
    const surfaceId = resolveLegacyComponentThemeSurfaceId(entry.componentId);
    migratedLegacySurfaces[surfaceId] = mergeThemeImportSurfaceSpecs(
      migratedLegacySurfaces[surfaceId],
      entry.componentTheme
    );
  }

  const mergedSurfaces = { ...migratedLegacySurfaces };
  for (const [surfaceId, surfaceTheme] of Object.entries(restTheme.surfaces ?? {})) {
    mergedSurfaces[surfaceId] = mergeThemeImportSurfaceSpecs(mergedSurfaces[surfaceId], surfaceTheme);
  }

  return {
    ...restTheme,
    ...(Object.keys(mergedSurfaces).length > 0 ? { surfaces: mergedSurfaces } : {}),
  };
}
