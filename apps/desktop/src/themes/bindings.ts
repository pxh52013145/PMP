import type { Theme, ThemeBinding, ThemeBindingId, ThemeSurfaceId } from './types/theme';

export type ResolvedThemeBindingSource = 'binding' | 'surface' | 'none';

export interface ResolvedThemeBinding {
  id: ThemeBindingId;
  binding: ThemeBinding;
  source: ResolvedThemeBindingSource;
}

function normalizeSurfaceId(value: unknown): ThemeSurfaceId | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? (normalized as ThemeSurfaceId) : undefined;
}

export function resolveThemeBinding(theme: Theme, bindingId: ThemeBindingId): ResolvedThemeBinding {
  const directBinding = theme.bindings?.[bindingId];
  if (directBinding) {
    return {
      id: bindingId,
      binding: directBinding,
      source: 'binding',
    };
  }

  if (theme.surfaces?.[bindingId]) {
    return {
      id: bindingId,
      binding: { surface: bindingId },
      source: 'surface',
    };
  }

  return {
    id: bindingId,
    binding: {},
    source: 'none',
  };
}

export function resolveThemeSurfaceTargetId(
  theme: Theme,
  bindingId: ThemeBindingId | ThemeSurfaceId
): ThemeSurfaceId | undefined {
  const normalizedId = bindingId as ThemeBindingId;
  const resolvedBinding = resolveThemeBinding(theme, normalizedId);
  const explicitSurfaceId = normalizeSurfaceId(resolvedBinding.binding.surface);
  if (explicitSurfaceId) {
    return explicitSurfaceId;
  }

  if (theme.surfaces?.[normalizedId]) {
    return normalizedId;
  }

  const directSurfaceId = normalizeSurfaceId(bindingId);
  if (directSurfaceId && theme.surfaces?.[directSurfaceId]) {
    return directSurfaceId;
  }

  return directSurfaceId;
}

export function assignThemeBinding(theme: Theme, bindingId: ThemeBindingId, binding: ThemeBinding): Theme {
  return {
    ...theme,
    bindings: {
      ...theme.bindings,
      [bindingId]: binding,
    },
  };
}

function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).length > 0;
}

function hasMeaningfulDynamicColorCapability(value: unknown): boolean {
  if (!hasOwnKeys(value)) {
    return false;
  }

  return (
    typeof value.enabled === 'boolean' ||
    (typeof value.source === 'string' && value.source.trim().length > 0) ||
    (typeof value.mode === 'string' && value.mode.trim().length > 0) ||
    (typeof value.apply === 'string' && value.apply.trim().length > 0) ||
    typeof value.blendRatio === 'number' ||
    typeof value.gradientAngle === 'number' ||
    typeof value.dynamicSpeed === 'number' ||
    hasOwnKeys(value.colorAdjust)
  );
}

function hasMeaningfulBindingCapabilities(value: unknown): boolean {
  if (!hasOwnKeys(value)) {
    return false;
  }

  return hasMeaningfulDynamicColorCapability(value.dynamicColor);
}

function hasMeaningfulBindingMotion(value: unknown): boolean {
  if (!hasOwnKeys(value)) {
    return false;
  }

  return (
    typeof value.enabled === 'boolean' ||
    (typeof value.mode === 'string' && value.mode.trim().length > 0) ||
    hasOwnKeys(value.presence) ||
    hasOwnKeys(value.layout) ||
    hasOwnKeys(value.attention) ||
    hasOwnKeys(value.visibility)
  );
}

export function isThemeBindingEmpty(binding: ThemeBinding | null | undefined): boolean {
  if (!binding) {
    return true;
  }

  return (
    !normalizeSurfaceId(binding.surface) &&
    !(typeof binding.renderer === 'string' && binding.renderer.trim().length > 0) &&
    !(typeof binding.variant === 'string' && binding.variant.trim().length > 0) &&
    !hasOwnKeys(binding.props) &&
    !hasMeaningfulBindingMotion(binding.motion) &&
    !hasMeaningfulBindingCapabilities(binding.capabilities)
  );
}

export function removeThemeBinding(theme: Theme, bindingId: ThemeBindingId): Theme {
  if (!theme.bindings?.[bindingId]) {
    return theme;
  }

  const nextBindings = { ...theme.bindings };
  delete nextBindings[bindingId];

  return {
    ...theme,
    ...(Object.keys(nextBindings).length > 0 ? { bindings: nextBindings } : { bindings: undefined }),
  };
}
