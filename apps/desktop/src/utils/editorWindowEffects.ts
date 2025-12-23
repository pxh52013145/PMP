import { invoke } from '@tauri-apps/api/tauri';
import { readJson } from '../modules/storage';
import { broadcastSignal, STORAGE_KEYS, TAURI_EVENTS } from './windowCommunication';
import { isTauriRuntime } from './tauriRuntime';

export function readEditorLowPerformanceMode(): boolean {
  return readJson<boolean>(STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE, false);
}

export async function setEditorBlurEnabled(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('set_editor_blur_enabled', { enabled });
  } catch (error) {
    console.error('Failed to set editor blur state:', error);
  }
}

export async function applyEditorLowPerformanceMode(lowPerformanceMode: boolean): Promise<void> {
  await setEditorBlurEnabled(!lowPerformanceMode);
  await broadcastSignal(TAURI_EVENTS.EDITOR_LOW_PERFORMANCE_MODE_UPDATED);
}

export async function syncEditorEffectsFromStorage(): Promise<void> {
  await applyEditorLowPerformanceMode(readEditorLowPerformanceMode());
}
