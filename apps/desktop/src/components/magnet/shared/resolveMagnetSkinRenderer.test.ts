import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import type { MagnetSkinModel } from '../../../themes/useMagnetSkin';
import { resolveMagnetSkinRenderer } from './resolveMagnetSkinRenderer';

const DefaultRenderer = (() => null) as ComponentType;
const CompactRenderer = (() => null) as ComponentType;
const ExplicitRenderer = (() => null) as ComponentType;

function createSkin(overrides: Partial<MagnetSkinModel> = {}): MagnetSkinModel {
  return {
    bindingId: 'magnet.demo',
    rendererId: 'default',
    variant: 'default',
    ...overrides,
  };
}

describe('resolveMagnetSkinRenderer', () => {
  const renderers = {
    default: DefaultRenderer,
    compact: CompactRenderer,
    explicit: ExplicitRenderer,
  };

  it('selects the variant when the renderer id is the default fallback', () => {
    const renderer = resolveMagnetSkinRenderer(
      createSkin({ variant: 'compact' }),
      renderers,
      'default'
    );

    expect(renderer).toBe(CompactRenderer);
  });

  it('keeps an explicitly selected renderer ahead of the variant', () => {
    const renderer = resolveMagnetSkinRenderer(
      createSkin({ rendererId: 'explicit', variant: 'compact' }),
      renderers,
      'default'
    );

    expect(renderer).toBe(ExplicitRenderer);
  });
});
