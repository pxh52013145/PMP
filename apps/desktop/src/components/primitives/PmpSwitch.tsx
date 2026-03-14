import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpSwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  checked?: boolean;
  variant?: string;
  surfaceId?: ThemeSurfaceId;
  checkedSurfaceId?: ThemeSurfaceId;
  uncheckedSurfaceId?: ThemeSurfaceId;
  onCheckedChange?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
}

export const PmpSwitch = React.forwardRef<HTMLButtonElement, PmpSwitchProps>(function PmpSwitch(
  {
    checked = false,
    variant = 'default',
    surfaceId,
    checkedSurfaceId,
    uncheckedSurfaceId,
    onCheckedChange,
    className,
    style,
    onClick,
    type = 'button',
    children,
    ...props
  },
  ref
) {
  const baseTheme = useSkinSurface('primitive.switch');
  const variantSurfaceId = surfaceId ?? `primitive.switch.${variant}`;
  const variantTheme = useSkinSurface(variantSurfaceId);
  const stateTheme = useSkinSurface(
    checked
      ? (checkedSurfaceId ?? `${variantSurfaceId}.checked`)
      : (uncheckedSurfaceId ?? `${variantSurfaceId}.unchecked`)
  );
  const theme = mergeComponentThemes(baseTheme, variantTheme, stateTheme);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    onCheckedChange?.(!checked, event);
  };

  return (
    <button
      ref={ref}
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      className={[className, theme.classNameOverride?.container].filter(Boolean).join(' ')}
      data-checked={checked ? 'true' : 'false'}
      data-surface-id={variantSurfaceId}
      data-surface-state={checked ? 'checked' : 'unchecked'}
      data-surface-variant={theme.variant}
      onClick={handleClick}
      style={{ ...theme.styleOverride?.container, ...style }}
    >
      <span
        className={['pmp-switch-track', theme.classNameOverride?.track].filter(Boolean).join(' ')}
        style={theme.styleOverride?.track}
      >
        <span
          className={['pmp-switch-thumb', theme.classNameOverride?.thumb].filter(Boolean).join(' ')}
          style={theme.styleOverride?.thumb}
        />
      </span>
      {children ? (
        <span
          className={['pmp-switch-label', theme.classNameOverride?.label].filter(Boolean).join(' ')}
          style={theme.styleOverride?.label}
        >
          {children}
        </span>
      ) : null}
    </button>
  );
});
