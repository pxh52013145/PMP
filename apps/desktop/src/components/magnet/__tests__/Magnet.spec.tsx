import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Magnet } from '../../../types/pixel';
import { MagnetComponent } from '../Magnet';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pixelPositions = new Map<string, { x: number; y: number }>([['0,0', { x: 0, y: 0 }]]);

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

describe('MagnetComponent', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it('separates hover, press, and drag feedback for draggable magnets', async () => {
    const onDrag = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MagnetComponent magnet={createDraggableMagnet(onDrag)} pixelPositions={pixelPositions} />
      );
    });

    const shell = container.querySelector('[data-magnet-id="drag-state-test"]') as HTMLDivElement | null;
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MagnetComponent magnet={createPaddedMagnet()} pixelPositions={pixelPositions} />);
    });

    const chrome = container.querySelector('.magnet') as HTMLDivElement | null;
    const contentLayer = container.querySelector('.magnet-content-layer') as HTMLDivElement | null;

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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MagnetComponent
          magnet={createPaddedMagnet()}
          pixelPositions={pixelPositions}
          joinEdges={{ left: false, right: true, top: false, bottom: false }}
        />
      );
    });

    const chrome = container.querySelector('.magnet') as HTMLDivElement | null;
    const baseLayer = container.querySelector('.magnet-base-layer') as HTMLDivElement | null;

    expect(chrome?.style.borderTopLeftRadius).toBe('2px');
    expect(chrome?.style.borderBottomLeftRadius).toBe('2px');
    expect(chrome?.style.borderTopRightRadius).toBe('0px');
    expect(chrome?.style.borderBottomRightRadius).toBe('0px');
    expect(baseLayer?.style.borderTopRightRadius).toBe('0px');
    expect(baseLayer?.style.borderTopLeftRadius).toBe('2px');
  });

  it('uses a consistent inset stroke in normal mode for crisp host chrome alignment', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MagnetComponent magnet={createPaddedMagnet()} pixelPositions={pixelPositions} />);
    });

    const baseLayer = container.querySelector('.magnet-base-layer') as HTMLDivElement | null;

    expect(baseLayer?.style.boxShadow).toContain('inset 0 0 0 1px');
  });

  it('applies chrome inset to the base and content layers without changing shell bounds', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MagnetComponent magnet={createChromeInsetMagnet()} pixelPositions={pixelPositions} />);
    });

    const shell = container.querySelector('[data-magnet-id="chrome-inset-test"]') as HTMLDivElement | null;
    const baseLayer = container.querySelector('.magnet-base-layer') as HTMLDivElement | null;
    const contentLayer = container.querySelector('.magnet-content-layer') as HTMLDivElement | null;

    expect(shell?.style.width).toBe('36px');
    expect(shell?.style.height).toBe('36px');
    expect(baseLayer?.style.top).toBe('8px');
    expect(baseLayer?.style.right).toBe('4px');
    expect(baseLayer?.style.bottom).toBe('2px');
    expect(baseLayer?.style.left).toBe('6px');
    expect(contentLayer?.style.top).toBe('8px');
    expect(contentLayer?.style.left).toBe('6px');
  });
});
