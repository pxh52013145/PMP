import { createContext, useContext, useMemo } from 'react';

import { dynamicColorCapabilityToConfig } from './importAdapters';
import { useTheme } from './contexts/ThemeContextWithSync';
import { resolveThemeBindingMotion } from './motion';
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

export interface MagnetSkinInstanceDefaults {
  magnetId: string;
  rendererId?: string;
  variant?: string;
  props?: Record<string, unknown>;
}

const MagnetSkinInstanceDefaultsContext = createContext<MagnetSkinInstanceDefaults | null>(null);

export const MagnetSkinInstanceDefaultsProvider = MagnetSkinInstanceDefaultsContext.Provider;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function matchesInstanceDefaults(
  defaults: MagnetSkinInstanceDefaults | null,
  componentId: string,
  rendererId: string
): defaults is MagnetSkinInstanceDefaults {
  if (!defaults) return false;
  const ids = [defaults.magnetId, defaults.rendererId].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
  return ids.includes(componentId) || ids.includes(rendererId);
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
  const instanceDefaults = useContext(MagnetSkinInstanceDefaultsContext);
  const bindingId = `magnet.${componentId}` as ThemeBindingId;
  const binding = getBinding(bindingId);

  return useMemo(() => {
    const hasInstanceDefaults = matchesInstanceDefaults(
      instanceDefaults,
      componentId,
      defaultRendererId
    );
    const rendererId =
      typeof binding.renderer === 'string' && binding.renderer.trim().length > 0
        ? binding.renderer.trim()
        : defaultRendererId;
    const bindingVariant = readNonEmptyString(binding.variant);
    const instanceVariant = hasInstanceDefaults
      ? readNonEmptyString(instanceDefaults.variant)
      : null;
    const variant = instanceVariant ?? bindingVariant ?? defaultVariant;
    const bindingProps = isPlainObject(binding.props) ? binding.props : undefined;
    const instanceProps =
      hasInstanceDefaults && isPlainObject(instanceDefaults.props)
        ? instanceDefaults.props
        : undefined;
    const props =
      bindingProps || instanceProps
        ? {
            ...(bindingProps ?? {}),
            ...(instanceProps ?? {}),
          }
        : undefined;
    const dynamicColor = dynamicColorCapabilityToConfig(binding.capabilities?.dynamicColor);
    const motion = resolveThemeBindingMotion(theme, binding.motion);

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
    binding.motion,
    binding.props,
    binding.renderer,
    binding.variant,
    bindingId,
    componentId,
    defaultRendererId,
    defaultVariant,
    instanceDefaults,
    theme,
  ]);
}
