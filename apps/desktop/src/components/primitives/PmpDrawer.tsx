import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
  const { theme, getSurfaceTheme } = useTheme();
  const overlayTheme = getSurfaceTheme(surfaceId);
  const dialogTheme = getSurfaceTheme('primitive.dialog');
  const resolvedTheme = useMemo(() => mergeComponentThemes(dialogTheme, overlayTheme), [dialogTheme, overlayTheme]);
  const surface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, surfaceId, resolvedTheme),
    [theme, surfaceId, resolvedTheme]
  );
  const rootProps = surface.getElementProps({
    primitive: 'drawer',
    bindingId: surfaceId as ThemeBindingId,
    className,
    style,
  });

  return (
    <Component
      {...props}
      {...rootProps}
      data-surface-id={surfaceId}
      data-surface-variant={resolvedTheme.variant}
      data-open={open ? 'true' : 'false'}
    />
  );
}
