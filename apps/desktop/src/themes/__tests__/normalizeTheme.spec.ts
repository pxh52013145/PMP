import { describe, expect, it } from 'vitest';

import { normalizeTheme } from '../normalizeTheme';
import type { ThemeImportCandidate } from '../types/themeImport';

describe('normalizeTheme', () => {
  it('preserves new schema bindings, surfaces, and motion documents', () => {
    const input: ThemeImportCandidate = {
      id: 'theme-default',
      name: 'Default Theme',
      version: '1.0.0',
      tokens: {
        color: {
          'bg.canvas': '#101010',
        },
        motion: {
          'duration.fast': 120,
        },
        typography: {
          'font.body': 'Inter',
        },
      },
      motion: {
        presets: {
          'enter.fade-up': {
            preset: 'fade-up',
            duration: 180,
          },
        },
        scenes: {
          appBoot: {
            enter: 'enter.fade-up',
            stagger: {
              by: 'grid',
              step: 18,
            },
          },
        },
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
      surfaces: {
        'magnet.track-info': {
          parts: {
            root: {
              style: {
                opacity: 0.9,
              },
              motion: {
                hover: {
                  preset: 'lift-sm',
                  duration: 140,
                },
              },
            },
          },
        },
        'page.settings': {
          parts: {
            root: {
              classes: ['page-settings-glass'],
            },
          },
        },
      },
      bindings: {
        'page.settings': {
          surface: 'page.settings.glass',
          variant: 'glass',
        },
        'magnet.track-info': {
          variant: 'spinning-vinyl',
          props: {
            layout: 'full',
          },
          capabilities: {
            dynamicColor: {
              enabled: true,
              source: 'cover',
              mode: 'gradient',
            },
          },
          motion: {
            enabled: true,
            layout: {
              strategy: 'flip',
              move: {
                preset: 'shared-axis',
                duration: 220,
              },
            },
          },
        },
      },
    };

    const normalized = normalizeTheme(input);

    expect(normalized.tokens?.color?.['bg.canvas']).toBe('#101010');
    expect(normalized.tokens?.motion?.['duration.fast']).toBe(120);
    expect(normalized.tokens?.typography?.['font.body']).toBe('Inter');
    expect(normalized.motion?.presets?.['enter.fade-up']?.preset).toBe('fade-up');
    expect(normalized.motion?.scenes?.appBoot?.enter).toBe('enter.fade-up');
    expect(normalized.bindings?.['magnet.track-info']?.variant).toBe('spinning-vinyl');
    expect(normalized.bindings?.['magnet.track-info']?.props?.layout).toBe('full');
    expect(normalized.bindings?.['magnet.track-info']?.capabilities?.dynamicColor?.enabled).toBe(true);
    expect(normalized.bindings?.['magnet.track-info']?.motion?.layout?.strategy).toBe('flip');
    expect(normalized.surfaces?.['magnet.track-info']?.parts?.root?.style?.opacity).toBe(0.9);
    expect(normalized.surfaces?.['page.settings']?.parts?.root?.classes).toContain('page-settings-glass');
  });

  it('drops unsupported payload fields instead of preserving them', () => {
    const input = {
      id: 'theme-default',
      name: 'Default Theme',
      version: '1.0.0',
      unexpectedRoot: {
        enabled: true,
      },
      tokens: {
        unsupportedBucket: {
          value: '#101010',
        },
      },
      motion: {
        unsupportedScene: {
          preset: 'fade-up',
        },
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
      surfaces: {
        'magnet.track-info': {
          unsupportedSurfaceField: {
            container: {
              opacity: 0.9,
            },
          },
        },
      },
      bindings: {
        'magnet.btn-next': {
          unsupportedBindingField: true,
        },
      },
    } as unknown as ThemeImportCandidate;

    const normalized = normalizeTheme(input);

    expect(normalized).not.toHaveProperty('unexpectedRoot');
    expect(normalized.tokens).toBeUndefined();
    expect(normalized.motion).toBeUndefined();
    expect(normalized.bindings).toBeUndefined();
    expect(normalized.surfaces).toBeUndefined();
  });
});
