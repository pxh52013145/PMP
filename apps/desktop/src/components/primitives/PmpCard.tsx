import React, { useMemo } from 'react';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';
import { composeEventHandlers, resolvePrimitiveInteractionMotion, usePrimitiveInteractionState } from './interactionMotion';

type PmpCardElement = 'div' | 'section' | 'article';

export interface PmpCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: PmpCardElement;
  variant?: string;
  surfaceId?: ThemeSurfaceId;
}

export function PmpCard({
  as = 'div',
  variant = 'default',
  surfaceId,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  onFocus,
  onBlur,
  onKeyDown,
  onKeyUp,
  ...props
}: PmpCardProps) {
  const Component = as;
  const { theme, getSurfaceTheme } = useTheme();
  const variantSurfaceId = surfaceId ?? `primitive.card.${variant}`;
  const baseTheme = getSurfaceTheme('primitive.card');
  const variantTheme = getSurfaceTheme(variantSurfaceId);
  const resolvedTheme = useMemo(() => mergeComponentThemes(baseTheme, variantTheme), [baseTheme, variantTheme]);
  const surface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, variantSurfaceId, resolvedTheme),
    [theme, variantSurfaceId, resolvedTheme]
  );
  const interaction = usePrimitiveInteractionState();
  const currentState = interaction.interactionState === 'idle' ? undefined : interaction.interactionState;
  const currentRootPart = useMemo(
    () => surface.getPart('root', currentState ? { state: currentState } : undefined),
    [currentState, surface]
  );
  const transitionRootPart = useMemo(
    () =>
      interaction.transitionState !== 'idle'
        ? surface.getPart('root', { state: interaction.transitionState })
        : undefined,
    [interaction.transitionState, surface]
  );
  const interactionMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: currentRootPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
        fallbackPart: transitionRootPart,
      }),
    [currentRootPart, interaction.interactionState, interaction.transitionState, transitionRootPart]
  );
  const rootProps = surface.getElementProps({
    primitive: 'card',
    bindingId: variantSurfaceId as ThemeBindingId,
    ...(currentState ? { state: currentState } : {}),
    className,
    style: {
      ...style,
      ...interactionMotion.style,
    },
  });

  return (
    <Component
      {...props}
      {...rootProps}
      data-surface-id={variantSurfaceId}
      data-surface-variant={resolvedTheme.variant}
      data-pmp-interaction-state={interaction.interactionState}
      {...(interactionMotion.channel ? { 'data-pmp-motion-channel': interactionMotion.channel } : {})}
      {...(interactionMotion.preset ? { 'data-pmp-motion-preset': interactionMotion.preset } : {})}
      onMouseEnter={composeEventHandlers(onMouseEnter, interaction.eventHandlers.onMouseEnter)}
      onMouseLeave={composeEventHandlers(onMouseLeave, interaction.eventHandlers.onMouseLeave)}
      onMouseDown={composeEventHandlers(onMouseDown, interaction.eventHandlers.onMouseDown)}
      onMouseUp={composeEventHandlers(onMouseUp, interaction.eventHandlers.onMouseUp)}
      onFocus={composeEventHandlers(onFocus, interaction.eventHandlers.onFocus)}
      onBlur={composeEventHandlers(onBlur, interaction.eventHandlers.onBlur)}
      onKeyDown={composeEventHandlers(onKeyDown, interaction.eventHandlers.onKeyDown)}
      onKeyUp={composeEventHandlers(onKeyUp, interaction.eventHandlers.onKeyUp)}
    />
  );
}
