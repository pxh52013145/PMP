import type { MagnetAnimation, MagnetChromeConfig, MagnetStyle } from '../../types/pixel';
import type { MagnetChromeOverrideMode } from './chromeOverride';
import { DEFAULT_MAGNET_TRANSITION } from './chromePresets';

export interface MagnetInteractiveFlags {
  isHovering: boolean;
  isActive: boolean;
  isDragging: boolean;
}

export type MagnetInteractionState = 'idle' | 'hover' | 'active' | 'dragging';

export function resolveMagnetInteractionState({
  isHovering,
  isActive,
  isDragging,
}: MagnetInteractiveFlags): MagnetInteractionState {
  if (isDragging) return 'dragging';
  if (isActive) return 'active';
  if (isHovering) return 'hover';
  return 'idle';
}

export function resolveMagnetCurrentStyle(
  baseStyle: MagnetStyle,
  animation: MagnetAnimation | undefined,
  flags: MagnetInteractiveFlags
): MagnetStyle {
  if (!animation) {
    return baseStyle;
  }

  let nextStyle = baseStyle;

  if (flags.isHovering && animation.hoverStyle) {
    nextStyle = { ...nextStyle, ...animation.hoverStyle };
  }

  if (flags.isActive && animation.activeStyle) {
    nextStyle = { ...nextStyle, ...animation.activeStyle };
  }

  if (flags.isDragging && animation.dragStyle) {
    nextStyle = { ...nextStyle, ...animation.dragStyle };
  }

  return nextStyle;
}

export function resolveMagnetTransitionValue(
  lowRenderMode: boolean,
  disableTransition: boolean,
  animationTransition: string | undefined
): string {
  if (lowRenderMode || disableTransition) return 'none';
  return animationTransition || DEFAULT_MAGNET_TRANSITION;
}

export function resolveMagnetChromeEnabled(
  chrome: MagnetChromeConfig | undefined,
  chromeOverrideMode: MagnetChromeOverrideMode | undefined
): boolean {
  if (chromeOverrideMode === 'force-on') return true;
  if (chromeOverrideMode === 'force-off') return false;
  return chrome?.enabled !== false;
}

export function normalizeMagnetOpacity(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return undefined;
}

export function toOpaqueMagnetColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return value;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 4) return `#${hex.slice(0, 3)}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}`;
    return normalized;
  }

  const rgbaMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbaMatch) return value;

  const channels = rgbaMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (channels.length < 3) return value;
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

export function extractMagnetBorderStroke(
  value: string | undefined
): { width: string; color: string } | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const match = normalized.match(/^([0-9.]+px)\s+\S+\s+(.+)$/);
  if (!match) return null;

  return {
    width: match[1],
    color: match[2].trim(),
  };
}
