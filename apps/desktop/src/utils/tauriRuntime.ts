export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined'
  );
}
