import { readJson, readString, tryWriteJson } from '../modules/storage';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { resolveLocale, type Locale } from './core';

export function readPersistedLocale(): Locale {
  const json = readJson<string | null>(STORAGE_KEYS.LOCALE, null);
  if (typeof json === 'string') {
    return resolveLocale(json);
  }

  const raw = readString(STORAGE_KEYS.LOCALE);
  const locale = resolveLocale(raw);

  if (typeof raw === 'string' && raw === locale) {
    // Migrate legacy string storage into JSON-string format (best-effort).
    tryWriteJson(STORAGE_KEYS.LOCALE, locale);
  }

  return locale;
}

