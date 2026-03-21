import { describe, expect, it } from 'vitest';

import { resolveThemeBindingMotion, resolveThemeMotionScene } from '../motion';
import type { Theme } from '../types/theme';

function createBaseTheme(): Theme {
  return {
    id: 'theme-default',
    name: 'Default Theme',
    version: '1.0.0',
    tokens: {
      motion: {
        'duration.normal': 180,
        'stagger.grid': 24,
      },
    },
    motion: {
      presets: {
        'enter.fade-up': {
          preset: 'fade-up',
          duration: '{motion.duration.normal}',
          distance: 16,
        },
        'attention.flash': {
          preset: 'flash',
          duration: 220,
        },
      },
      scenes: {
        appBoot: {
          enter: 'enter.fade-up',
          stagger: {
            by: 'grid',
            from: 'start',
            step: '{motion.stagger.grid}',
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
      maximized: { type: 'color', color: '#000000' },
      windowed: { type: 'color', color: '#111111' },
    },
    fonts: {
      primary: 'Inter, sans-serif',
    },
  };
}

describe('theme motion schema', () => {
  it('resolves binding.motion into runtime channels', () => {
    const theme = createBaseTheme();
    const motion = resolveThemeBindingMotion(theme, {
      enabled: true,
      mode: 'full',
      presence: {
        enter: 'enter.fade-up',
      },
      layout: {
        strategy: 'flip',
        largeChange: 'animate',
        sharedKey: 'btn-back',
        move: {
          preset: 'shared-axis',
          duration: 240,
        },
      },
      attention: {
        hover: 'attention.flash',
      },
    });

    expect(motion?.enabled).toBe(true);
    expect(motion?.mode).toBe('full');
    expect(motion?.layout?.strategy).toBe('flip');
    expect(motion?.layout?.sharedKey).toBe('btn-back');
    expect(motion?.channels?.enter?.preset).toBe('fade-up');
    expect(motion?.channels?.enter?.duration).toBe(180);
    expect(motion?.channels?.layout?.preset).toBe('shared-axis');
    expect(motion?.channels?.hover?.preset).toBe('flash');
  });

  it('resolves scene presets and tokenized stagger values', () => {
    const theme = createBaseTheme();
    const scene = resolveThemeMotionScene(theme, 'appBoot');

    expect(scene?.enter?.preset).toBe('fade-up');
    expect(scene?.enter?.duration).toBe(180);
    expect(scene?.stagger?.by).toBe('grid');
    expect(scene?.stagger?.step).toBe(24);
  });
});
