import { describe, expect, it } from 'vitest';
import { shouldRenderEditorOverlay, shouldRenderEditorPanel } from '../MatrixWorkbench';

describe('MatrixWorkbench memory gating', () => {
  it('only renders editor overlay during edit mode with pixels', () => {
    expect(shouldRenderEditorOverlay(true, false, 100)).toBe(false);
    expect(shouldRenderEditorOverlay(true, true, 0)).toBe(false);
    expect(shouldRenderEditorOverlay(false, true, 100)).toBe(false);
    expect(shouldRenderEditorOverlay(true, true, 100)).toBe(true);
  });

  it('only renders editor panel during edit mode', () => {
    expect(shouldRenderEditorPanel(true, false)).toBe(false);
    expect(shouldRenderEditorPanel(false, true)).toBe(false);
    expect(shouldRenderEditorPanel(true, true)).toBe(true);
  });
});

