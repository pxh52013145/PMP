import { createContext, useContext } from 'react';

export interface EditorWindowActivityState {
  isVisible: boolean;
  isActive: boolean;
}

const EditorWindowActivityContext = createContext<EditorWindowActivityState>({
  isVisible: true,
  isActive: true,
});

export function useEditorWindowActivity(): EditorWindowActivityState {
  return useContext(EditorWindowActivityContext);
}

export const EditorWindowActivityProvider = EditorWindowActivityContext.Provider;

