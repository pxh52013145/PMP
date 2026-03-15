import { assignThemeBinding, isThemeBindingEmpty, removeThemeBinding, resolveThemeBinding } from './bindings';
import {
  extractMagnetSurfaceDocument,
  extractRuntimeSurfaceDocument,
  importSurfaceToBinding,
  normalizeThemeImportSurfaceSpec,
} from './importAdapters';
import { migrateLegacyComponentThemes } from './legacyComponentThemes';
import { isComponentThemeEmpty } from './surfaces';
import type { Theme, ThemeBinding, ThemeTokens } from './types/theme';
import type { ThemeImportCandidate } from './types/themeImport';

const TOKEN_CATEGORIES = ['color', 'motion', 'typography', 'radius', 'space', 'size', 'shadow', 'border'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeThemeTokens(base: ThemeTokens | undefined, override: ThemeTokens | undefined): ThemeTokens | undefined {
  const next: ThemeTokens = {};

  for (const category of TOKEN_CATEGORIES) {
    const baseValue = base?.[category];
    const overrideValue = override?.[category];
    if (isPlainObject(baseValue) || isPlainObject(overrideValue)) {
      next[category] = {
        ...(isPlainObject(baseValue) ? baseValue : {}),
        ...(isPlainObject(overrideValue) ? overrideValue : {}),
      } as never;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function migrateLegacyTokenFields(theme: ThemeImportCandidate): ThemeImportCandidate {
  const nextTokens = mergeThemeTokens(
    {
      ...(theme.colors ? { color: theme.colors } : {}),
      ...(theme.motion ? { motion: theme.motion } : {}),
      ...(theme.typography ? { typography: theme.typography } : {}),
    },
    theme.tokens
  );

  const { colors, motion, typography, componentThemes, shader, ...restTheme } = theme;
  void colors;
  void motion;
  void typography;
  void componentThemes;
  void shader;

  return {
    ...restTheme,
    ...(nextTokens ? { tokens: nextTokens } : {}),
  };
}

function migrateSurfaceDocuments(theme: ThemeImportCandidate): Theme {
  const nextSurfaces: Theme['surfaces'] = {};
  let nextTheme: Theme = {
    ...theme,
    surfaces: undefined,
    bindings: theme.bindings ? { ...theme.bindings } : undefined,
  };

  for (const [surfaceId, surfaceSpec] of Object.entries(theme.surfaces ?? {})) {
    const normalizedSurface = normalizeThemeImportSurfaceSpec(surfaceSpec);

    if (surfaceId.startsWith('magnet.')) {
      const bindingId = surfaceId as `magnet.${string}`;
      const currentBinding = resolveThemeBinding(nextTheme, bindingId).binding;
      const nextBinding: ThemeBinding = {
        ...currentBinding,
        ...importSurfaceToBinding(normalizedSurface),
      };

      nextTheme = isThemeBindingEmpty(nextBinding)
        ? removeThemeBinding(nextTheme, bindingId)
        : assignThemeBinding(nextTheme, bindingId, nextBinding);

      const surfaceDocument = extractMagnetSurfaceDocument(normalizedSurface);
      if (!isComponentThemeEmpty(surfaceDocument)) {
        nextSurfaces[surfaceId] = surfaceDocument;
      }
      continue;
    }

    const surfaceDocument = extractRuntimeSurfaceDocument(normalizedSurface);
    if (!isComponentThemeEmpty(surfaceDocument)) {
      nextSurfaces[surfaceId] = surfaceDocument;
    }
  }

  return {
    ...nextTheme,
    ...(Object.keys(nextSurfaces).length > 0 ? { surfaces: nextSurfaces } : { surfaces: undefined }),
  };
}

export function normalizeTheme(theme: ThemeImportCandidate): Theme {
  const migratedLegacyComponents = migrateLegacyComponentThemes(theme);
  const migratedTokens = migrateLegacyTokenFields(migratedLegacyComponents);
  return migrateSurfaceDocuments(migratedTokens);
}
