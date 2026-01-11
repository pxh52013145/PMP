import { describe, expect, it } from 'vitest';

import { parseVariantPresetFromText } from '../pmpv';

describe('.pmpv variant preset', () => {
  it('parses valid v1 preset', () => {
    const preset = parseVariantPresetFromText(
      JSON.stringify({
        formatVersion: '1.0',
        type: 'variant-preset',
        metadata: { id: 'track-info-card', name: 'Card', version: '1.0.0' },
        target: { rendererId: 'track-info' },
        componentTheme: { variant: 'card', variantConfig: { rounded: true } },
      })
    );

    expect(preset.target.rendererId).toBe('track-info');
    expect(preset.componentTheme.variant).toBe('card');
  });

  it('rejects missing metadata.id', () => {
    expect(() =>
      parseVariantPresetFromText(
        JSON.stringify({
          formatVersion: '1.0',
          type: 'variant-preset',
          metadata: { name: 'Card', version: '1.0.0' },
          target: { rendererId: 'track-info' },
          componentTheme: {},
        })
      )
    ).toThrow(/metadata\.id/);
  });

  it('rejects invalid componentTheme', () => {
    expect(() =>
      parseVariantPresetFromText(
        JSON.stringify({
          formatVersion: '1.0',
          type: 'variant-preset',
          metadata: { id: 'x', name: 'X', version: '1.0.0' },
          target: { rendererId: 'track-info' },
          componentTheme: 'nope',
        })
      )
    ).toThrow(/componentTheme/);
  });
});

