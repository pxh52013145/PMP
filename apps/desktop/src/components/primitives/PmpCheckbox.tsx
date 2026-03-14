import React from 'react';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpCheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  checked?: boolean;
  variant?: string;
  surfaceId?: ThemeSurfaceId;
  checkedSurfaceId?: ThemeSurfaceId;
  uncheckedSurfaceId?: ThemeSurfaceId;
  onCheckedChange?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
}

export const PmpCheckbox = React.forwardRef<HTMLButtonElement, PmpCheckboxProps>(
  function PmpCheckbox(
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
    const baseTheme = useSkinSurface('primitive.checkbox');
    const variantSurfaceId = surfaceId ?? `primitive.checkbox.${variant}`;
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
        role="checkbox"
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
          className={['pmp-checkbox-box', theme.classNameOverride?.box].filter(Boolean).join(' ')}
          style={theme.styleOverride?.box}
        >
          <span
            className={['pmp-checkbox-indicator', theme.classNameOverride?.indicator]
              .filter(Boolean)
              .join(' ')}
            style={theme.styleOverride?.indicator}
          />
        </span>
        {children ? (
          <span
            className={['pmp-checkbox-label', theme.classNameOverride?.label].filter(Boolean).join(' ')}
            style={theme.styleOverride?.label}
          >
            {children}
          </span>
        ) : null}
      </button>
    );
  }
);
