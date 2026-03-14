import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

type PmpCardElement = 'div' | 'section' | 'article';

export interface PmpCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: PmpCardElement;
  variant?: string;
  surfaceId?: ThemeSurfaceId;
}

export function PmpCard({
  as = 'div',
  variant = 'default',
  surfaceId,
  className,
  style,
  ...props
}: PmpCardProps) {
  const Component = as;
  const baseTheme = useSkinSurface('primitive.card');
  const variantSurfaceId = surfaceId ?? `primitive.card.${variant}`;
  const variantTheme = useSkinSurface(variantSurfaceId);
  const theme = mergeComponentThemes(baseTheme, variantTheme);

  return (
    <Component
      {...props}
      className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
      data-surface-id={variantSurfaceId}
      data-surface-variant={theme.variant}
      style={{ ...theme.styleOverride?.container, ...style }}
    />
  );
}
