import { readJson } from '../storage';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  setupDualListener,
} from '../../utils/windowCommunication';
import {
  createPlatformPackDevSourceSnapshot,
  inspectPlatformPackDevSourceChanges,
  readPlatformPackDevSourceFromPath,
  type PlatformPackDevSource,
  type PlatformPackDevSourceSnapshot,
} from './platformPackDevSource';
import {
  recordPlatformPackDevInstanceReloadFailure,
  reloadPlatformPackDevInstanceBinding,
  type PlatformPackDevInstanceBindingRecord,
  type PlatformPackDevInstanceBindResult,
} from './platformPackDevBinding';

export type PlatformPackDevWatcherStatus =
  | 'disabled'
  | 'watching'
  | 'validating'
  | 'pending'
  | 'reloading'
  | 'error';

export type PlatformPackDevWatcherChangeKind =
  | 'initial'
  | 'runtime-only'
  | 'manifest-contract'
  | 'asset'
  | 'sidecar'
  | 'mixed'
  | 'none';

export type PlatformPackDevWatcherFileKind =
  | 'manifest'
  | 'contract'
  | 'runtime'
  | 'icon'
  | 'sidecar';

export interface PlatformPackDevWatcherChangeRecord {
  at: number;
  changeKind: PlatformPackDevWatcherChangeKind;
  changedFiles: PlatformPackDevWatcherFileKind[];
  sourceStatus: PlatformPackDevSource['status'];
  summary: string;
}

export interface PlatformPackDevWatcherReloadRecord {
  at: number;
  status: 'success' | 'error';
  changeKind: PlatformPackDevWatcherChangeKind;
  changedFiles: PlatformPackDevWatcherFileKind[];
  revision: number;
  message: string | null;
}

export interface PlatformPackDevWatcherRecord {
  instanceId: string;
  rootDir: string;
  enabled: boolean;
  intervalMs: number;
  status: PlatformPackDevWatcherStatus;
  lastSnapshot: PlatformPackDevSourceSnapshot | null;
  lastCheckedAt: number | null;
  lastChange: PlatformPackDevWatcherChangeRecord | null;
  pendingReload: PlatformPackDevWatcherChangeRecord | null;
  lastAutoReload: PlatformPackDevWatcherReloadRecord | null;
  lastError: string | null;
  lastHandledChangeKey: string | null;
  updatedAt: number;
}

export interface PlatformPackDevWatcherPassResult {
  action:
    | 'skipped'
    | 'baseline'
    | 'unchanged'
    | 'pending'
    | 'auto-reloaded'
    | 'validation-error'
    | 'reload-error';
  source: PlatformPackDevSource | null;
  watcher: PlatformPackDevWatcherRecord | null;
}

export interface PlatformPackDevWatcherPassDependencies {
  now?: () => number;
  readSource?: (rootDir: string) => Promise<PlatformPackDevSource>;
  reloadBinding?: (
    record: PlatformPackDevInstanceBindingRecord
  ) => Promise<PlatformPackDevInstanceBindResult>;
  recordReloadFailure?: (
    record: PlatformPackDevInstanceBindingRecord,
    error: unknown,
    options?: { revision?: number }
  ) => PlatformPackDevInstanceBindingRecord | null;
}

type PlatformPackDevWatcherListener = () => void;

const DEFAULT_WATCHER_INTERVAL_MS = 1200;
const MIN_WATCHER_INTERVAL_MS = 500;
const MAX_WATCHER_INTERVAL_MS = 10000;
const listeners = new Set<PlatformPackDevWatcherListener>();
let revision = 0;
let syncDisposer: (() => void) | null = null;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function normalizeInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_WATCHER_INTERVAL_MS, Math.max(MIN_WATCHER_INTERVAL_MS, Math.floor(value)))
    : DEFAULT_WATCHER_INTERVAL_MS;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatChangeSummary(
  changeKind: PlatformPackDevWatcherChangeKind,
  changedFiles: PlatformPackDevWatcherFileKind[]
): string {
  if (changeKind === 'none') return 'No watched file changes';
  if (changeKind === 'initial') return 'Watcher baseline captured';
  return `${changeKind}: ${changedFiles.join(', ')}`;
}

