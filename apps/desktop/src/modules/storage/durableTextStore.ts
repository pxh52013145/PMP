import { isTauriRuntime } from '../../utils/tauriRuntime';

export type DurableTextNamespace = 'pmpm-entry' | 'pmps-fragment';

const IDB_DB_NAME = 'pixel-matrix-player';
const IDB_STORE_NAME = 'durableText';
const IDB_VERSION = 1;

let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise;

  idbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return idbPromise;
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(typeof request.result === 'string' ? request.result : null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB get failed'));
    };
  });
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    store.put(value, key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB put aborted'));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    store.delete(key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'));
  });
}

function buildKey(namespace: DurableTextNamespace, id: string): string {
  return `${namespace}:${id}`;
}

function buildAppDataPath(namespace: DurableTextNamespace, id: string): { dir: string; file: string } {
  const dir = `pmp-durable/${namespace}`;
  const file = `${dir}/${id}.txt`;
  return { dir, file };
}

async function tauriWriteText(namespace: DurableTextNamespace, id: string, value: string): Promise<void> {
  const fs = await import('@tauri-apps/api/fs');
  const { dir, file } = buildAppDataPath(namespace, id);
  await fs.createDir(dir, { dir: fs.BaseDirectory.AppData, recursive: true });
  await fs.writeFile({ path: file, contents: value }, { dir: fs.BaseDirectory.AppData });
}

async function tauriReadText(namespace: DurableTextNamespace, id: string): Promise<string | null> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    const { file } = buildAppDataPath(namespace, id);
    return await fs.readTextFile(file, { dir: fs.BaseDirectory.AppData });
  } catch {
    return null;
  }
}

async function tauriRemoveText(namespace: DurableTextNamespace, id: string): Promise<void> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    const { file } = buildAppDataPath(namespace, id);
    await fs.removeFile(file, { dir: fs.BaseDirectory.AppData });
  } catch {
    // best-effort
  }
}

export async function writeDurableText(
  namespace: DurableTextNamespace,
  id: string,
  value: string
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    if (isTauriRuntime()) {
      await tauriWriteText(namespace, id, value);
      return true;
    }

    await idbSet(buildKey(namespace, id), value);
    return true;
  } catch (error) {
    console.warn(`[storage] Failed to write durable text ${namespace}/${id}`, error);
    return false;
  }
}

export async function readDurableText(namespace: DurableTextNamespace, id: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    if (isTauriRuntime()) {
      return await tauriReadText(namespace, id);
    }
    return await idbGet(buildKey(namespace, id));
  } catch (error) {
    console.warn(`[storage] Failed to read durable text ${namespace}/${id}`, error);
    return null;
  }
}

export async function removeDurableText(namespace: DurableTextNamespace, id: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if (isTauriRuntime()) {
      await tauriRemoveText(namespace, id);
      return;
    }
    await idbDelete(buildKey(namespace, id));
  } catch (error) {
    console.warn(`[storage] Failed to remove durable text ${namespace}/${id}`, error);
  }
}

