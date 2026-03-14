import { describe, expect, it } from 'vitest';
import {
  hasFocusedVisibleEditorWindow,
  isEditorWindowLabel,
  type EditorWindowFocusProbe,
} from '../editorWindowFocus';

function createProbe(
  label: string,
  options: { visible?: boolean; focused?: boolean; visibleReject?: boolean; focusedReject?: boolean } = {}
): EditorWindowFocusProbe {
  return {
    label,
    isVisible: () =>
      options.visibleReject ? Promise.reject(new Error('visible failed')) : Promise.resolve(options.visible ?? true),
    isFocused: () =>
      options.focusedReject ? Promise.reject(new Error('focus failed')) : Promise.resolve(options.focused ?? false),
  };
}

describe('editorWindowFocus', () => {
  it('matches editor window labels by prefix', () => {
    expect(isEditorWindowLabel('editor-control')).toBe(true);
    expect(isEditorWindowLabel('main')).toBe(false);
  });

  it('returns true when a visible editor window is focused', async () => {
    await expect(
      hasFocusedVisibleEditorWindow([
        createProbe('main', { visible: true, focused: true }),
        createProbe('editor-control', { visible: true, focused: true }),
      ])
    ).resolves.toBe(true);
  });

  it('ignores unfocused or hidden editor windows', async () => {
    await expect(
      hasFocusedVisibleEditorWindow([
        createProbe('editor-control', { visible: true, focused: false }),
        createProbe('editor-library', { visible: false, focused: true }),
      ])
    ).resolves.toBe(false);
  });

  it('treats probe failures as not focused', async () => {
    await expect(
      hasFocusedVisibleEditorWindow([
        createProbe('editor-control', { visibleReject: true, focused: true }),
        createProbe('editor-library', { visible: true, focusedReject: true }),
      ])
    ).resolves.toBe(false);
  });
});
