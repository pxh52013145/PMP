import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Magnet } from '../../../types/pixel';
import { ThemeProvider } from '../../../themes/contexts/ThemeContextWithSync';
import type { Theme } from '../../../themes/types/theme';
import { MagnetComponent } from '../Magnet';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pixelPositions = new Map<string, { x: number; y: number }>([['0,0', { x: 0, y: 0 }]]);
let container: HTMLDivElement | null = null;
let root: Root | null = null;
let lastTheme: Theme | null = null;

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
  };
}

function createSurfaceTheme(): Theme {
  return {
    ...createBaseTheme(),
    surfaces: {
      'magnet.content-style-test': {
        variant: 'glass',
        parts: {
          root: {
            classes: ['magnet-surface-root'],
            style: {
              opacity: 0.7,
            },
            tokens: {
              'color.accent': '#ff00ff',
            },
          },
        },
      },
    },
  };
}

function createMotionTheme(): Theme {
  return {
    ...createSurfaceTheme(),
    bindings: {
      'magnet.content-style-test': {
        capabilities: {
          motion: {
            enabled: true,
            mode: 'full',
            layout: {
              strategy: 'flip',
              largeChange: 'animate',
              sharedKey: 'content-style-test',
            },
            channels: {
              spaceSwitch: {
                preset: 'shared-axis',
                duration: 240,
                easing: 'ease-out',
              },
            },
          },
        },
      },
    },
  };
}

function createDraggableMagnet(onDrag: () => void): Magnet {
  return {
    id: 'drag-state-test',
    type: 'drag-handle',
    name: 'Drag State Test',
    anchorType: 'single',
    anchors: [{ id: 'anchor-1', gridX: 0, gridY: 0, role: 'anchor' }],
    content: '::',
    style: {
      width: '36px',
      height: '36px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      cursor: 'grab',
    },
    animation: {
      transition: 'all 0.2s ease',
      hoverStyle: {
        transform: 'translateY(-1px)',
      },
      activeStyle: {
        transform: 'translateY(0)',
      },
      dragStyle: {
        cursor: 'grabbing',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
      },
    },
    state: 'idle',
    interactions: {
      draggable: true,
      clickable: false,
      onDrag,
    },
  };
}

function createPaddedMagnet(): Magnet {
  return {
    id: 'content-style-test',
    type: 'custom',
    name: 'Content Style Test',
    anchorType: 'single',
    anchors: [{ id: 'anchor-1', gridX: 0, gridY: 0, role: 'anchor' }],
    content: 'Content',
    style: {
      width: '36px',
      height: '36px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      padding: '8px',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      color: 'rgb(255, 0, 0)',
      fontSize: '13px',
    },
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

function createChromeInsetMagnet(): Magnet {
  return {
    id: 'chrome-inset-test',
    type: 'custom',
    name: 'Chrome Inset Test',
    anchorType: 'single',
    anchors: [{ id: 'anchor-1', gridX: 0, gridY: 0, role: 'anchor' }],
    content: 'Inset',
    style: {
      width: '36px',
      height: '36px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    chrome: {
      inset: {
        top: 8,
        right: 4,
        bottom: 2,
        left: 6,
      },
    },
    state: 'idle',
    interactions: {
      draggable: false,
      clickable: false,
    },
  };
}

async function renderMagnet(
  magnet: Magnet,
  options: Omit<ComponentProps<typeof MagnetComponent>, 'magnet' | 'pixelPositions'> = {},
  theme = createBaseTheme()
) {
  lastTheme = theme;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ThemeProvider initialTheme={theme}>
        <MagnetComponent magnet={magnet} pixelPositions={pixelPositions} {...options} />
      </ThemeProvider>
    );
  });
}

async function rerenderMagnet(
  magnet: Magnet,
  options: Omit<ComponentProps<typeof MagnetComponent>, 'magnet' | 'pixelPositions'> = {},
  theme = lastTheme ?? createBaseTheme()
) {
  lastTheme = theme;
  expect(root).not.toBeNull();

  await act(async () => {
    root?.render(
      <ThemeProvider initialTheme={theme}>
        <MagnetComponent magnet={magnet} pixelPositions={pixelPositions} {...options} />
      </ThemeProvider>
    );
  });
}

function getContainer(): HTMLDivElement {
  expect(container).not.toBeNull();
  return container as HTMLDivElement;
}

