import { createElement, type ComponentType } from 'react';

import type { MagnetVariantDefinition } from '../../../magnet-system/variantRegistry';

export interface MagnetVariantPreset<TProps extends object> {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  props?: Partial<TProps>;
  metadata?: Record<string, unknown>;
}

export function buildMagnetVariantRenderers<TRendererProps extends { skinProps?: Record<string, unknown> }>(
  defaultRenderer: ComponentType<TRendererProps>,
  presets: readonly MagnetVariantPreset<object>[]
): Record<string, ComponentType<TRendererProps>> {
  const renderers: Record<string, ComponentType<TRendererProps>> = {
    default: defaultRenderer,
  };

  for (const preset of presets) {
    if (preset.id === 'default') continue;

    const VariantRenderer = (props: TRendererProps) =>
      createElement(defaultRenderer, {
        ...props,
        skinProps: {
          ...(preset.props ?? {}),
          ...(props.skinProps ?? {}),
        },
      });

    VariantRenderer.displayName = `MagnetVariant(${preset.id})`;
    renderers[preset.id] = VariantRenderer;
  }

  return renderers;
}

export function toMagnetVariantDefinitions<TProps extends object>(
  presets: readonly MagnetVariantPreset<TProps>[],
  translate: (key: string) => string,
  source: MagnetVariantDefinition['source'] = 'builtin'
): MagnetVariantDefinition[] {
  return presets.map((preset) => ({
    id: preset.id,
    label: translate(preset.labelKey),
    description: preset.descriptionKey ? translate(preset.descriptionKey) : undefined,
    source,
    metadata: {
      ...(preset.props ? { props: preset.props } : {}),
      ...(preset.metadata ?? {}),
    },
  }));
}
