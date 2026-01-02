import { useMemo, useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, translate, type Locale } from './core';

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useT(): (key: string, params?: Record<string, unknown>) => string {
  const locale = useLocale();
  return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}

