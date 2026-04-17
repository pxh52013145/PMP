import { isTauriRuntime } from '../../utils/tauriRuntime';

export async function pickMusicPlatformGlobalCacheDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  try {
    const dialog = await import('@tauri-apps/api/dialog');
    const selected = await dialog.open({ directory: true, multiple: false });
    if (typeof selected === 'string' && selected.trim().length > 0) {
      return selected.trim();
    }
  } catch {
    // user cancel or dialog unavailable
  }

  return null;
}
