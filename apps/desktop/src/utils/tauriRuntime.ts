export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;

  const tauriInjected = typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined';
  if (!tauriInjected) return false;

  const href = window.location?.href ?? '';
  const isAboutBlank = href.startsWith('about:blank');
  if (!isAboutBlank) return true;

  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return true;
  }

  return false;
}
