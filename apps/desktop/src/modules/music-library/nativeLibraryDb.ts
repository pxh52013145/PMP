import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export interface NativeLibrarySourceUpsertInput {
  id: string;
  path: string;
  displayName?: string;
  category?: string;
  isVisible?: boolean;
  isScanned?: boolean;
  addedAtMs?: number;
  lastScannedAtMs?: number;
}

export interface NativeLibrarySourceRecord {
  id: string;
  path: string;
  displayName?: string;
  category: string;
  isVisible: boolean;
  isScanned: boolean;
  addedAtMs: number;
  lastScannedAtMs?: number;
  updatedAtMs: number;
}

export interface NativeLibraryTrackUpsertInput {
  id: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
}

export interface NativeLibraryTrackSyncResult {
  upserted: number;
  markedMissing: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value);
  return normalized || undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function ensureSourceRecord(value: unknown): NativeLibrarySourceRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const path = asTrimmedString(value.path);
  const category = asTrimmedString(value.category) || 'music';
  const isVisible = asBool(value.isVisible);
  const isScanned = asBool(value.isScanned);
  const addedAtMs = asNumber(value.addedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);

  if (!id || !path || isVisible === undefined || isScanned === undefined) return null;
  if (addedAtMs === undefined || updatedAtMs === undefined) return null;

  return {
    id,
    path,
    displayName: asOptionalString(value.displayName),
    category,
    isVisible,
    isScanned,
    addedAtMs,
    lastScannedAtMs: asNumber(value.lastScannedAtMs),
    updatedAtMs,
  };
}

function ensureTrackSyncResult(value: unknown): NativeLibraryTrackSyncResult | null {
  if (!isRecord(value)) return null;
  const upserted = asNumber(value.upserted);
  const markedMissing = asNumber(value.markedMissing);
  if (upserted === undefined || markedMissing === undefined) return null;
  return {
    upserted,
    markedMissing,
  };
}

export async function upsertNativeLibrarySource(
  source: NativeLibrarySourceUpsertInput
): Promise<NativeLibrarySourceRecord | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_db_upsert_source', { source }).catch(() => null);
  return ensureSourceRecord(raw);
}

export async function listNativeLibrarySources(): Promise<NativeLibrarySourceRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_sources').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibrarySourceRecord[] = [];
  for (const item of raw) {
    const parsed = ensureSourceRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function removeNativeLibrarySource(sourceId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const normalized = sourceId.trim();
  if (!normalized) return;
  await invoke('music_library_db_remove_source', { sourceId: normalized });
}

export async function syncNativeLibraryTracks(
  sourceId: string,
  upserts: NativeLibraryTrackUpsertInput[],
  missingTrackIds: string[]
): Promise<NativeLibraryTrackSyncResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return null;

  const raw = await invoke<unknown>('music_library_db_sync_tracks', {
    sourceId: normalizedSourceId,
    upserts,
    missingTrackIds,
  }).catch(() => null);

  return ensureTrackSyncResult(raw);
}

