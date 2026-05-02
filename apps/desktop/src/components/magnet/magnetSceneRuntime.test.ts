import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME } from '../../themes/runtimeTheme';
import { resolveThemeMotionScene, withDefaultThemeMotion } from '../../themes/motion';
import { buildMagnetSceneAnimations } from './magnetSceneRuntime';

describe('magnet scene runtime', () => {
  it('builds default space switch enter animations for new magnets', () => {
    const theme = withDefaultThemeMotion({
      ...DEFAULT_THEME,
      motion: undefined,
    });
    const scene = resolveThemeMotionScene(theme, 'spaceSwitch');
    const { animationsById, maxTotalMs } = buildMagnetSceneAnimations({
      sceneId: 'spaceSwitch',
      phase: 'enter',
      spec: scene?.enter,
      ids: ['music', 'queue'],
      boundsByMagnetId: {
        music: { x: 100, y: 100, width: 80, height: 80 },
        queue: { x: 160, y: 160, width: 80, height: 80 },
      },
      stagger: scene?.stagger,
    });

    expect(animationsById.music).toMatchObject({
      sceneId: 'spaceSwitch',
      phase: 'enter',
      channel: 'enter',
    });
    expect(animationsById.music.spec).toMatchObject({
      preset: 'scale-in',
      duration: '170ms',
    });
    expect(animationsById.music.style).toMatchObject({
      animationName: 'pmp-motion-scale-in',
      animationDuration: '170ms',
      animationDirection: 'normal',
    });
    expect(maxTotalMs).toBeGreaterThan(170);
  });

  it('builds default space switch exit animations for removed magnets', () => {
    const theme = withDefaultThemeMotion({
      ...DEFAULT_THEME,
      motion: undefined,
    });
    const scene = resolveThemeMotionScene(theme, 'spaceSwitch');
    const { animationsById, maxTotalMs } = buildMagnetSceneAnimations({
      sceneId: 'spaceSwitch',
      phase: 'exit',
      spec: scene?.exit,
      ids: ['legacy'],
      boundsByMagnetId: {
        legacy: { x: 20, y: 20, width: 36, height: 36 },
      },
      stagger: scene?.stagger,
    });

    expect(animationsById.legacy).toMatchObject({
      sceneId: 'spaceSwitch',
      phase: 'exit',
      channel: 'exit',
    });
    expect(animationsById.legacy.spec).toMatchObject({
      preset: 'scale-out',
      duration: '130ms',
    });
    expect(animationsById.legacy.style).toMatchObject({
      animationName: 'pmp-motion-scale-out',
      animationDuration: '130ms',
      animationDirection: 'reverse',
    });
    expect(maxTotalMs).toBe(130);
  });
});