function sanitizeChangeRecord(value: unknown): PlatformPackDevWatcherChangeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const changeKind = normalizeString(item.changeKind) as PlatformPackDevWatcherChangeKind;
  if (
    ![
      'initial',
      'runtime-only',
      'manifest-contract',
      'asset',
      'sidecar',
      'mixed',
      'none',
    ].includes(changeKind)
  ) {
    return null;
  }
  const changedFiles = Array.isArray(item.changedFiles)
    ? item.changedFiles.filter((entry): entry is PlatformPackDevWatcherFileKind =>
        ['manifest', 'contract', 'runtime', 'icon', 'sidecar'].includes(String(entry))
      )
    : [];
  const sourceStatus =
    item.sourceStatus === 'degraded' || item.sourceStatus === 'error'
      ? item.sourceStatus
      : 'ready';
  return {
    at: normalizeTimestamp(item.at) ?? Date.now(),
    changeKind,
    changedFiles,
    sourceStatus,
    summary: normalizeString(item.summary) || formatChangeSummary(changeKind, changedFiles),
  };
}

function sanitizeReloadRecord(value: unknown): PlatformPackDevWatcherReloadRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const status = item.status === 'error' ? 'error' : item.status === 'success' ? 'success' : null;
  const change = sanitizeChangeRecord(item);
  const revisionValue =
    typeof item.revision === 'number' && Number.isFinite(item.revision)
      ? Math.max(1, Math.floor(item.revision))
      : 1;
  if (!status || !change) return null;
  return {
    at: normalizeTimestamp(item.at) ?? change.at,
    status,
    changeKind: change.changeKind,
    changedFiles: change.changedFiles,
    revision: revisionValue,
    message: normalizeString(item.message) || null,
  };
}

function sanitizeWatcher(value: unknown): PlatformPackDevWatcherRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const instanceId = normalizeString(item.instanceId);
  const rootDir = normalizeString(item.rootDir);
  if (!instanceId || !rootDir) return null;
  const status = normalizeString(item.status) as PlatformPackDevWatcherStatus;
  return {
    instanceId,
    rootDir,
    enabled: item.enabled === true,
    intervalMs: normalizeInterval(item.intervalMs),
    status:
      status === 'watching' ||
      status === 'validating' ||
      status === 'pending' ||
      status === 'reloading' ||
      status === 'error'
        ? status
        : item.enabled === true
          ? 'watching'
          : 'disabled',
    lastSnapshot:
      item.lastSnapshot && typeof item.lastSnapshot === 'object'
        ? (item.lastSnapshot as PlatformPackDevSourceSnapshot)
        : null,
    lastCheckedAt: normalizeTimestamp(item.lastCheckedAt),
    lastChange: sanitizeChangeRecord(item.lastChange),
    pendingReload: sanitizeChangeRecord(item.pendingReload),
    lastAutoReload: sanitizeReloadRecord(item.lastAutoReload),
    lastError: normalizeString(item.lastError) || null,
    lastHandledChangeKey: normalizeString(item.lastHandledChangeKey) || null,
    updatedAt: normalizeTimestamp(item.updatedAt) ?? Date.now(),
  };
}

function cloneWatcher(record: PlatformPackDevWatcherRecord): PlatformPackDevWatcherRecord {
  return {
    ...record,
    lastSnapshot: record.lastSnapshot ? JSON.parse(JSON.stringify(record.lastSnapshot)) : null,
    lastChange: record.lastChange ? { ...record.lastChange, changedFiles: record.lastChange.changedFiles.slice() } : null,
    pendingReload: record.pendingReload
      ? { ...record.pendingReload, changedFiles: record.pendingReload.changedFiles.slice() }
      : null,
    lastAutoReload: record.lastAutoReload
      ? { ...record.lastAutoReload, changedFiles: record.lastAutoReload.changedFiles.slice() }
      : null,
  };
}

