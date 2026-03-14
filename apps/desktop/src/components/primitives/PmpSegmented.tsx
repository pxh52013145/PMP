import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpSegmentedProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: string;
  surfaceId?: ThemeSurfaceId;
}

export function PmpSegmented({
  variant = 'default',
  surfaceId,
  className,
  style,
  ...props
}: PmpSegmentedProps) {
  const baseTheme = useSkinSurface('primitive.segmented');
  const variantSurfaceId = surfaceId ?? `primitive.segmented.${variant}`;
  const variantTheme = useSkinSurface(variantSurfaceId);
  const theme = mergeComponentThemes(baseTheme, variantTheme);

  return (
    <div
      {...props}
      className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
      data-surface-id={variantSurfaceId}
      data-surface-variant={theme.variant}
      style={{ ...theme.styleOverride?.container, ...style }}
    />
  );
}
