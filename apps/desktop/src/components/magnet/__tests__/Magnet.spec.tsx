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
});
