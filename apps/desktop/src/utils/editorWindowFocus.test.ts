import { describe, expect, it } from 'vitest';
import {
  type EditorAuxWindowFocusPollingInput,
  shouldPollEditorAuxWindowFocus,
} from './editorWindowFocus';

const activePollingInput: EditorAuxWindowFocusPollingInput = {
  isTauri: true,
  isEditing: true,
  isMainWindowFocused: false,
  isMainWindowVisible: true,
  isDocumentVisible: true,
  isMainWindowMinimized: false,
  isPageFrozen: false,
};

describe('shouldPollEditorAuxWindowFocus', () => {
  it('allows polling while editing with an unfocused but visible main window', () => {
    expect(shouldPollEditorAuxWindowFocus(activePollingInput)).toBe(true);
  });

  const disabledCases: Array<{
    name: string;
    override: Partial<EditorAuxWindowFocusPollingInput>;
  }> = [
    { name: 'outside Tauri', override: { isTauri: false } },
    { name: 'not editing', override: { isEditing: false } },
    { name: 'main window focused', override: { isMainWindowFocused: true } },
    { name: 'main window hidden', override: { isMainWindowVisible: false } },
    { name: 'document hidden', override: { isDocumentVisible: false } },
    { name: 'main window minimized', override: { isMainWindowMinimized: true } },
    { name: 'page frozen', override: { isPageFrozen: true } },
  ];

  for (const { name, override } of disabledCases) {
    it(`skips polling when ${name}`, () => {
      expect(shouldPollEditorAuxWindowFocus({ ...activePollingInput, ...override })).toBe(false);
    });
  }
});
