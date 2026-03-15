import { assignThemeBinding, isThemeBindingEmpty, removeThemeBinding, resolveThemeBinding } from './bindings';
import { mergeComponentThemes } from './mergeComponentTheme';
import { assignThemeSurface, isComponentThemeEmpty, removeThemeSurface, resolveThemeSurface } from './surfaces';
import type {
  ComponentTheme,
  DynamicColorConfig,
  Theme,
  ThemeBinding,
  ThemeBindingDynamicColorCapability,
  ThemeBindingId,
  ThemePartStateSpec,
  ThemeSurfacePartSpec,
  ThemeSurfaceStateSpec,
} from './types/theme';
import type { ThemeImportSurfaceSpec } from './types/themeImport';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

export function dynamicColorConfigToCapability(
  config: DynamicColorConfig | undefined
): ThemeBindingDynamicColorCapability | undefined {
  if (!config) {
    return undefined;
  }

  const hasExplicitFields =
    typeof config.extractFromCover === 'boolean' ||
    typeof config.effect === 'string' ||
    typeof config.applyMode === 'string' ||
    typeof config.blendRatio === 'number' ||
    typeof config.gradientAngle === 'number' ||
    typeof config.dynamicSpeed === 'number' ||
    Boolean(config.colorAdjust);
  if (!hasExplicitFields) {
    return undefined;
  }

  const capability: ThemeBindingDynamicColorCapability = {
    ...(typeof config.extractFromCover === 'boolean' ? { enabled: config.extractFromCover } : {}),
    source: 'cover',
    ...(typeof config.effect === 'string' ? { mode: config.effect } : {}),
    ...(typeof config.applyMode === 'string' ? { apply: config.applyMode } : {}),
    ...(typeof config.blendRatio === 'number' ? { blendRatio: config.blendRatio } : {}),
    ...(typeof config.gradientAngle === 'number' ? { gradientAngle: config.gradientAngle } : {}),
    ...(typeof config.dynamicSpeed === 'number' ? { dynamicSpeed: config.dynamicSpeed } : {}),
    ...(config.colorAdjust ? { colorAdjust: { ...config.colorAdjust } } : {}),
  };

  return Object.keys(capability).length > 0 ? capability : undefined;
}

