import { describe, expect, it } from 'vitest';

import { normalizeTheme } from '../normalizeTheme';
import type { ThemeImportCandidate } from '../types/theme';

describe('normalizeTheme', () => {
  it('removes legacy shader metadata and migrates componentThemes into surfaces', () => {
    const input = {
      id: 'theme-default',
      name: 'Default Theme',
      version: '1.0.0',
      shader: {
        id: 'legacy-shader',
        name: 'Legacy Shader',
      },
      pixel: {
        shape: 'circle',
        size: 1,
        opacity: 1,
        colors: {
          default: { slot: 'primary', alpha: 0.6 },
          hover: { slot: 'accent', state: 'hover' },
          active: { slot: 'primary', state: 'active' },
          occupied: { slot: 'secondary', alpha: 0.3 },
        },
      },
      background: {
        maximized: {
          type: 'color',
          color: '#000000',
        },
        windowed: {
          type: 'color',
          color: '#111111',
        },
      },
      fonts: {
        primary: 'Inter, sans-serif',
      },
      componentThemes: {
        'track-info': {
          variant: 'spinning-vinyl',
        },
        'play-pause-button': {
          variant: 'pill',
        },
      },
      surfaces: {
        'magnet.track-info': {
          styleOverride: {
            container: {
              opacity: 0.9,
            },
          },
        },
      },
      bindings: {
        'page.settings': {
          surface: 'page.settings.glass',
          variant: 'glass',
        },
      },
    } as ThemeImportCandidate;

    const normalized = normalizeTheme(input);

    expect(normalized).not.toHaveProperty('shader');
    expect(normalized).not.toHaveProperty('componentThemes');
    expect(normalized.surfaces?.['magnet.track-info']?.variant).toBe('spinning-vinyl');
    expect(normalized.surfaces?.['magnet.track-info']?.styleOverride?.container?.opacity).toBe(0.9);
    expect(normalized.surfaces?.['magnet.btn-play-pause']?.variant).toBe('pill');
    expect(normalized.bindings?.['page.settings']?.surface).toBe('page.settings.glass');
    expect(normalized.pixel.colors.default.slot).toBe('primary');
  });
});