describe('MagnetComponent', () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    lastTheme = null;
  });

  it('separates hover, press, and drag feedback for draggable magnets', async () => {
    const onDrag = vi.fn();
    await renderMagnet(createDraggableMagnet(onDrag));

    const host = getContainer();
    const shell = host.querySelector('[data-magnet-id="drag-state-test"]') as HTMLDivElement | null;
    expect(shell).not.toBeNull();
    expect(shell?.dataset.interactionState).toBe('idle');
    expect(shell?.style.cursor).toBe('grab');

    await act(async () => {
      shell?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(shell?.dataset.interactionState).toBe('hover');

    await act(async () => {
      shell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });

    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(shell?.dataset.interactionState).toBe('dragging');
    expect(shell?.style.cursor).toBe('grabbing');

    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(shell?.dataset.interactionState).toBe('hover');
    expect(shell?.style.cursor).toBe('grab');

    await act(async () => {
      shell?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(shell?.dataset.interactionState).toBe('idle');
  });

  it('routes content layout styles to the content layer instead of chrome', async () => {
    await renderMagnet(createPaddedMagnet());

    const host = getContainer();
    const chrome = host.querySelector('.magnet') as HTMLDivElement | null;
    const contentLayer = host.querySelector('.magnet-content-layer') as HTMLDivElement | null;

    expect(chrome).not.toBeNull();
    expect(contentLayer).not.toBeNull();
    expect(chrome?.style.padding).toBe('');
    expect(chrome?.style.color).toBe('');
    expect(contentLayer?.style.padding).toBe('8px');
    expect(contentLayer?.style.display).toBe('flex');
    expect(contentLayer?.style.alignItems).toBe('flex-start');
    expect(contentLayer?.style.justifyContent).toBe('flex-start');
    expect(contentLayer?.style.color).toBe('rgb(255, 0, 0)');
    expect(contentLayer?.style.fontSize).toBe('13px');
  });

  it('flattens joined seam corners while keeping outer corners rounded', async () => {
    await renderMagnet(createPaddedMagnet(), {
      joinEdges: { left: false, right: true, top: false, bottom: false },
    });

    const host = getContainer();
    const chrome = host.querySelector('.magnet') as HTMLDivElement | null;
    const baseLayer = host.querySelector('.magnet-base-layer') as HTMLDivElement | null;

    expect(chrome?.style.borderTopLeftRadius).toBe('2px');
    expect(chrome?.style.borderBottomLeftRadius).toBe('2px');
    expect(chrome?.style.borderTopRightRadius).toBe('0px');
    expect(chrome?.style.borderBottomRightRadius).toBe('0px');
    expect(baseLayer?.style.borderTopRightRadius).toBe('0px');
    expect(baseLayer?.style.borderTopLeftRadius).toBe('2px');
  });

  it('uses a consistent inset stroke in normal mode for crisp host chrome alignment', async () => {
    await renderMagnet(createPaddedMagnet());

    const host = getContainer();
    const baseLayer = host.querySelector('.magnet-base-layer') as HTMLDivElement | null;

    expect(baseLayer?.style.boxShadow).toContain('inset 0 0 0 1px');
  });

  it('applies chrome inset to the base and content layers without changing shell bounds', async () => {
    await renderMagnet(createChromeInsetMagnet());

    const host = getContainer();
    const shell = host.querySelector('[data-magnet-id="chrome-inset-test"]') as HTMLDivElement | null;
    const baseLayer = host.querySelector('.magnet-base-layer') as HTMLDivElement | null;
    const contentLayer = host.querySelector('.magnet-content-layer') as HTMLDivElement | null;

    expect(shell?.style.width).toBe('36px');
    expect(shell?.style.height).toBe('36px');
    expect(baseLayer?.style.top).toBe('8px');
    expect(baseLayer?.style.right).toBe('4px');
    expect(baseLayer?.style.bottom).toBe('2px');
    expect(baseLayer?.style.left).toBe('6px');
    expect(contentLayer?.style.top).toBe('8px');
    expect(contentLayer?.style.left).toBe('6px');
  });

  it('exposes stable magnet surface binding metadata on the rendered root', async () => {
    await renderMagnet(createPaddedMagnet(), {}, createSurfaceTheme());

    const host = getContainer();
    const chrome = host.querySelector('.magnet') as HTMLDivElement | null;

    expect(chrome?.dataset.surfaceId).toBe('magnet.content-style-test');
    expect(chrome?.getAttribute('data-pmp-surface')).toBe('magnet.content-style-test');
    expect(chrome?.getAttribute('data-pmp-part')).toBe('root');
    expect(chrome?.getAttribute('data-pmp-binding')).toBe('magnet.content-style-test');
    expect(chrome?.getAttribute('data-pmp-state')).toBe('idle');
    expect(chrome?.hasAttribute('data-pmp-variant')).toBe(false);
    expect(chrome?.className).toContain('magnet-surface-root');
    expect(chrome?.style.opacity).toBe('0.7');
    expect(chrome?.style.getPropertyValue('--pmp-color-accent')).toBe('#ff00ff');
  });

  it('keeps large same-id layout changes animatable when flip motion is enabled', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    await renderMagnet(
      createPaddedMagnet(),
      {
        boundsOverride: { x: 0, y: 0, width: 36, height: 36 },
      },
      createMotionTheme()
    );

    await rerenderMagnet(createPaddedMagnet(), {
      boundsOverride: { x: 220, y: 140, width: 72, height: 48 },
    });

    const host = getContainer();
    const shell = host.querySelector('[data-magnet-id="content-style-test"]') as HTMLDivElement | null;
    expect(shell).not.toBeNull();
    expect(shell?.dataset.pmpMotionMode).toBe('full');
    expect(shell?.dataset.pmpMotionLayout).toBe('flip');
    expect(shell?.dataset.pmpMotionSharedKey).toBe('content-style-test');
    expect(shell?.style.transition).toContain('transform 240ms ease-out');
    expect(shell?.style.transform).toContain('translate(-220px, -140px)');
    expect(shell?.style.transform).toContain('scale(0.5, 0.75)');

    await act(async () => {
      rafCallbacks.splice(0).forEach((callback) => callback(performance.now()));
    });

    expect(shell?.style.transform).toBe('');
    expect(requestAnimationFrameSpy).toHaveBeenCalled();
    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(0);
  });
});