function emitRevision(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

async function ensureSync(): Promise<void> {
  if (syncDisposer || typeof window === 'undefined') return;
  syncDisposer = await setupDualListener(
    [STORAGE_KEYS.PLATFORM_PACK_DEV_WATCHERS_V1],
    [TAURI_EVENTS.PLATFORM_PACK_DEV_WATCHERS_UPDATED],
    emitRevision
  );
}

function saveWatchers(records: PlatformPackDevWatcherRecord[]): void {
  const next = records
    .map((record) => cloneWatcher(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  void broadcastDataUpdate(
    STORAGE_KEYS.PLATFORM_PACK_DEV_WATCHERS_V1,
    next,
    TAURI_EVENTS.PLATFORM_PACK_DEV_WATCHERS_UPDATED
  );
  emitRevision();
}

function upsertWatcher(record: PlatformPackDevWatcherRecord): PlatformPackDevWatcherRecord {
  const records = listPlatformPackDevWatchers().filter(
    (item) => item.instanceId !== record.instanceId
  );
  records.push(cloneWatcher(record));
  saveWatchers(records);
  return cloneWatcher(record);
}

function readOrCreateWatcher(
  binding: PlatformPackDevInstanceBindingRecord,
  now = Date.now()
): PlatformPackDevWatcherRecord {
  return (
    getPlatformPackDevWatcher(binding.instanceId) ?? {
      instanceId: binding.instanceId,
      rootDir: binding.rootDir,
      enabled: false,
      intervalMs: DEFAULT_WATCHER_INTERVAL_MS,
      status: 'disabled',
      lastSnapshot: null,
      lastCheckedAt: null,
      lastChange: null,
      pendingReload: null,
      lastAutoReload: null,
      lastError: null,
      lastHandledChangeKey: null,
      updatedAt: now,
    }
  );
}

function createChangeRecord(
  at: number,
  source: PlatformPackDevSource,
  changeKind: PlatformPackDevWatcherChangeKind,
  changedFiles: PlatformPackDevWatcherFileKind[]
): PlatformPackDevWatcherChangeRecord {
  return {
    at,
    changeKind,
    changedFiles,
    sourceStatus: source.status,
    summary: formatChangeSummary(changeKind, changedFiles),
  };
}

export function getPlatformPackDevWatchersRevision(): number {
  return revision;
}

export function subscribePlatformPackDevWatchers(
  listener: PlatformPackDevWatcherListener
): () => void {
  listeners.add(listener);
  void ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
      syncDisposer = null;
    }
  };
}

export function listPlatformPackDevWatchers(): PlatformPackDevWatcherRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = readJson<unknown>(STORAGE_KEYS.PLATFORM_PACK_DEV_WATCHERS_V1, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeWatcher(item))
    .filter((item): item is PlatformPackDevWatcherRecord => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((record) => cloneWatcher(record));
}

export function getPlatformPackDevWatcher(
  instanceId?: string | null
): PlatformPackDevWatcherRecord | null {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) return null;
  return (
    listPlatformPackDevWatchers().find(
      (record) => record.instanceId === normalizedInstanceId
    ) ?? null
  );
}

export function setPlatformPackDevWatcherEnabled(
  binding: PlatformPackDevInstanceBindingRecord,
  enabled: boolean,
  options: { intervalMs?: number } = {}
): PlatformPackDevWatcherRecord {
  const now = Date.now();
  const previous = readOrCreateWatcher(binding, now);
  return upsertWatcher({
    ...previous,
    rootDir: binding.rootDir,
    enabled,
    intervalMs: normalizeInterval(options.intervalMs ?? previous.intervalMs),
    status: enabled ? 'watching' : 'disabled',
    pendingReload: enabled ? previous.pendingReload : null,
    lastError: enabled ? previous.lastError : null,
    updatedAt: now,
  });
}

