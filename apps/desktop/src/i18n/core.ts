import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

export type Messages = Record<string, string>;

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: Locale = 'zh-CN';

const resources: Record<Locale, Messages> = {
  'zh-CN': zhCN as Messages,
  'en-US': enUS as Messages,
};

let currentLocale: Locale = FALLBACK_LOCALE;

type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

export function getLocale(): Locale {
  return currentLocale;
}

export function isLocale(value: unknown): value is Locale {
  if (typeof value !== 'string') return false;
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : FALLBACK_LOCALE;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const listener of localeListeners) {
    listener();
  }
}

export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

function formatMessage(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
  });
}

export function translate(locale: Locale, key: string, params?: Record<string, unknown>): string {
  const messages = resources[locale] ?? resources[FALLBACK_LOCALE];
  const template = messages[key] ?? resources[FALLBACK_LOCALE][key] ?? key;
  return formatMessage(template, params);
}

export function t(key: string, params?: Record<string, unknown>): string {
  return translate(currentLocale, key, params);
}
