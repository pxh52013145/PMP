import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

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
    const baseTheme = useSkinSurface('primitive.choice');
    const variantSurfaceId = surfaceId ?? `primitive.choice.${variant}`;
    const variantTheme = useSkinSurface(variantSurfaceId);
    const stateSurfaceTheme = useSkinSurface(
      active
        ? (activeSurfaceId ?? `${variantSurfaceId}.active`)
        : (inactiveSurfaceId ?? `${variantSurfaceId}.inactive`)
    );
    const theme = mergeComponentThemes(baseTheme, variantTheme, stateSurfaceTheme);
    const resolvedAriaPressed =
      typeof ariaPressed !== 'undefined'
        ? ariaPressed
        : role === 'tab' || role === 'radio'
          ? undefined
          : active;

    return (
      <button
        ref={ref}
        {...props}
        aria-pressed={resolvedAriaPressed}
        className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
        data-active={active ? 'true' : 'false'}
        role={role}
        data-surface-id={variantSurfaceId}
        data-surface-state={active ? 'active' : 'inactive'}
        data-surface-variant={theme.variant}
        style={{ ...theme.styleOverride?.container, ...style }}
      />
    );
  }
);
