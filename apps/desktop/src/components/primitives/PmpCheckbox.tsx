import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
    const { theme, getSurfaceTheme } = useTheme();
    const variantSurfaceId = surfaceId ?? `primitive.checkbox.${variant}`;
    const baseTheme = getSurfaceTheme('primitive.checkbox');
    const variantTheme = getSurfaceTheme(variantSurfaceId);
    const stateName = checked ? 'checked' : 'unchecked';
    const stateTheme = getSurfaceTheme(
      checked
        ? (checkedSurfaceId ?? `${variantSurfaceId}.checked`)
        : (uncheckedSurfaceId ?? `${variantSurfaceId}.unchecked`)
    );
    const resolvedTheme = useMemo(
      () => mergeComponentThemes(baseTheme, variantTheme, stateTheme),
      [baseTheme, stateTheme, variantTheme]
    );
    const surface = useMemo(
      () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
      [theme, variantSurfaceId, resolvedTheme]
    );

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      onCheckedChange?.(!checked, event);
    };

    const rootProps = surface.getElementProps({
      primitive: 'checkbox',
      bindingId: variantSurfaceId as ThemeBindingId,
      state: stateName,
      className,
      style,
    });
    const boxPart = surface.getPart('box', { state: stateName, includeSurfaceTokens: false });
    const indicatorPart = surface.getPart('indicator', { state: stateName, includeSurfaceTokens: false });
    const labelPart = surface.getPart('label', { state: stateName, includeSurfaceTokens: false });

    return (
      <button
        ref={ref}
        {...props}
        type={type}
        role="checkbox"
        aria-checked={checked}
        {...rootProps}
        data-checked={checked ? 'true' : 'false'}
        data-surface-id={variantSurfaceId}
        data-surface-state={stateName}
        data-surface-variant={resolvedTheme.variant}
        onClick={handleClick}
      >
        <span className={['pmp-checkbox-box', boxPart.className].filter(Boolean).join(' ')} style={boxPart.style}>
          <span
            className={['pmp-checkbox-indicator', indicatorPart.className].filter(Boolean).join(' ')}
            style={indicatorPart.style}
          />
        </span>
        {children ? (
          <span className={['pmp-checkbox-label', labelPart.className].filter(Boolean).join(' ')} style={labelPart.style}>
            {children}
          </span>
        ) : null}
      </button>
    );
  }
);
