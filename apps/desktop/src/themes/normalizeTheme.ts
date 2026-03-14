import { migrateLegacyComponentThemes } from './legacyComponentThemes';
import type { Theme, ThemeImportCandidate } from './types/theme';

export function normalizeTheme(theme: ThemeImportCandidate): Theme {
  const migratedTheme = migrateLegacyComponentThemes(theme);
  if (!('shader' in migratedTheme)) {
    return migratedTheme as Theme;
  }

  const normalizedTheme: ThemeImportCandidate = { ...migratedTheme };
  delete normalizedTheme.shader;
  return normalizedTheme as Theme;
}
