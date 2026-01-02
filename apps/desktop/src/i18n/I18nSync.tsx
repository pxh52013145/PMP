import { useEffect } from 'react';
import { setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../utils/windowCommunication';
import { setLocale } from './core';
import { readPersistedLocale } from './persistedLocale';

export function I18nSync() {
  useEffect(() => {
    setLocale(readPersistedLocale());

    let disposed = false;
    let cleanup: (() => void) | null = null;
    void setupDualListener([STORAGE_KEYS.LOCALE], [TAURI_EVENTS.LOCALE_UPDATED], () => {
      setLocale(readPersistedLocale());
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      cleanup = fn;
    });

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, []);

  return null;
}
