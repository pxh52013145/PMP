import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readJson,
  readString,
  writeJson,
  writeString,
  PMP_STORAGE_CHANGE_EVENT,
  type PmpStorageChangeDetail,
  StorageWriteOptions,
} from './localStorage';

export type PersistentFormat = 'string' | 'json';

export interface UsePersistentSettingOptions extends StorageWriteOptions {
  format?: PersistentFormat;
  listenStorageEvents?: boolean;
}

function inferFormat<T>(defaultValue: T): PersistentFormat {
  return typeof defaultValue === 'string' ? 'string' : 'json';
}

export function usePersistentSetting<T>(
  key: string,
  defaultValue: T,
  options: UsePersistentSettingOptions = {}
): [T, (next: T | ((prev: T) => T)) => void] {
  const format = options.format ?? inferFormat(defaultValue);
  const listenStorageEvents = options.listenStorageEvents ?? false;

  const read = useCallback((): T => {
    if (format === 'string') {
      return ((readString(key) ?? defaultValue) as unknown) as T;
    }
    return readJson<T>(key, defaultValue);
  }, [defaultValue, format, key]);

  const [value, setValue] = useState<T>(() => read());

  const write = useMemo(() => {
    if (format === 'string') {
      return (next: T) => writeString(key, String(next), options);
    }
    return (next: T) => writeJson(key, next, options);
  }, [format, key, options]);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        write(resolved);
        return resolved;
      });
    },
    [write]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
      if (!detail || detail.key !== key) return;

      if (format === 'string') {
        setValue(((detail.value ?? defaultValue) as unknown) as T);
        return;
      }

      if (detail.value === null) {
        setValue(defaultValue);
        return;
      }

      try {
        setValue(JSON.parse(detail.value) as T);
      } catch {
        setValue(defaultValue);
      }
    };

    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, handler as EventListener);
  }, [defaultValue, format, key]);

  useEffect(() => {
    if (!listenStorageEvents) return;

    const handler = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key !== key) return;
      setValue(read());
    };

    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key, listenStorageEvents, read]);

  return [value, setAndPersist];
}
