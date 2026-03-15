import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { ThemeMotionChannelMap, ThemeMotionChannelSpec } from './types/theme';

export type ThemePresenceMotionPhase = 'closed' | 'enter' | 'idle' | 'exit';

const DEFAULT_DURATION_MS = 180;
const DEFAULT_DISTANCE = '12px';
const DEFAULT_SCALE_FROM = 0.96;
const DEFAULT_SCALE_OUT_FROM = 1.04;
const DEFAULT_SHARED_AXIS_SCALE_FROM = 0.98;

function asNonEmptyString(value: string | number | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

export function readThemePrefersReducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function normalizeDuration(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(0, value)}ms`;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return `${DEFAULT_DURATION_MS}ms`;
}

function normalizeDelay(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(0, value)}ms`;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return '0ms';
}

function normalizeEasing(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return 'cubic-bezier(0.2, 0, 0, 1)';
}

function parseMilliseconds(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  if (normalized.endsWith('ms')) {
    const numeric = Number.parseFloat(normalized.slice(0, -2));
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  if (normalized.endsWith('s')) {
    const numeric = Number.parseFloat(normalized.slice(0, -1));
    return Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : 0;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function normalizeIterationCount(value: number | 'infinite' | undefined): number {
  if (value === 'infinite') {
    return 1;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, value);
  }

  return 1;
}

function resolveScaleFrom(spec: ThemeMotionChannelSpec | undefined): string {
  if (typeof spec?.scale === 'number' && Number.isFinite(spec.scale)) {
    return String(spec.scale);
  }

  switch (spec?.preset) {
    case 'scale-out':
      return String(DEFAULT_SCALE_OUT_FROM);
    case 'shared-axis':
      return String(DEFAULT_SHARED_AXIS_SCALE_FROM);
    default:
      return String(DEFAULT_SCALE_FROM);
  }
}

function resolveMotionRuntimeVariables(
  spec: ThemeMotionChannelSpec | undefined
): CSSProperties | undefined {
  if (!spec) {
    return undefined;
  }

  const runtimeStyle: Record<string, string> = {
    '--pmp-runtime-motion-duration': normalizeDuration(spec.duration),
    '--pmp-runtime-motion-delay': normalizeDelay(spec.delay),
    '--pmp-runtime-motion-easing': normalizeEasing(spec.easing),
    '--pmp-runtime-motion-distance': asNonEmptyString(spec.distance) ?? DEFAULT_DISTANCE,
    '--pmp-runtime-motion-scale-from': resolveScaleFrom(spec),
  };

  if (typeof spec.origin === 'string' && spec.origin.trim().length > 0) {
    runtimeStyle['--pmp-runtime-motion-origin'] = spec.origin.trim();
  }

  return runtimeStyle as CSSProperties;
}

export function pickThemeMotionChannel(
  channels: ThemeMotionChannelMap | undefined,
  names: string[]
): { name: string; spec: ThemeMotionChannelSpec } | undefined {
  if (!channels) {
    return undefined;
  }

  for (const name of names) {
    const spec = channels[name];
    if (spec) {
      return { name, spec };
    }
  }

  return undefined;
}

export function getThemeMotionTotalMs(spec: ThemeMotionChannelSpec | undefined): number {
  if (!spec) {
    return 0;
  }

  const durationMs = parseMilliseconds(spec.duration || DEFAULT_DURATION_MS);
  const delayMs = parseMilliseconds(spec.delay);
  return (durationMs + delayMs) * normalizeIterationCount(spec.iterationCount);
}

function resolvePresenceAnimationName(preset: string | undefined): string | undefined {
  switch (preset) {
    case 'fade':
      return 'pmp-motion-fade';
    case 'fade-up':
    case 'lift-sm':
      return 'pmp-motion-fade-up';
    case 'fade-down':
      return 'pmp-motion-fade-down';
    case 'slide-up':
      return 'pmp-motion-slide-up';
    case 'slide-down':
      return 'pmp-motion-slide-down';
    case 'slide-left':
      return 'pmp-motion-slide-left';
    case 'slide-right':
      return 'pmp-motion-slide-right';
    case 'scale-in':
      return 'pmp-motion-scale-in';
    case 'scale-out':
      return 'pmp-motion-scale-out';
    case 'shared-axis':
      return 'pmp-motion-shared-axis';
    case 'press-sm':
      return 'pmp-motion-press-sm';
    case 'jump-sm':
      return 'pmp-motion-jump-sm';
    case 'flash':
      return 'pmp-motion-flash';
    case 'pulse-soft':
      return 'pmp-motion-pulse-soft';
    default:
      return undefined;
  }
}

export function buildThemePresenceAnimationStyle(
  spec: ThemeMotionChannelSpec | undefined,
  phase: Extract<ThemePresenceMotionPhase, 'enter' | 'exit'>
): CSSProperties | undefined {
  const runtimeVariables = resolveMotionRuntimeVariables(spec);
  if (!runtimeVariables) {
    return undefined;
  }

  const animationName = resolvePresenceAnimationName(spec?.preset);
  if (!animationName) {
    return runtimeVariables;
  }

  const iterationCount = normalizeIterationCount(spec?.iterationCount);

  return {
    ...runtimeVariables,
    animationName,
    animationDuration: normalizeDuration(spec?.duration),
    animationTimingFunction: normalizeEasing(spec?.easing),
    animationDelay: normalizeDelay(spec?.delay),
    animationIterationCount: iterationCount,
    animationFillMode: spec?.fillMode ?? 'both',
    animationPlayState: spec?.playState ?? 'running',
    animationDirection: phase === 'exit' ? 'reverse' : spec?.direction ?? 'normal',
    transformOrigin: asNonEmptyString(spec?.origin) ?? 'var(--pmp-runtime-motion-origin, center)',
  };
}

export function buildThemeMotionTransitionStyle(
  spec: ThemeMotionChannelSpec | undefined,
  options: { disable?: boolean } = {}
): CSSProperties | undefined {
  if (options.disable) {
    return {
      transitionDuration: '0ms',
      transitionDelay: '0ms',
    };
  }

  const runtimeVariables = resolveMotionRuntimeVariables(spec);
  if (!runtimeVariables || !spec) {
    return runtimeVariables;
  }

  return {
    ...runtimeVariables,
    transitionDuration: normalizeDuration(spec.duration),
    transitionTimingFunction: normalizeEasing(spec.easing),
    transitionDelay: normalizeDelay(spec.delay),
  };
}

export function useThemePresenceState(options: {
  open: boolean;
  enterDurationMs?: number;
  exitDurationMs?: number;
  unmountOnExit?: boolean;
  disabled?: boolean;
}): {
  rendered: boolean;
  phase: ThemePresenceMotionPhase;
} {
  const {
    open,
    enterDurationMs = 0,
    exitDurationMs = 0,
    unmountOnExit = true,
    disabled = readThemePrefersReducedMotion(),
  } = options;
  const [rendered, setRendered] = useState(() => (unmountOnExit ? open : true));
  const [phase, setPhase] = useState<ThemePresenceMotionPhase>(() => {
    if (!open) {
      return unmountOnExit ? 'closed' : 'idle';
    }

    return !disabled && enterDurationMs > 0 ? 'enter' : 'idle';
  });
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current === null) {
      return;
    }

    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearTimer, []);

  useEffect(() => {
    clearTimer();

    if (open) {
      if (unmountOnExit) {
        setRendered(true);
      }

      if (disabled || enterDurationMs <= 0) {
        setPhase('idle');
        return;
      }

      setPhase('enter');
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPhase('idle');
      }, enterDurationMs);
      return clearTimer;
    }

    if (disabled || exitDurationMs <= 0) {
      if (unmountOnExit) {
        setRendered(false);
        setPhase('closed');
        return;
      }

      setPhase('idle');
      return;
    }

    setPhase('exit');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (unmountOnExit) {
        setRendered(false);
        setPhase('closed');
        return;
      }

      setPhase('idle');
    }, exitDurationMs);
    return clearTimer;
  }, [disabled, enterDurationMs, exitDurationMs, open, unmountOnExit]);

  return useMemo(
    () => ({
      rendered,
      phase,
    }),
    [phase, rendered]
  );
}
