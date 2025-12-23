import { useCallback, useEffect } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { writeJson, type StorageWriteMode } from '../../modules/storage';
import { useMagnetConfig } from '../../modules/magnets';

export function EditorPanel() {
  const { editorState } = useEditor();
  const { magnetLibrary, activeMagnetIds, builtInMagnetIds } = useMagnetConfig();

  const syncDataToStorage = useCallback(
    (mode: StorageWriteMode = 'idle') => {
      const options =
        mode === 'sync'
          ? { mode: 'sync' as const }
          : { mode: 'idle' as const, debounceMs: 250 };

      writeJson(STORAGE_KEYS.MAGNET_LIBRARY, magnetLibrary, options);
      writeJson(STORAGE_KEYS.ACTIVE_MAGNETS, [...activeMagnetIds], options);
      writeJson(STORAGE_KEYS.BUILTIN_MAGNETS, [...builtInMagnetIds], options);
    },
    [magnetLibrary, activeMagnetIds, builtInMagnetIds]
  );

  useEffect(() => {
    if (editorState.isEditing) {
      syncDataToStorage('sync');

      const openControlWindow = async () => {
        try {
          const { calculateWindowPosition, openEditorWindow } = await import('../../utils/editorWindows');
          const position = await calculateWindowPosition('control');
          await openEditorWindow({ type: 'control', ...position });
        } catch (error) {
          console.error('Failed to open control window:', error);
        }
      };

      void openControlWindow();
      return;
    }

    const close = async () => {
      try {
        const { closeEditorWindow } = await import('../../utils/editorWindows');
        await closeEditorWindow('control');
      } catch (error) {
        console.error('Failed to close editor windows:', error);
      }
    };
    void close();
  }, [editorState.isEditing, syncDataToStorage]);

  useEffect(() => {
    if (!editorState.isEditing) return;
    syncDataToStorage();
  }, [activeMagnetIds, builtInMagnetIds, editorState.isEditing, magnetLibrary, syncDataToStorage]);

  return null;
}
