import { useEffect, useRef } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { useKernel } from '../../contexts/KernelApiContext';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('editor', 'EditorPanel');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EditorPanel() {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { editorState } = useEditor();
  const didOpenControlWindowRef = useRef(false);

  useEffect(() => {
    if (editorState.isEditing) {
      if (didOpenControlWindowRef.current) return;
      didOpenControlWindowRef.current = true;

      void (async () => {
        try {
          await dispatchRequiredCommand(
            commands,
            'app:open-control-editor-window',
            'Control editor command service is not available.'
          );
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
  }, [commands, editorState.isEditing]);

  return null;
}
