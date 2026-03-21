import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Magnet } from '../../../types/pixel';
import { ThemeProvider } from '../../../themes/contexts/ThemeContextWithSync';
import type { Theme } from '../../../themes/types/theme';
import { MagnetLayer } from '../MagnetLayer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pixelPositions = new Map<string, { x: number; y: number }>([
  ['0,0', { x: 0, y: 0 }],
  ['1,0', { x: 40, y: 0 }],
  ['2,0', { x: 80, y: 0 }],
]);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function createBaseTheme(): Theme {
  return {
    id: 'theme-default',
    name: 'Default Theme',
    version: '1.0.0',
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

function createSingleMagnet(id: string, gridX: number): Magnet {
  return {
    id,
    type: 'custom',
    name: id,
    anchorType: 'single',
    anchors: [{ id: `${id}-anchor`, gridX, gridY: 0, role: 'anchor' }],
    content: id,
    style: {
      width: '36px',
      height: '36px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

async function renderLayer(theme: Theme, magnets: Magnet[], activeSpaceId = 'space1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ThemeProvider initialTheme={theme}>
        <MagnetLayer magnets={magnets} pixelPositions={pixelPositions} activeSpaceId={activeSpaceId} />
      </ThemeProvider>
    );
  });
}

async function rerenderLayer(theme: Theme, magnets: Magnet[], activeSpaceId: string) {
  expect(root).not.toBeNull();

  await act(async () => {
    root?.render(
      <ThemeProvider initialTheme={theme}>
        <MagnetLayer magnets={magnets} pixelPositions={pixelPositions} activeSpaceId={activeSpaceId} />
      </ThemeProvider>
    );
  });
}

function getHost(): HTMLDivElement {
  expect(container).not.toBeNull();
  return container as HTMLDivElement;
}

describe('MagnetLayer scene runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();

    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it('applies appBoot scene enter animation with staggered delays', async () => {
    const theme: Theme = {
      ...createBaseTheme(),
      motion: {
        scenes: {
          appBoot: {
            enter: {
              preset: 'fade-up',
              duration: 160,
              easing: 'ease-out',
            },
            stagger: {
              by: 'index',
              from: 'start',
              step: 40,
            },
          },
        },
      },
    };

    await renderLayer(theme, [createSingleMagnet('first', 0), createSingleMagnet('second', 1)]);

    const host = getHost();
    const first = host.querySelector('[data-magnet-id="first"]') as HTMLDivElement | null;
    const second = host.querySelector('[data-magnet-id="second"]') as HTMLDivElement | null;

    expect(first?.dataset.pmpMotionScene).toBe('appBoot');
    expect(first?.dataset.pmpMotionPhase).toBe('enter');
    expect(first?.style.animationName).toBe('pmp-motion-fade-up');
    expect(first?.style.animationDelay).toBe('0ms');
    expect(second?.dataset.pmpMotionScene).toBe('appBoot');
    expect(second?.style.animationDelay).toBe('40ms');

    await act(async () => {
      vi.advanceTimersByTime(201);
    });

    expect(first?.hasAttribute('data-pmp-motion-scene')).toBe(false);
    expect(second?.hasAttribute('data-pmp-motion-scene')).toBe(false);
  });

  it('applies spaceSwitch enter and exit scenes and uses the scene channel as layout fallback for shared magnets', async () => {
    const theme: Theme = {
      ...createBaseTheme(),
      motion: {
        scenes: {
          spaceSwitch: {
            enter: {
              preset: 'shared-axis',
              duration: 100,
              easing: 'ease-in-out',
            },
            exit: {
              preset: 'fade',
              duration: 80,
            },
          },
        },
      },
      bindings: {
        'magnet.shared': {
          motion: {
            enabled: true,
            mode: 'full',
            layout: {
              strategy: 'flip',
              largeChange: 'animate',
              sharedKey: 'shared',
            },
          },
        },
      },
    };

    await renderLayer(theme, [createSingleMagnet('shared', 0), createSingleMagnet('only-space1', 1)], 'space1');

    await rerenderLayer(theme, [createSingleMagnet('shared', 2), createSingleMagnet('only-space2', 1)], 'space2');

    const host = getHost();
    const shared = host.querySelector('[data-magnet-id="shared"]') as HTMLDivElement | null;
    const entering = host.querySelector('[data-magnet-id="only-space2"]') as HTMLDivElement | null;
    const exiting = host.querySelector('[data-magnet-id="only-space1"]') as HTMLDivElement | null;

    expect(shared?.style.transition).toContain('transform 100ms ease-in-out');
    expect(shared?.dataset.pmpMotionSharedKey).toBe('shared');

    expect(entering?.dataset.pmpMotionScene).toBe('spaceSwitch');
    expect(entering?.dataset.pmpMotionPhase).toBe('enter');
    expect(entering?.style.animationName).toBe('pmp-motion-shared-axis');

    expect(exiting?.dataset.pmpMotionScene).toBe('spaceSwitch');
    expect(exiting?.dataset.pmpMotionPhase).toBe('exit');
    expect(exiting?.style.animationName).toBe('pmp-motion-fade');

    await act(async () => {
      vi.advanceTimersByTime(81);
    });

    expect(host.querySelector('[data-magnet-id="only-space1"]')).toBeNull();
  });
});
