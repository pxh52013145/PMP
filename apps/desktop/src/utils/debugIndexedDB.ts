import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('debug', 'debugIndexedDB');

const DATABASE_NAME = 'MusicLibrary';
const DATABASE_VERSION = 1;
const TRACKS_STORE = 'tracks';

type CoverUrlKind = 'none' | 'blob' | 'data' | 'http' | 'other';

export type IndexedDbTrackSummary = {
  id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrlKind: CoverUrlKind;
  hasLyrics: boolean;
  hasFileContent: boolean;
};

export type IndexedDbDebugResult = {
  databaseName: string;
  version: number;
  objectStores: string[];
  hasTracksStore: boolean;
  trackCount: number;
  firstTrack: IndexedDbTrackSummary | null;
};

export type IndexedDbClearResult = {
  databaseName: string;
  cleared: boolean;
};

type DebugWindow = Window & {
  debugIndexedDB?: typeof debugIndexedDB;
  clearIndexedDB?: typeof clearIndexedDB;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getCoverUrlKind(value: unknown): CoverUrlKind {
  if (typeof value !== 'string' || value.length === 0) return 'none';
  if (value.startsWith('blob:')) return 'blob';
  if (value.startsWith('data:')) return 'data';
  if (value.startsWith('http://') || value.startsWith('https://')) return 'http';
  return 'other';
}

function summarizeTrack(value: unknown): IndexedDbTrackSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    id: readStringField(record, 'id'),
    title: readStringField(record, 'title'),
    artist: readStringField(record, 'artist'),
    album: readStringField(record, 'album'),
    coverUrlKind: getCoverUrlKind(record.coverUrl),
    hasLyrics: typeof record.lyrics === 'string' && record.lyrics.length > 0,
    hasFileContent: record.fileContent instanceof ArrayBuffer,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export async function debugIndexedDB(): Promise<IndexedDbDebugResult> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const objectStores = Array.from(db.objectStoreNames);
    const hasTracksStore = objectStores.includes(TRACKS_STORE);

    if (!hasTracksStore) {
      const result: IndexedDbDebugResult = {
        databaseName: db.name,
        version: db.version,
        objectStores,
        hasTracksStore,
        trackCount: 0,
        firstTrack: null,
      };
      telemetry.info('indexeddb.inspect.completed', {
        fields: {
          databaseName: result.databaseName,
          version: result.version,
          objectStoreCount: result.objectStores.length,
          hasTracksStore: false,
          trackCount: 0,
        },
      });
      return result;
    }

    const transaction = db.transaction([TRACKS_STORE], 'readonly');
    const store = transaction.objectStore(TRACKS_STORE);
    const [trackCount, cursor] = await Promise.all([
      requestToPromise(store.count()),
      requestToPromise(store.openCursor()),
    ]);

    const result: IndexedDbDebugResult = {
      databaseName: db.name,
      version: db.version,
      objectStores,
      hasTracksStore,
      trackCount,
      firstTrack: summarizeTrack(cursor?.value),
    };

    telemetry.info('indexeddb.inspect.completed', {
      fields: {
        databaseName: result.databaseName,
        version: result.version,
        objectStoreCount: result.objectStores.length,
        hasTracksStore: result.hasTracksStore,
        trackCount: result.trackCount,
        firstTrackId: result.firstTrack?.id ?? null,
        firstTrackCoverUrlKind: result.firstTrack?.coverUrlKind ?? 'none',
        firstTrackHasFileContent: result.firstTrack?.hasFileContent ?? false,
        firstTrackHasLyrics: result.firstTrack?.hasLyrics ?? false,
      },
    });

    return result;
  } catch (error) {
    telemetry.error('indexeddb.inspect.failed', {
      message: getErrorMessage(error),
      fields: {
        databaseName: DATABASE_NAME,
      },
    });
    throw error;
  } finally {
    db?.close();
  }
}

export async function clearIndexedDB(): Promise<IndexedDbClearResult> {
  return new Promise<IndexedDbClearResult>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => {
      const result: IndexedDbClearResult = {
        databaseName: DATABASE_NAME,
        cleared: true,
      };
      telemetry.info('indexeddb.clear.completed', {
        fields: {
          databaseName: DATABASE_NAME,
        },
      });
      resolve(result);
    };
    request.onerror = () => {
      const error = request.error ?? new Error('IndexedDB clear failed');
      telemetry.error('indexeddb.clear.failed', {
        message: getErrorMessage(error),
        fields: {
          databaseName: DATABASE_NAME,
        },
      });
      reject(error);
    };
    request.onblocked = () => {
      const error = new Error('IndexedDB clear blocked');
      telemetry.warn('indexeddb.clear.blocked', {
        message: error.message,
        fields: {
          databaseName: DATABASE_NAME,
        },
      });
      reject(error);
    };
  });
}

if (typeof window !== 'undefined') {
  const debugWindow = window as DebugWindow;
  debugWindow.debugIndexedDB = debugIndexedDB;
  debugWindow.clearIndexedDB = clearIndexedDB;
}
