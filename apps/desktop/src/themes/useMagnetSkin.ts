import { useMemo } from 'react';

import { dynamicColorCapabilityToConfig } from './importAdapters';
import { useTheme } from './contexts/ThemeContextWithSync';
import type { DynamicColorConfig, ThemeBindingId } from './types/theme';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface MagnetSkinModel {
  bindingId: ThemeBindingId;
  rendererId: string;
  variant: string;
  props?: Record<string, unknown>;
  dynamicColor?: DynamicColorConfig;
}

export function useMagnetSkin(
  componentId: string,
  options: {
    defaultRendererId?: string;
    defaultVariant?: string;
  } = {}
): MagnetSkinModel {
  const { defaultRendererId = componentId, defaultVariant = 'default' } = options;
  const { getBinding } = useTheme();
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

    return {
      bindingId,
      rendererId,
      variant,
      ...(props ? { props } : {}),
      ...(dynamicColor ? { dynamicColor } : {}),
    };
  }, [
    binding.capabilities?.dynamicColor,
    binding.props,
    binding.renderer,
    binding.variant,
    bindingId,
    defaultRendererId,
    defaultVariant,
  ]);
}
