export interface EditorWindowFocusProbe {
  label: string;
  isVisible: () => Promise<boolean>;
  isFocused: () => Promise<boolean>;
}

export function isEditorWindowLabel(label: string): boolean {
  return label.startsWith('editor-');
}

export async function hasFocusedVisibleEditorWindow(
  windows: ReadonlyArray<EditorWindowFocusProbe>
): Promise<boolean> {
  const editorWindows = windows.filter((window) => isEditorWindowLabel(window.label));
  if (editorWindows.length === 0) {
    return false;
  }

  const focusStates = await Promise.all(
    editorWindows.map(async (window) => {
      const [visible, focused] = await Promise.all([
        window.isVisible().catch(() => false),
        window.isFocused().catch(() => false),
      ]);
      return visible && focused;
    })
  );

  return focusStates.some(Boolean);
}
