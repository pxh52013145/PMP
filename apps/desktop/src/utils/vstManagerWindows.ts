import { invoke } from '@tauri-apps/api/tauri';
import { calculatePluginWindowPosition } from './pluginWindows';
import { isTauriRuntime } from './tauriRuntime';

export async function openVstManagerWindow(options?: {
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('VST manager windows require the Tauri runtime (use `pnpm dev:tauri`).');
  }

  const width = options?.width ?? 1024;
  const height = options?.height ?? 680;

  const position =
    typeof options?.x === 'number' &&
    typeof options?.y === 'number' &&
    isFinite(options.x) &&
    isFinite(options.y)
      ? { x: options.x, y: options.y, width, height }
      : await calculatePluginWindowPosition({ width, height });

  await invoke('open_vst_manager_window', {
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
    title: options?.title ?? null,
  });
}

export async function closeVstManagerWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('close_vst_manager_window');
}

