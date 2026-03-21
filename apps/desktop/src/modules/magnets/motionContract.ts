import type { ThemeBindingMotionCapability, ThemeMotionChannelSpec } from '../../themes/types/theme';
import type { MagnetBounds } from './geometry';

export type MagnetMotionMode = 'full' | 'reduced' | 'off';
export type MagnetLayoutMotionStrategy = 'none' | 'position' | 'transform' | 'flip';

export interface MagnetMotionRuntimeConfig {
  mode: MagnetMotionMode;
  layoutStrategy: MagnetLayoutMotionStrategy;
  largeChange: 'snap' | 'animate';
  sharedKey?: string;
  primaryChannel?: ThemeMotionChannelSpec;
}

const DEFAULT_DURATION_MS = 180;
const DEFAULT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function readPrefersReducedMotion(): boolean {
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

function normalizeDelay(value: string | number | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(0, value)}ms`;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function normalizeEasing(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return DEFAULT_EASING;
}

export function resolveMagnetMotionRuntime(
  lowRenderMode: boolean,
  capability: ThemeBindingMotionCapability | undefined,
  prefersReducedMotion = readPrefersReducedMotion(),
  fallbackPrimaryChannel?: ThemeMotionChannelSpec
): MagnetMotionRuntimeConfig {
  if (lowRenderMode || capability?.enabled === false || capability?.mode === 'off') {
    return {
      mode: 'off',
      layoutStrategy: 'none',
      largeChange: 'snap',
    };
  }

  const mode: MagnetMotionMode =
    capability?.mode === 'reduced' || prefersReducedMotion ? 'reduced' : 'full';
  const requestedStrategy = capability?.layout?.strategy ?? 'position';
  const layoutStrategy: MagnetLayoutMotionStrategy =
    mode === 'reduced'
      ? requestedStrategy === 'none'
        ? 'none'
        : 'position'
      : requestedStrategy;

  return {
    mode,
    layoutStrategy,
    largeChange: mode === 'reduced' ? 'snap' : capability?.layout?.largeChange ?? 'snap',
    ...(typeof capability?.layout?.sharedKey === 'string' && capability.layout.sharedKey.trim().length > 0
      ? { sharedKey: capability.layout.sharedKey.trim() }
      : {}),
    ...(capability?.channels?.layout
      ? { primaryChannel: capability.channels.layout }
      : capability?.channels?.spaceSwitch
        ? { primaryChannel: capability.channels.spaceSwitch }
        : fallbackPrimaryChannel
          ? { primaryChannel: fallbackPrimaryChannel }
        : {}),
  };
}

export function buildMagnetShellTransition(
  runtime: MagnetMotionRuntimeConfig,
  fallbackTransition: string,
  disableTransition: boolean
): string {
  if (runtime.mode === 'off' || runtime.layoutStrategy === 'none' || disableTransition) {
    return 'none';
  }

  if (runtime.layoutStrategy === 'flip' || runtime.layoutStrategy === 'transform') {
    const duration = normalizeDuration(runtime.primaryChannel?.duration);
    const easing = normalizeEasing(runtime.primaryChannel?.easing);
    const delay = normalizeDelay(runtime.primaryChannel?.delay);
    return ['transform', duration, easing, delay].filter(Boolean).join(' ');
  }

  if (!runtime.primaryChannel) {
    return fallbackTransition;
  }

  const duration = normalizeDuration(runtime.primaryChannel.duration);
  const easing = normalizeEasing(runtime.primaryChannel.easing);
  const delay = normalizeDelay(runtime.primaryChannel.delay);
  return [
    `left ${duration} ${easing}${delay ? ` ${delay}` : ''}`,
    `top ${duration} ${easing}${delay ? ` ${delay}` : ''}`,
    `width ${duration} ${easing}${delay ? ` ${delay}` : ''}`,
    `height ${duration} ${easing}${delay ? ` ${delay}` : ''}`,
  ].join(', ');
}

export function buildMagnetLayoutCompensationTransform(
  previousBounds: MagnetBounds,
  nextBounds: MagnetBounds,
  strategy: MagnetLayoutMotionStrategy
): string | null {
  if (strategy !== 'flip' && strategy !== 'transform') {
    return null;
  }

  const deltaX = previousBounds.x - nextBounds.x;
  const deltaY = previousBounds.y - nextBounds.y;

  const transforms: string[] = [];
  if (deltaX !== 0 || deltaY !== 0) {
    transforms.push(`translate(${deltaX}px, ${deltaY}px)`);
  }

  if (strategy === 'flip' && nextBounds.width > 0 && nextBounds.height > 0) {
    const scaleX = previousBounds.width / nextBounds.width;
    const scaleY = previousBounds.height / nextBounds.height;
    if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
      transforms.push(`scale(${scaleX}, ${scaleY})`);
    }
  }

  return transforms.length > 0 ? transforms.join(' ') : null;
}
