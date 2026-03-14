import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

type PmpDrawerElement = 'section' | 'div' | 'aside';

export interface PmpDrawerProps extends React.HTMLAttributes<HTMLElement> {
  as?: PmpDrawerElement;
  open?: boolean;
  surfaceId?: ThemeSurfaceId;
}

export function PmpDrawer({
  as = 'section',
  open = false,
  surfaceId = 'overlay.drawer',
  className,
  style,
  ...props
}: PmpDrawerProps) {
  const Component = as;
  const overlayTheme = useSkinSurface(surfaceId);
  const dialogTheme = useSkinSurface('primitive.dialog');
  const theme = mergeComponentThemes(dialogTheme, overlayTheme);

  return (
    <Component
      {...props}
      className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
      data-surface-id={surfaceId}
      data-surface-variant={theme.variant}
      data-open={open ? 'true' : 'false'}
      style={{ ...theme.styleOverride?.container, ...style }}
    />
  );
}
