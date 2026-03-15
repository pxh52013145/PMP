import { describe, expect, it } from 'vitest';

import { normalizeTheme } from '../normalizeTheme';
import type { ThemeImportCandidate } from '../types/themeImport';

describe('normalizeTheme', () => {
  it('removes legacy shader metadata and migrates legacy theme fields into tokens, surfaces, and bindings', () => {
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
      colors: {
        'bg.canvas': '#101010',
      },
      motion: {
        'duration.fast': 120,
      },
      typography: {
        'font.body': 'Inter',
      },
      componentThemes: {
        'track-info': {
          variant: 'spinning-vinyl',
          variantConfig: {
            layout: 'full',
          },
          dynamicColor: {
            extractFromCover: true,
            effect: 'gradient',
          },
          motionConfig: {
            enabled: true,
            mode: 'full',
            channels: {
              spaceSwitch: {
                preset: 'shared-axis',
                duration: 220,
              },
            },
          },
        },
        'play-pause-button': {
          variant: 'pill',
        },
      },
      surfaces: {
        'magnet.track-info': {
          parts: {
            root: {
              motion: {
                hover: {
                  preset: 'lift-sm',
                  duration: 140,
                },
              },
            },
          },
          styleOverride: {
            container: {
              opacity: 0.9,
            },
          },
        },
        'page.settings': {
          classNameOverride: {
            container: 'page-settings-glass',
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
    expect(normalized.tokens?.color?.['bg.canvas']).toBe('#101010');
    expect(normalized.tokens?.motion?.['duration.fast']).toBe(120);
    expect(normalized.tokens?.typography?.['font.body']).toBe('Inter');
    expect(normalized.bindings?.['magnet.track-info']?.surface).toBeUndefined();
    expect(normalized.bindings?.['magnet.track-info']?.variant).toBe('spinning-vinyl');
    expect(normalized.bindings?.['magnet.track-info']?.props?.layout).toBe('full');
    expect(normalized.bindings?.['magnet.track-info']?.capabilities?.dynamicColor?.enabled).toBe(true);
    expect(normalized.bindings?.['magnet.track-info']?.capabilities?.dynamicColor?.mode).toBe('gradient');
    expect(normalized.bindings?.['magnet.track-info']?.capabilities?.motion?.enabled).toBe(true);
    expect(normalized.bindings?.['magnet.track-info']?.capabilities?.motion?.channels?.spaceSwitch?.preset).toBe('shared-axis');
    expect(normalized.surfaces?.['magnet.track-info']?.parts?.root?.style?.opacity).toBe(0.9);
    expect(normalized.surfaces?.['magnet.track-info']?.parts?.root?.motion?.hover?.preset).toBe('lift-sm');
    expect(normalized.surfaces?.['magnet.track-info']?.variant).toBeUndefined();
    expect(normalized.surfaces?.['magnet.btn-play-pause']?.parts).toBeUndefined();
    expect(normalized.bindings?.['magnet.btn-play-pause']?.variant).toBe('pill');
    expect(normalized.surfaces?.['page.settings']?.parts?.root?.classes).toContain('page-settings-glass');
    expect(normalized.bindings?.['page.settings']?.surface).toBe('page.settings.glass');
    expect(normalized.pixel.colors.default.slot).toBe('primary');
  });
});
