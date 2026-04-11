import { isTauriRuntime } from '../../../utils/tauriRuntime';

export async function createInstalledExtensionEntryUrl(entryPath: string): Promise<string> {
  const normalizedPath = entryPath.replace(/\\/g, '/');
  const isWindowsAbsolutePath = /^[a-zA-Z]:\//.test(normalizedPath);
  const isUrlLike = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalizedPath);

  if (isUrlLike && !isWindowsAbsolutePath) {
    return normalizedPath;
  }

  if (isTauriRuntime()) {
    const tauriApi = await import('@tauri-apps/api/tauri');
    if (typeof tauriApi.convertFileSrc === 'function') {
      return tauriApi.convertFileSrc(entryPath);
    }
  }

  throw new Error('Installed extension entry URL is not configured');
}
