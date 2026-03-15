import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../themes/contexts/ThemeContextWithSync';
import type { Theme } from '../../../themes/types/theme';
import { PmpButton } from '../PmpButton';
import { PmpCard } from '../PmpCard';
import { PmpSwitch } from '../PmpSwitch';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function createBaseTheme(): Theme {
  return {
    id: 'theme-primitive-interaction-motion-test',
    name: 'Primitive Interaction Motion Test',
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

function createInteractionTheme(): Theme {
  return {
    ...createBaseTheme(),
    surfaces: {
      'primitive.button.primary': {
        states: {
          hover: {
            style: {
              backgroundColor: 'rgb(255, 0, 0)',
            },
            motion: {
              hover: {
                duration: 90,
                easing: 'linear',
              },
            },
          },
        },
      },
      'primitive.card.default': {
        states: {
          focus: {
            style: {
              boxShadow: 'rgb(0, 255, 255) 0px 0px 0px 1px',
            },
            motion: {
              focus: {
                duration: 200,
                easing: 'ease-in-out',
              },
            },
          },
        },
      },
      'primitive.switch.default': {
        states: {
          checked: {
            motion: {
              hover: {
                duration: 150,
                easing: 'ease-out',
              },
            },
            parts: {
              track: {
                style: {
                  backgroundColor: 'rgb(0, 128, 255)',
                },
              },
              thumb: {
                style: {
                  transform: 'translateX(20px)',
                },
              },
            },
          },
        },
      },
    },
  };
}

async function renderWithTheme(content: React.ReactNode, theme = createInteractionTheme()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<ThemeProvider initialTheme={theme}>{content}</ThemeProvider>);
  });
}

function dispatchMouseOver(target: Element) {
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function dispatchMouseOut(target: Element) {
  target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
}

function dispatchFocusIn(target: Element) {
  target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });

  container?.remove();
  container = null;
  root = null;
});

describe('primitive interaction motion runtime', () => {
  it('applies hover state styles and motion timing to buttons', async () => {
    await renderWithTheme(<PmpButton variant="primary">Hover Button</PmpButton>);

    const button = document.body.querySelector('[data-surface-id="primitive.button.primary"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      dispatchMouseOver(button!);
    });

    expect(button?.dataset.pmpInteractionState).toBe('hover');
    expect(button?.dataset.pmpState).toBe('hover');
    expect(button?.dataset.pmpMotionChannel).toBe('hover');
    expect(button?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(button?.style.transitionDuration).toBe('90ms');
    expect(button?.style.transitionTimingFunction).toBe('linear');

    await act(async () => {
      dispatchMouseOut(button!);
    });

    expect(button?.dataset.pmpInteractionState).toBe('idle');
    expect(button?.dataset.pmpState).toBeUndefined();
    expect(button?.dataset.pmpMotionChannel).toBeUndefined();
    expect(button?.style.transitionDuration).toBe('90ms');
  });

  it('applies focus motion timing to cards', async () => {
    await renderWithTheme(
      <PmpCard variant="default" tabIndex={0}>
        Focus Card
      </PmpCard>
    );

    const card = document.body.querySelector('[data-surface-id="primitive.card.default"]') as HTMLElement | null;
    expect(card).not.toBeNull();

    await act(async () => {
      dispatchFocusIn(card!);
    });

    expect(card?.dataset.pmpInteractionState).toBe('focus');
    expect(card?.dataset.pmpState).toBe('focus');
    expect(card?.dataset.pmpMotionChannel).toBe('focus');
    expect(card?.style.boxShadow).toBe('rgb(0, 255, 255) 0px 0px 0px 1px');
    expect(card?.style.transitionDuration).toBe('200ms');
    expect(card?.style.transitionTimingFunction).toBe('ease-in-out');
  });

  it('keeps checked switch skin while applying hover motion timing to parts', async () => {
    await renderWithTheme(<PmpSwitch checked>Toggle</PmpSwitch>);

    const switchRoot = document.body.querySelector('[data-surface-id="primitive.switch.default"]') as HTMLButtonElement | null;
    const switchTrack = switchRoot?.querySelector('[data-pmp-part="track"]') as HTMLSpanElement | null;
    const switchThumb = switchRoot?.querySelector('[data-pmp-part="thumb"]') as HTMLSpanElement | null;

    expect(switchRoot).not.toBeNull();
    expect(switchTrack).not.toBeNull();
    expect(switchThumb).not.toBeNull();

    await act(async () => {
      dispatchMouseOver(switchRoot!);
    });

    expect(switchRoot?.dataset.surfaceState).toBe('checked');
    expect(switchRoot?.dataset.pmpInteractionState).toBe('hover');
    expect(switchRoot?.dataset.pmpMotionChannel).toBe('hover');
    expect(switchTrack?.style.backgroundColor).toBe('rgb(0, 128, 255)');
    expect(switchTrack?.style.transitionDuration).toBe('150ms');
    expect(switchTrack?.style.transitionTimingFunction).toBe('ease-out');
    expect(switchThumb?.style.transform).toBe('translateX(20px)');
    expect(switchThumb?.style.transitionDuration).toBe('150ms');
  });
});
