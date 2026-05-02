import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME } from './runtimeTheme';
import { resolveThemeMotionScene, withDefaultThemeMotion } from './motion';

describe('theme motion defaults', () => {
  it('provides default magnet space switch enter and exit scenes', () => {
    const theme = withDefaultThemeMotion({
      ...DEFAULT_THEME,
      motion: undefined,
    });

    const scene = resolveThemeMotionScene(theme, 'spaceSwitch');

    expect(scene?.enter).toMatchObject({
      preset: 'scale-in',
      duration: '170ms',
      scale: 0.96,
    });
    expect(scene?.exit).toMatchObject({
      preset: 'scale-out',
      duration: '130ms',
      scale: 1.035,
    });
    expect(scene?.stagger).toEqual({
      by: 'grid',
      from: 'center',
      step: '14ms',
    });
  });

  it('keeps theme-defined space switch scenes ahead of defaults', () => {
    const theme = withDefaultThemeMotion({
      ...DEFAULT_THEME,
      motion: {
        presets: {
          customEnter: {
            preset: 'slide-left',
            duration: '90ms',
          },
        },
        scenes: {
          spaceSwitch: {
            enter: 'customEnter',
          },
        },
      },
    });

    const scene = resolveThemeMotionScene(theme, 'spaceSwitch');

    expect(scene?.enter).toMatchObject({
      preset: 'slide-left',
      duration: '90ms',
    });
    expect(scene?.exit).toBeUndefined();
  });
});
