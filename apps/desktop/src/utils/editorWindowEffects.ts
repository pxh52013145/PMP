import { readJson } from '../modules/storage';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import { broadcastSignal, STORAGE_KEYS, TAURI_EVENTS } from './windowCommunication';
import { isTauriRuntime } from './tauriRuntime';

const telemetry = getTelemetryLogger('windowing', 'editorWindowEffects');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readEditorLowPerformanceMode(): boolean {
  return readJson<boolean>(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, false);
}

export async function setEditorBlurEnabled(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invokeWithTelemetry('set_editor_blur_enabled', { enabled }, {
      moduleId: 'windowing',
      component: 'editorWindowEffects',
      event: 'window.editor.blur.set',
    });
  } catch (error) {
    telemetry.error('window.editor.blur.set.failed', {
      message: getErrorMessage(error),
      fields: { enabled },
    });
  }
}

export async function applyEditorLowPerformanceMode(lowPerformanceMode: boolean): Promise<void> {
  await setEditorBlurEnabled(!lowPerformanceMode);
  await broadcastSignal(TAURI_EVENTS.EDITOR_LOW_PERFORMANCE_MODE_UPDATED);
}

export async function syncEditorEffectsFromStorage(): Promise<void> {
  await applyEditorLowPerformanceMode(readEditorLowPerformanceMode());
}
