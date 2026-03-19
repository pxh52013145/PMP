import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { writeJson, type StorageWriteMode } from '../../modules/storage';
import { useMagnetConfig } from '../../modules/magnets';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('editor', 'EditorPanel');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EditorPanel() {
  const { editorState } = useEditor();
  const { magnetLibrary, activeMagnetIds, builtInMagnetIds } = useMagnetConfig();
  const didOpenControlWindowRef = useRef(false);

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
      if (didOpenControlWindowRef.current) return;
      didOpenControlWindowRef.current = true;

      syncDataToStorage('sync');

      void (async () => {
        try {
          const { calculateWindowPosition, openEditorWindow } = await import('../../utils/editorWindows');
          const position = await calculateWindowPosition('control');
          await openEditorWindow({ type: 'control', ...position });
        } catch (error) {
          didOpenControlWindowRef.current = false;
          telemetry.error('editor.control_window.open.failed', {
            message: readErrorMessage(error),
            fields: {
              isEditing: editorState.isEditing,
            },
          });
        }
      })();
      return;
    }

    didOpenControlWindowRef.current = false;
    const close = async () => {
      try {
        const { closeEditorWindow } = await import('../../utils/editorWindows');
        await closeEditorWindow('control');
      } catch (error) {
        telemetry.error('editor.control_window.close.failed', {
          message: readErrorMessage(error),
          fields: {
            isEditing: editorState.isEditing,
          },
        });
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
