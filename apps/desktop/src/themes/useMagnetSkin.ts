import { useMemo } from 'react';

import { dynamicColorCapabilityToConfig } from './importAdapters';
import { useTheme } from './contexts/ThemeContextWithSync';
import { resolveThemeMotionCapability } from './motion';
import type { DynamicColorConfig, ThemeBindingId, ThemeBindingMotionCapability } from './types/theme';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface MagnetSkinModel {
  bindingId: ThemeBindingId;
  rendererId: string;
  variant: string;
  props?: Record<string, unknown>;
  dynamicColor?: DynamicColorConfig;
  motion?: ThemeBindingMotionCapability;
}

export function useMagnetSkin(
  componentId: string,
  options: {
    defaultRendererId?: string;
    defaultVariant?: string;
  } = {}
): MagnetSkinModel {
  const { defaultRendererId = componentId, defaultVariant = 'default' } = options;
  const { theme, getBinding } = useTheme();
  const bindingId = `magnet.${componentId}` as ThemeBindingId;
  const binding = getBinding(bindingId);

  return useMemo(() => {
    const rendererId =
      typeof binding.renderer === 'string' && binding.renderer.trim().length > 0
        ? binding.renderer.trim()
        : defaultRendererId;
    const variant =
      typeof binding.variant === 'string' && binding.variant.trim().length > 0
        ? binding.variant.trim()
        : defaultVariant;
    const props = isPlainObject(binding.props) ? binding.props : undefined;
    const dynamicColor = dynamicColorCapabilityToConfig(binding.capabilities?.dynamicColor);
    const motion = resolveThemeMotionCapability(
      theme,
      isPlainObject(binding.capabilities?.motion)
        ? (binding.capabilities?.motion as ThemeBindingMotionCapability)
        : undefined
    );

    return {
      bindingId,
      rendererId,
      variant,
      ...(props ? { props } : {}),
      ...(dynamicColor ? { dynamicColor } : {}),
      ...(motion ? { motion } : {}),
    };
  }, [
    binding.capabilities?.dynamicColor,
    binding.capabilities?.motion,
    binding.props,
    binding.renderer,
    binding.variant,
    bindingId,
    defaultRendererId,
    defaultVariant,
    theme,
  ]);
}
