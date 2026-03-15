import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { ResolvedThemePart } from '../../themes/skinSurface';
import { buildThemeMotionTransitionStyle, pickThemeMotionChannel, readThemePrefersReducedMotion } from '../../themes/surfaceMotion';
import type { ThemeMotionChannelSpec } from '../../themes/types/theme';

export type PrimitiveInteractionState = 'idle' | 'hover' | 'active' | 'focus';

const DEFAULT_INTERACTION_MOTION: Record<Exclude<PrimitiveInteractionState, 'idle'>, ThemeMotionChannelSpec> = {
  hover: {
    duration: 140,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  active: {
    duration: 120,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  focus: {
    duration: 160,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
};

const INTERACTION_TRANSITION_PROPERTIES = [
  'transform',
  'translate',
  'scale',
  'opacity',
  'color',
  'background-color',
  'border-color',
  'box-shadow',
  'filter',
  'outline-color',
  'text-shadow',
  'fill',
  'stroke',
].join(', ');

export function composeEventHandlers<TEvent>(
  userHandler: ((event: TEvent) => void) | undefined,
  runtimeHandler: ((event: TEvent) => void) | undefined
): (event: TEvent) => void {
  return (event: TEvent) => {
    userHandler?.(event);
    runtimeHandler?.(event);
  };
}

function isKeyboardActivationKey(value: string): boolean {
  return value === ' ' || value === 'Enter';
}

export function usePrimitiveInteractionState(options: { disabled?: boolean } = {}) {
  const { disabled = false } = options;
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const lastTransitionStateRef = useRef<PrimitiveInteractionState>('idle');

  useEffect(() => {
    if (!disabled) {
      return;
    }

    setIsHovered(false);
    setIsPressed(false);
    setIsFocused(false);
    lastTransitionStateRef.current = 'idle';
  }, [disabled]);

  useEffect(() => {
    if (disabled || !isPressed) {
      return;
    }

    const clearPressedState = () => {
      setIsPressed(false);
    };

    window.addEventListener('mouseup', clearPressedState);
    window.addEventListener('blur', clearPressedState);

    return () => {
      window.removeEventListener('mouseup', clearPressedState);
      window.removeEventListener('blur', clearPressedState);
    };
  }, [disabled, isPressed]);

  const interactionState: PrimitiveInteractionState = useMemo(() => {
    if (disabled) {
      return 'idle';
    }

    if (isPressed) {
      return 'active';
    }

    if (isHovered) {
      return 'hover';
    }

    if (isFocused) {
      return 'focus';
    }

    return 'idle';
  }, [disabled, isFocused, isHovered, isPressed]);

  useEffect(() => {
    if (interactionState === 'idle') {
      return;
    }

    lastTransitionStateRef.current = interactionState;
  }, [interactionState]);

  return {
    interactionState,
    transitionState: interactionState === 'idle' ? lastTransitionStateRef.current : interactionState,
    eventHandlers: {
      onMouseEnter: disabled ? undefined : () => setIsHovered(true),
      onMouseLeave: disabled
        ? undefined
        : () => {
            setIsHovered(false);
            setIsPressed(false);
          },
      onMouseDown: disabled ? undefined : () => setIsPressed(true),
      onMouseUp: disabled ? undefined : () => setIsPressed(false),
      onFocus: disabled ? undefined : () => setIsFocused(true),
      onBlur: disabled
        ? undefined
        : () => {
            setIsFocused(false);
            setIsPressed(false);
          },
      onKeyDown: disabled
        ? undefined
        : (event: React.KeyboardEvent<HTMLElement>) => {
            if (!isKeyboardActivationKey(event.key)) {
              return;
            }

            setIsPressed(true);
          },
      onKeyUp: disabled
        ? undefined
        : (event: React.KeyboardEvent<HTMLElement>) => {
            if (!isKeyboardActivationKey(event.key)) {
              return;
            }

            setIsPressed(false);
          },
    },
  };
}

function resolvePartMotionSpec(
  part: ResolvedThemePart,
  channelName: Exclude<PrimitiveInteractionState, 'idle'>,
  fallbackPart?: ResolvedThemePart
): ThemeMotionChannelSpec | undefined {
  return (
    pickThemeMotionChannel(part.motion, [channelName])?.spec ??
    (fallbackPart ? pickThemeMotionChannel(fallbackPart.motion, [channelName])?.spec : undefined)
  );
}

export function resolvePrimitiveInteractionMotion(options: {
  part: ResolvedThemePart;
  interactionState: PrimitiveInteractionState;
  transitionState?: PrimitiveInteractionState;
  fallbackPart?: ResolvedThemePart;
  reducedMotion?: boolean;
}): {
  style?: CSSProperties;
  channel?: Exclude<PrimitiveInteractionState, 'idle'>;
  preset?: string;
} {
  const {
    part,
    interactionState,
    transitionState = interactionState,
    fallbackPart,
    reducedMotion = readThemePrefersReducedMotion(),
  } = options;
  const runtimeChannel =
    interactionState !== 'idle'
      ? interactionState
      : transitionState !== 'idle'
        ? transitionState
        : undefined;

  if (!runtimeChannel) {
    return {};
  }

  const motionSpec = resolvePartMotionSpec(part, runtimeChannel, fallbackPart) ?? DEFAULT_INTERACTION_MOTION[runtimeChannel];
  const transitionStyle = buildThemeMotionTransitionStyle(motionSpec, { disable: reducedMotion });

  return {
    ...(transitionStyle
      ? {
          style: {
            transitionProperty: INTERACTION_TRANSITION_PROPERTIES,
            ...transitionStyle,
          },
        }
      : {}),
    ...(interactionState !== 'idle' ? { channel: runtimeChannel } : {}),
    ...(interactionState !== 'idle' && typeof motionSpec.preset === 'string' ? { preset: motionSpec.preset } : {}),
  };
}
