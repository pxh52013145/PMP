import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  surfaceId?: ThemeSurfaceId;
}

export const PmpButton = React.forwardRef<HTMLButtonElement, PmpButtonProps>(function PmpButton(
  { variant = 'default', surfaceId, className, style, ...props },
  ref
) {
  const { theme, getSurfaceTheme } = useTheme();
  const variantSurfaceId = surfaceId ?? `primitive.button.${variant}`;
  const baseTheme = getSurfaceTheme('primitive.button');
  const variantTheme = getSurfaceTheme(variantSurfaceId);
  const resolvedTheme = useMemo(() => mergeComponentThemes(baseTheme, variantTheme), [baseTheme, variantTheme]);
  const surface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
    [theme, variantSurfaceId, resolvedTheme]
  );
  const rootProps = surface.getElementProps({
    primitive: 'button',
    bindingId: variantSurfaceId as ThemeBindingId,
    className,
    style,
  });

  return (
    <button
      ref={ref}
      {...props}
      {...rootProps}
      data-surface-id={variantSurfaceId}
      data-surface-variant={resolvedTheme.variant}
      data-primitive-variant={variant}
    />
  );
});
