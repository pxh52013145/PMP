import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpChoiceButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: string;
  surfaceId?: ThemeSurfaceId;
  activeSurfaceId?: ThemeSurfaceId;
  inactiveSurfaceId?: ThemeSurfaceId;
}

export const PmpChoiceButton = React.forwardRef<HTMLButtonElement, PmpChoiceButtonProps>(
  function PmpChoiceButton(
    {
      active = false,
      variant = 'default',
      surfaceId,
      activeSurfaceId,
      inactiveSurfaceId,
      className,
      style,
      'aria-pressed': ariaPressed,
      role,
      ...props
    },
    ref
  ) {
    const { theme, getSurfaceTheme } = useTheme();
    const variantSurfaceId = surfaceId ?? `primitive.choice.${variant}`;
    const baseTheme = getSurfaceTheme('primitive.choice');
    const variantTheme = getSurfaceTheme(variantSurfaceId);
    const stateName = active ? 'active' : 'inactive';
    const stateSurfaceTheme = getSurfaceTheme(
      active
        ? (activeSurfaceId ?? `${variantSurfaceId}.active`)
        : (inactiveSurfaceId ?? `${variantSurfaceId}.inactive`)
    );
    const resolvedTheme = useMemo(
      () => mergeComponentThemes(baseTheme, variantTheme, stateSurfaceTheme),
      [baseTheme, stateSurfaceTheme, variantTheme]
    );
    const surface = useMemo(
      () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
      [theme, variantSurfaceId, resolvedTheme]
    );
    const resolvedAriaPressed =
      typeof ariaPressed !== 'undefined'
        ? ariaPressed
        : role === 'tab' || role === 'radio'
          ? undefined
          : active;
    const rootProps = surface.getElementProps({
      primitive: 'choice',
      bindingId: variantSurfaceId as ThemeBindingId,
      state: stateName,
      className,
      style,
    });

    return (
      <button
        ref={ref}
        {...props}
        aria-pressed={resolvedAriaPressed}
        {...rootProps}
        data-active={active ? 'true' : 'false'}
        role={role}
        data-surface-id={variantSurfaceId}
        data-surface-state={stateName}
        data-surface-variant={resolvedTheme.variant}
      />
    );
  }
);
