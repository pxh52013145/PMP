import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
  const { theme, getSurfaceTheme } = useTheme();
  const variantSurfaceId = surfaceId ?? `primitive.segmented.${variant}`;
  const baseTheme = getSurfaceTheme('primitive.segmented');
  const variantTheme = getSurfaceTheme(variantSurfaceId);
  const resolvedTheme = useMemo(() => mergeComponentThemes(baseTheme, variantTheme), [baseTheme, variantTheme]);
  const surface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
    [theme, variantSurfaceId, resolvedTheme]
  );
  const rootProps = surface.getElementProps({
    primitive: 'segmented',
    bindingId: variantSurfaceId as ThemeBindingId,
    className,
    style,
  });

  return (
    <div
      {...props}
      {...rootProps}
      data-surface-id={variantSurfaceId}
      data-surface-variant={resolvedTheme.variant}
    />
  );
}