export function primePlatformPackDevWatcherSnapshot(
  instanceId: string,
  source: PlatformPackDevSource
): PlatformPackDevWatcherRecord | null {
  const previous = getPlatformPackDevWatcher(instanceId);
  if (!previous) return null;
  return upsertWatcher({
    ...previous,
    rootDir: source.rootDir || previous.rootDir,
    status: previous.enabled ? 'watching' : 'disabled',
    lastSnapshot: createPlatformPackDevSourceSnapshot(source),
    pendingReload: null,
    lastError: null,
    lastCheckedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function clearPlatformPackDevWatcherPending(
  instanceId: string,
  source?: PlatformPackDevSource | null
): PlatformPackDevWatcherRecord | null {
  const previous = getPlatformPackDevWatcher(instanceId);
  if (!previous) return null;
  return upsertWatcher({
    ...previous,
    status: previous.enabled ? 'watching' : 'disabled',
    lastSnapshot: source ? createPlatformPackDevSourceSnapshot(source) : previous.lastSnapshot,
    pendingReload: null,
    lastError: null,
    lastCheckedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function runPlatformPackDevWatcherPass(
  binding: PlatformPackDevInstanceBindingRecord,
  deps: PlatformPackDevWatcherPassDependencies = {}
): Promise<PlatformPackDevWatcherPassResult> {
  const now = deps.now?.() ?? Date.now();
  const currentWatcher = readOrCreateWatcher(binding, now);
  if (!currentWatcher.enabled) {
    return { action: 'skipped', source: null, watcher: currentWatcher };
  }

  upsertWatcher({
    ...currentWatcher,
    rootDir: binding.rootDir,
    status: 'validating',
    lastCheckedAt: now,
    updatedAt: now,
  });

  const readSource = deps.readSource ?? readPlatformPackDevSourceFromPath;
  const reloadBinding = deps.reloadBinding ?? reloadPlatformPackDevInstanceBinding;
  const recordReloadFailure =
    deps.recordReloadFailure ?? recordPlatformPackDevInstanceReloadFailure;

  let source: PlatformPackDevSource;
  try {
    source = await readSource(binding.rootDir);
  } catch (error) {
    const message = readErrorMessage(error).slice(0, 2000);
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: binding.rootDir,
      status: 'error',
      lastCheckedAt: now,
      lastError: message,
      updatedAt: now,
    });
    recordReloadFailure(binding, error, { revision: binding.revision + 1 });
    return { action: 'validation-error', source: null, watcher: nextWatcher };
  }

  const snapshot = createPlatformPackDevSourceSnapshot(source);
  const decision = inspectPlatformPackDevSourceChanges(currentWatcher.lastSnapshot, snapshot);
  const change = createChangeRecord(now, source, decision.changeKind, decision.changedFiles);

  if (decision.changeKind === 'initial') {
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: source.rootDir || binding.rootDir,
      status: 'watching',
      lastSnapshot: snapshot,
      lastCheckedAt: now,
      lastChange: change,
      pendingReload: null,
      lastError: null,
      updatedAt: now,
    });
    return { action: 'baseline', source, watcher: nextWatcher };
  }

  if (decision.changeKind === 'none') {
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: source.rootDir || binding.rootDir,
      status: 'watching',
      lastCheckedAt: now,
      lastError: null,
      updatedAt: now,
    });
    return { action: 'unchanged', source, watcher: nextWatcher };
  }

  const duplicateChange = currentWatcher.lastHandledChangeKey === decision.changeKey;
  if (source.status !== 'ready') {
    const diagnostic =
      source.diagnostics.find((item) => item.severity === 'error') ??
      source.diagnostics[0] ??
      null;
    const message = diagnostic?.message ?? 'Platform pack dry-run validation failed';
    if (!duplicateChange) {
      recordReloadFailure(binding, message, { revision: binding.revision + 1 });
    }
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: source.rootDir || binding.rootDir,
      status: 'error',
      lastSnapshot: snapshot,
      lastCheckedAt: now,
      lastChange: change,
      pendingReload: change,
      lastError: message,
      lastHandledChangeKey: decision.changeKey,
      lastAutoReload: {
        at: now,
        status: 'error',
        changeKind: decision.changeKind,
        changedFiles: decision.changedFiles,
        revision: binding.revision + 1,
        message,
      },
      updatedAt: now,
    });
    return { action: 'validation-error', source, watcher: nextWatcher };
  }

  if (decision.requiresConfirmation || !decision.canAutoReload) {
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: source.rootDir || binding.rootDir,
      status: 'pending',
      lastSnapshot: snapshot,
      lastCheckedAt: now,
      lastChange: change,
      pendingReload: change,
      lastError: null,
      lastHandledChangeKey: decision.changeKey,
      updatedAt: now,
    });
    return { action: 'pending', source, watcher: nextWatcher };
  }

  upsertWatcher({
    ...currentWatcher,
    rootDir: source.rootDir || binding.rootDir,
    status: 'reloading',
    lastSnapshot: snapshot,
    lastCheckedAt: now,
    lastChange: change,
    pendingReload: null,
    lastError: null,
    lastHandledChangeKey: decision.changeKey,
    updatedAt: now,
  });

  try {
    const result = await reloadBinding(binding);
    const nextSnapshot = createPlatformPackDevSourceSnapshot(result.source ?? source);
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: result.source.rootDir || source.rootDir || binding.rootDir,
      status: 'watching',
      lastSnapshot: nextSnapshot,
      lastCheckedAt: now,
      lastChange: change,
      pendingReload: null,
      lastError: null,
      lastHandledChangeKey: decision.changeKey,
      lastAutoReload: {
        at: now,
        status: 'success',
        changeKind: decision.changeKind,
        changedFiles: decision.changedFiles,
        revision: result.record.revision,
        message: null,
      },
      updatedAt: now,
    });
    return { action: 'auto-reloaded', source: result.source, watcher: nextWatcher };
  } catch (error) {
    const message = readErrorMessage(error).slice(0, 2000);
    const nextWatcher = upsertWatcher({
      ...currentWatcher,
      rootDir: source.rootDir || binding.rootDir,
      status: 'error',
      lastSnapshot: snapshot,
      lastCheckedAt: now,
      lastChange: change,
      pendingReload: null,
      lastError: message,
      lastHandledChangeKey: decision.changeKey,
      lastAutoReload: {
        at: now,
        status: 'error',
        changeKind: decision.changeKind,
        changedFiles: decision.changedFiles,
        revision: binding.revision + 1,
        message,
      },
      updatedAt: now,
    });
    return { action: 'reload-error', source, watcher: nextWatcher };
  }
}
