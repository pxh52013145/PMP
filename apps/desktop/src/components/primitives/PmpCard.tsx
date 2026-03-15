import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
  const { theme, getSurfaceTheme } = useTheme();
  const variantSurfaceId = surfaceId ?? `primitive.card.${variant}`;
  const baseTheme = getSurfaceTheme('primitive.card');
  const variantTheme = getSurfaceTheme(variantSurfaceId);
  const resolvedTheme = useMemo(() => mergeComponentThemes(baseTheme, variantTheme), [baseTheme, variantTheme]);
  const surface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
    [theme, variantSurfaceId, resolvedTheme]
  );
  const rootProps = surface.getElementProps({
    primitive: 'card',
    bindingId: variantSurfaceId as ThemeBindingId,
    className,
    style,
  });

  return (
    <Component
      {...props}
      {...rootProps}
      data-surface-id={variantSurfaceId}
      data-surface-variant={resolvedTheme.variant}
    />
  );
}