export function dynamicColorCapabilityToConfig(
  capability: ThemeBindingDynamicColorCapability | undefined
): DynamicColorConfig | undefined {
  if (!capability) {
    return undefined;
  }

  const config: DynamicColorConfig = {
    ...(typeof capability.enabled === 'boolean' ? { extractFromCover: capability.enabled } : {}),
    ...(typeof capability.mode === 'string' ? { effect: capability.mode } : {}),
    ...(typeof capability.gradientAngle === 'number' ? { gradientAngle: capability.gradientAngle } : {}),
    ...(typeof capability.dynamicSpeed === 'number' ? { dynamicSpeed: capability.dynamicSpeed } : {}),
    ...(typeof capability.apply === 'string' ? { applyMode: capability.apply } : {}),
    ...(typeof capability.blendRatio === 'number' ? { blendRatio: capability.blendRatio } : {}),
    ...(capability.colorAdjust ? { colorAdjust: { ...capability.colorAdjust } } : {}),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

function legacyPartName(key: string): string {
  return key === 'container' ? 'root' : key;
}

function toClassList(value: string | undefined): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const classList = value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return classList.length > 0 ? classList : undefined;
}

function mergeLegacyPartSpec(
  partSpec: ThemeSurfacePartSpec | undefined,
  className: string | undefined,
  style: Record<string, unknown> | undefined
): ThemeSurfacePartSpec | undefined {
  const classes = toClassList(className);
  if (!partSpec && !classes && !isPlainObject(style)) {
    return undefined;
  }

  return {
    ...(partSpec ?? {}),
    ...(classes?.length ? { classes: [...new Set([...(partSpec?.classes ?? []), ...classes])] } : {}),
    ...(isPlainObject(style)
      ? {
          style: {
            ...(isPlainObject(partSpec?.style) ? partSpec.style : {}),
            ...style,
          },
        }
      : {}),
  };
}

function normalizeLegacyParts(surfaceSpec: ThemeImportSurfaceSpec): ThemeImportSurfaceSpec {
  const { classNameOverride, styleOverride, ...rest } = surfaceSpec;
  if (!classNameOverride && !styleOverride) {
    return surfaceSpec;
  }

  const keys = new Set<string>([...Object.keys(classNameOverride ?? {}), ...Object.keys(styleOverride ?? {})]);
  const parts = { ...(rest.parts ?? {}) };

  for (const key of keys) {
    const partName = legacyPartName(key);
    parts[partName] = mergeLegacyPartSpec(
      parts[partName],
      classNameOverride?.[key],
      isPlainObject(styleOverride?.[key]) ? (styleOverride?.[key] as Record<string, unknown>) : undefined
    ) as ThemeSurfacePartSpec;
  }

  return {
    ...rest,
    ...(Object.keys(parts).length > 0 ? { parts } : {}),
  };
}

function normalizeSurfaceStates(surfaceSpec: ThemeImportSurfaceSpec): ThemeImportSurfaceSpec {
  if (!surfaceSpec.states) {
    return surfaceSpec;
  }

  const states = Object.fromEntries(
    Object.entries(surfaceSpec.states)
      .map(([stateName, stateSpec]) => {
        if (!stateSpec) {
          return null;
        }

        const nextParts = Object.fromEntries(
          Object.entries(stateSpec.parts ?? {})
            .map(([partName, partSpec]) => [partName, partSpec])
            .filter((entry): entry is [string, ThemePartStateSpec] => Boolean(entry[1]))
        );

        const nextState: ThemeSurfaceStateSpec = {
          ...(stateSpec.classes?.length ? { classes: [...stateSpec.classes] } : {}),
          ...(isPlainObject(stateSpec.style) ? { style: { ...stateSpec.style } } : {}),
          ...(isPlainObject(stateSpec.tokens) ? { tokens: { ...stateSpec.tokens } } : {}),
          ...(Object.keys(nextParts).length > 0 ? { parts: nextParts } : {}),
        };

        return [stateName, nextState];
      })
      .filter((entry): entry is [string, ThemeSurfaceStateSpec] => Boolean(entry))
  );

  return {
    ...surfaceSpec,
    ...(Object.keys(states).length > 0 ? { states } : { states: undefined }),
  };
}

export function normalizeThemeImportSurfaceSpec(surfaceSpec: ThemeImportSurfaceSpec): ThemeImportSurfaceSpec {
  return normalizeSurfaceStates(normalizeLegacyParts(surfaceSpec));
}

export function mergeThemeImportSurfaceSpecs(
  ...surfaceSpecs: Array<ThemeImportSurfaceSpec | ComponentTheme | null | undefined>
): ThemeImportSurfaceSpec {
  return surfaceSpecs.reduce<ThemeImportSurfaceSpec>((acc, surfaceSpec) => {
    if (!surfaceSpec) {
      return acc;
    }

    const mergedSurface = mergeComponentThemes(acc, surfaceSpec as ComponentTheme);
    const nextVariantConfig =
      hasOwnKeys((acc as ThemeImportSurfaceSpec).variantConfig) || hasOwnKeys((surfaceSpec as ThemeImportSurfaceSpec).variantConfig)
        ? {
            ...(hasOwnKeys((acc as ThemeImportSurfaceSpec).variantConfig)
              ? ((acc as ThemeImportSurfaceSpec).variantConfig as Record<string, unknown>)
              : {}),
            ...(hasOwnKeys((surfaceSpec as ThemeImportSurfaceSpec).variantConfig)
              ? (((surfaceSpec as ThemeImportSurfaceSpec).variantConfig as Record<string, unknown>) ?? {})
              : {}),
          }
        : undefined;
    const nextStyleOverride =
      hasOwnKeys((acc as ThemeImportSurfaceSpec).styleOverride) || hasOwnKeys((surfaceSpec as ThemeImportSurfaceSpec).styleOverride)
        ? {
            ...((acc as ThemeImportSurfaceSpec).styleOverride ?? {}),
            ...((surfaceSpec as ThemeImportSurfaceSpec).styleOverride ?? {}),
          }
        : undefined;
    const nextClassNameOverride =
      hasOwnKeys((acc as ThemeImportSurfaceSpec).classNameOverride) ||
      hasOwnKeys((surfaceSpec as ThemeImportSurfaceSpec).classNameOverride)
        ? {
            ...((acc as ThemeImportSurfaceSpec).classNameOverride ?? {}),
            ...((surfaceSpec as ThemeImportSurfaceSpec).classNameOverride ?? {}),
          }
        : undefined;
    const nextDynamicColor = (surfaceSpec as ThemeImportSurfaceSpec).dynamicColor
      ? {
          ...((acc as ThemeImportSurfaceSpec).dynamicColor ?? {}),
          ...(surfaceSpec as ThemeImportSurfaceSpec).dynamicColor,
        }
      : (acc as ThemeImportSurfaceSpec).dynamicColor;

    return {
      ...mergedSurface,
      ...(nextVariantConfig ? { variantConfig: nextVariantConfig } : {}),
      ...(nextStyleOverride ? { styleOverride: nextStyleOverride } : {}),
      ...(nextClassNameOverride ? { classNameOverride: nextClassNameOverride } : {}),
      ...(nextDynamicColor ? { dynamicColor: nextDynamicColor } : {}),
    };
  }, {});
}

export function importSurfaceToBinding(surfaceSpec: ThemeImportSurfaceSpec): ThemeBinding {
  const dynamicColorCapability = dynamicColorConfigToCapability(surfaceSpec.dynamicColor);

  return {
    ...(typeof surfaceSpec.variant === 'string' ? { variant: surfaceSpec.variant } : {}),
    ...(hasOwnKeys(surfaceSpec.variantConfig) ? { props: { ...surfaceSpec.variantConfig } } : {}),
    ...(dynamicColorCapability
      ? {
          capabilities: {
            dynamicColor: dynamicColorCapability,
          },
        }
      : {}),
  };
}

export function bindingToImportSurfaceSpec(binding: ThemeBinding): ThemeImportSurfaceSpec {
  const dynamicColor = dynamicColorCapabilityToConfig(binding.capabilities?.dynamicColor);
  const props = hasOwnKeys(binding.props) ? binding.props : undefined;

  return {
    ...(typeof binding.variant === 'string' ? { variant: binding.variant } : {}),
    ...(props ? { variantConfig: { ...props } } : {}),
    ...(dynamicColor ? { dynamicColor } : {}),
  };
}

export function extractRuntimeSurfaceDocument(surfaceSpec: ThemeImportSurfaceSpec): ComponentTheme {
  const { variantConfig, dynamicColor, styleOverride, classNameOverride, ...surfaceTheme } = surfaceSpec;
  void variantConfig;
  void dynamicColor;
  void styleOverride;
  void classNameOverride;
  return surfaceTheme;
}

export function extractMagnetSurfaceDocument(surfaceSpec: ThemeImportSurfaceSpec): ComponentTheme {
  const { variant, ...surfaceTheme } = extractRuntimeSurfaceDocument(surfaceSpec);
  void variant;
  return surfaceTheme;
}

export function materializeThemeBinding(theme: Theme, bindingId: ThemeBindingId): ThemeImportSurfaceSpec {
  const resolvedBinding = resolveThemeBinding(theme, bindingId);
  const surfaceId = resolvedBinding.binding.surface ?? bindingId;
  const surfaceTheme = resolveThemeSurface(theme, surfaceId);
  const bindingTheme = bindingToImportSurfaceSpec(resolvedBinding.binding);

  return mergeThemeImportSurfaceSpecs(surfaceTheme, bindingTheme);
}

export function assignMagnetComponentTheme(
  theme: Theme,
  componentId: string,
  componentTheme: ThemeImportSurfaceSpec
): Theme {
  const bindingId = `magnet.${componentId}` as ThemeBindingId;
  const normalizedTheme = normalizeThemeImportSurfaceSpec(componentTheme);
  const currentBinding = resolveThemeBinding(theme, bindingId).binding;
  const nextBinding: ThemeBinding = {
    ...currentBinding,
    ...importSurfaceToBinding(normalizedTheme),
  };
  delete nextBinding.surface;
  const surfaceTheme = extractMagnetSurfaceDocument(normalizedTheme);
  const nextTheme = isComponentThemeEmpty(surfaceTheme)
    ? removeThemeSurface(theme, bindingId)
    : assignThemeSurface(theme, bindingId, surfaceTheme);

  return isThemeBindingEmpty(nextBinding)
    ? removeThemeBinding(nextTheme, bindingId)
    : assignThemeBinding(nextTheme, bindingId, nextBinding);
}
