import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  surfaceId?: ThemeSurfaceId;
}

export const PmpButton = React.forwardRef<HTMLButtonElement, PmpButtonProps>(function PmpButton(
  { variant = 'default', surfaceId, className, style, ...props },
  ref
) {
  const baseTheme = useSkinSurface('primitive.button');
  const variantSurfaceId = surfaceId ?? `primitive.button.${variant}`;
  const variantTheme = useSkinSurface(variantSurfaceId);
  const theme = mergeComponentThemes(baseTheme, variantTheme);

  return (
    <button
      ref={ref}
      {...props}
      className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
      data-surface-id={variantSurfaceId}
      data-surface-variant={theme.variant}
      data-primitive-variant={variant}
      style={{ ...theme.styleOverride?.container, ...style }}
    />
  );
});
