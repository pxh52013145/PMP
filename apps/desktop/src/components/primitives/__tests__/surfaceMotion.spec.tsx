import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../../themes/contexts/ThemeContextWithSync';
import type { Theme } from '../../../themes/types/theme';
import { PmpDialog } from '../PmpDialog';
import { PmpDrawer } from '../PmpDrawer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function createBaseTheme(): Theme {
  return {
    id: 'theme-surface-motion-test',
    name: 'Surface Motion Test',
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

function createMotionTheme(): Theme {
  return {
    ...createBaseTheme(),
    surfaces: {
      'overlay.modal': {
        parts: {
          overlay: {
            motion: {
              enter: {
                preset: 'fade',
                duration: 120,
              },
              exit: {
                preset: 'fade',
                duration: 120,
              },
            },
          },
        },
      },
      'primitive.dialog': {
        parts: {
          root: {
            motion: {
              enter: {
                preset: 'scale-in',
                duration: 160,
              },
              exit: {
                preset: 'fade-up',
                duration: 140,
              },
            },
          },
        },
      },
      'overlay.drawer': {
        parts: {
          root: {
            motion: {
              enter: {
                preset: 'slide-left',
                duration: 220,
                easing: 'ease-out',
                delay: 30,
              },
              exit: {
                preset: 'slide-left',
                duration: 180,
                easing: 'linear',
              },
            },
          },
        },
      },
    },
  };
}

async function renderWithTheme(content: React.ReactNode, theme = createMotionTheme()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<ThemeProvider initialTheme={theme}>{content}</ThemeProvider>);
  });
}

async function rerenderWithTheme(content: React.ReactNode, theme = createMotionTheme()) {
  expect(root).not.toBeNull();

  await act(async () => {
    root?.render(<ThemeProvider initialTheme={theme}>{content}</ThemeProvider>);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });

  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe('surface motion runtime', () => {
  it('keeps dialogs mounted long enough to play exit motion and exposes runtime metadata', async () => {
    vi.useFakeTimers();

    await renderWithTheme(
      <PmpDialog open title="Motion Dialog">
        body
      </PmpDialog>
    );

    const overlay = document.body.querySelector('[data-surface-id="overlay.modal"]') as HTMLDivElement | null;
    const dialog = document.body.querySelector(
      '[data-surface-id-dialog="primitive.dialog.default"]'
    ) as HTMLDivElement | null;

    expect(overlay?.dataset.pmpMotionPhase).toBe('enter');
    expect(overlay?.dataset.pmpMotionChannel).toBe('enter');
    expect(overlay?.dataset.pmpMotionPreset).toBe('fade');
    expect(overlay?.style.animationName).toBe('pmp-motion-fade');

    expect(dialog?.dataset.pmpMotionPhase).toBe('enter');
    expect(dialog?.dataset.pmpMotionChannel).toBe('enter');
    expect(dialog?.dataset.pmpMotionPreset).toBe('scale-in');
    expect(dialog?.style.animationName).toBe('pmp-motion-scale-in');

    await rerenderWithTheme(
      <PmpDialog open={false} title="Motion Dialog">
        body
      </PmpDialog>
    );

    const exitingOverlay = document.body.querySelector('[data-surface-id="overlay.modal"]') as HTMLDivElement | null;
    const exitingDialog = document.body.querySelector(
      '[data-surface-id-dialog="primitive.dialog.default"]'
    ) as HTMLDivElement | null;

    expect(exitingOverlay?.dataset.pmpMotionPhase).toBe('exit');
    expect(exitingOverlay?.dataset.pmpMotionChannel).toBe('exit');
    expect(exitingDialog?.dataset.pmpMotionPhase).toBe('exit');
    expect(exitingDialog?.dataset.pmpMotionChannel).toBe('exit');
    expect(exitingDialog?.style.animationName).toBe('pmp-motion-fade-up');

    await act(async () => {
      vi.advanceTimersByTime(141);
    });

    expect(document.body.querySelector('[data-surface-id="overlay.modal"]')).toBeNull();
    expect(document.body.querySelector('[data-surface-id-dialog="primitive.dialog.default"]')).toBeNull();
  });

  it('applies motion timing overrides to drawers from surface channels', async () => {
    await renderWithTheme(<PmpDrawer open={false} className="drawer-test" />);

    const closedDrawer = document.body.querySelector('[data-surface-id="overlay.drawer"]') as HTMLElement | null;
    expect(closedDrawer?.dataset.pmpMotionChannel).toBe('exit');
    expect(closedDrawer?.dataset.pmpMotionPreset).toBe('slide-left');
    expect(closedDrawer?.style.transitionDuration).toBe('180ms');
    expect(closedDrawer?.style.transitionTimingFunction).toBe('linear');
    expect(closedDrawer?.style.transitionDelay).toBe('0ms');
    expect(closedDrawer?.getAttribute('aria-hidden')).toBe('true');

    await rerenderWithTheme(<PmpDrawer open className="drawer-test" />);

    const openDrawer = document.body.querySelector('[data-surface-id="overlay.drawer"]') as HTMLElement | null;
    expect(openDrawer?.dataset.pmpMotionChannel).toBe('enter');
    expect(openDrawer?.dataset.pmpMotionPreset).toBe('slide-left');
    expect(openDrawer?.style.transitionDuration).toBe('220ms');
    expect(openDrawer?.style.transitionTimingFunction).toBe('ease-out');
    expect(openDrawer?.style.transitionDelay).toBe('30ms');
    expect(openDrawer?.getAttribute('aria-hidden')).toBeNull();
  });
});
