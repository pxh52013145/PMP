import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import {
  buildThemeMotionTransitionStyle,
  pickThemeMotionChannel,
  readThemePrefersReducedMotion,
} from '../../themes/surfaceMotion';
import type { ThemeBindingId, ThemeMotionChannelSpec, ThemeSurfaceId } from '../../themes/types/theme';

const DEFAULT_DRAWER_MOTION: ThemeMotionChannelSpec = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

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
  const motionChannel = useMemo(
    () => pickThemeMotionChannel(surface.root.motion, open ? ['enter', 'layout'] : ['exit', 'layout']),
    [open, surface.root.motion]
  );
  const reducedMotion = readThemePrefersReducedMotion();
  const transitionStyle = useMemo(
    () =>
      buildThemeMotionTransitionStyle(motionChannel?.spec ?? DEFAULT_DRAWER_MOTION, {
        disable: reducedMotion,
      }),
    [motionChannel?.spec, reducedMotion]
  );
  const rootProps = surface.getElementProps({
    primitive: 'drawer',
    bindingId: surfaceId as ThemeBindingId,
    className,
    style: {
      ...style,
      ...transitionStyle,
    },
  });

  return (
    <Component
      {...props}
      {...rootProps}
      data-surface-id={surfaceId}
      data-surface-variant={resolvedTheme.variant}
      data-open={open ? 'true' : 'false'}
      {...(motionChannel?.name ? { 'data-pmp-motion-channel': motionChannel.name } : {})}
      {...(motionChannel?.spec.preset ? { 'data-pmp-motion-preset': motionChannel.spec.preset } : {})}
      aria-hidden={open ? undefined : true}
    />
  );
}
