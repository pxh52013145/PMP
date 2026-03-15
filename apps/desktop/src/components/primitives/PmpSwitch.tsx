import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';
import { composeEventHandlers, resolvePrimitiveInteractionMotion, usePrimitiveInteractionState } from './interactionMotion';

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
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onMouseUp,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
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
  const interaction = usePrimitiveInteractionState({ disabled: props.disabled });

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    onCheckedChange?.(!checked, event);
  };

  const rootPart = surface.getPart('root', { state: stateName });
  const trackPart = surface.getPart('track', { state: stateName, includeSurfaceTokens: false });
  const thumbPart = surface.getPart('thumb', { state: stateName, includeSurfaceTokens: false });
  const labelPart = surface.getPart('label', { state: stateName, includeSurfaceTokens: false });
  const rootMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: rootPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
      }),
    [interaction.interactionState, interaction.transitionState, rootPart]
  );
  const trackMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: trackPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
        fallbackPart: rootPart,
      }),
    [interaction.interactionState, interaction.transitionState, rootPart, trackPart]
  );
  const thumbMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: thumbPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
        fallbackPart: rootPart,
      }),
    [interaction.interactionState, interaction.transitionState, rootPart, thumbPart]
  );
  const labelMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: labelPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
        fallbackPart: rootPart,
      }),
    [interaction.interactionState, interaction.transitionState, labelPart, rootPart]
  );
  const rootProps = surface.getElementProps({
    primitive: 'switch',
    bindingId: variantSurfaceId as ThemeBindingId,
    state: stateName,
    className,
    style: {
      ...style,
      ...rootMotion.style,
    },
  });
  const trackProps = surface.getElementProps({
    part: 'track',
    state: stateName,
    className: 'pmp-switch-track',
    style: trackMotion.style,
    includeSurfaceTokens: false,
  });
  const thumbProps = surface.getElementProps({
    part: 'thumb',
    state: stateName,
    className: 'pmp-switch-thumb',
    style: thumbMotion.style,
    includeSurfaceTokens: false,
  });
  const labelProps = surface.getElementProps({
    part: 'label',
    state: stateName,
    className: 'pmp-switch-label',
    style: labelMotion.style,
    includeSurfaceTokens: false,
  });

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
      data-pmp-interaction-state={interaction.interactionState}
      {...(rootMotion.channel ? { 'data-pmp-motion-channel': rootMotion.channel } : {})}
      {...(rootMotion.preset ? { 'data-pmp-motion-preset': rootMotion.preset } : {})}
      onClick={handleClick}
      onMouseEnter={composeEventHandlers(onMouseEnter, interaction.eventHandlers.onMouseEnter)}
      onMouseLeave={composeEventHandlers(onMouseLeave, interaction.eventHandlers.onMouseLeave)}
      onMouseDown={composeEventHandlers(onMouseDown, interaction.eventHandlers.onMouseDown)}
      onMouseUp={composeEventHandlers(onMouseUp, interaction.eventHandlers.onMouseUp)}
      onFocus={composeEventHandlers(onFocus, interaction.eventHandlers.onFocus)}
      onBlur={composeEventHandlers(onBlur, interaction.eventHandlers.onBlur)}
      onKeyDown={composeEventHandlers(onKeyDown, interaction.eventHandlers.onKeyDown)}
      onKeyUp={composeEventHandlers(onKeyUp, interaction.eventHandlers.onKeyUp)}
    >
      <span {...trackProps}>
        <span {...thumbProps} />
      </span>
      {children ? (
        <span {...labelProps}>{children}</span>
      ) : null}
    </button>
  );
});
