import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
  const { theme, getSurfaceTheme } = useTheme();
  const variantSurfaceId = surfaceId ?? `primitive.switch.${variant}`;
  const baseTheme = getSurfaceTheme('primitive.switch');
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
    primitive: 'switch',
    bindingId: variantSurfaceId as ThemeBindingId,
    state: stateName,
    className,
    style,
  });
  const trackPart = surface.getPart('track', { state: stateName, includeSurfaceTokens: false });
  const thumbPart = surface.getPart('thumb', { state: stateName, includeSurfaceTokens: false });
  const labelPart = surface.getPart('label', { state: stateName, includeSurfaceTokens: false });

  return (
    <button
      ref={ref}
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      {...rootProps}
      data-checked={checked ? 'true' : 'false'}
      data-surface-id={variantSurfaceId}
      data-surface-state={stateName}
      data-surface-variant={resolvedTheme.variant}
      onClick={handleClick}
    >
      <span className={['pmp-switch-track', trackPart.className].filter(Boolean).join(' ')} style={trackPart.style}>
        <span className={['pmp-switch-thumb', thumbPart.className].filter(Boolean).join(' ')} style={thumbPart.style} />
      </span>
      {children ? (
        <span className={['pmp-switch-label', labelPart.className].filter(Boolean).join(' ')} style={labelPart.style}>
          {children}
        </span>
      ) : null}
    </button>
  );
});
