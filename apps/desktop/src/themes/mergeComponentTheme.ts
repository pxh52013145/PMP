import type { ComponentTheme } from './types/theme';

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
      variantConfig: {
        ...(acc.variantConfig ?? {}),
        ...(theme.variantConfig ?? {}),
      },
      slots: {
        ...(acc.slots ?? {}),
        ...(theme.slots ?? {}),
      },
      styleOverride: {
        ...(acc.styleOverride ?? {}),
        ...(theme.styleOverride ?? {}),
      },
      classNameOverride: {
        ...(acc.classNameOverride ?? {}),
        ...(theme.classNameOverride ?? {}),
      },
      dynamicColor: theme.dynamicColor
        ? {
            ...(acc.dynamicColor ?? {}),
            ...theme.dynamicColor,
          }
        : acc.dynamicColor,
    };
  }, {});
}
