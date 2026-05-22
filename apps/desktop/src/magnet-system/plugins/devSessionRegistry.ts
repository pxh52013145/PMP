import type {
  PxpManifestV2,
  RuntimeKind,
} from '@pixel-matrix/plugin-platform-contracts';
import { readJson, tryWriteJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastSignal,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  getInstalledExtensionRecord,
  parseInstalledExtensionSourceFromFilePath,
  type InstalledHostExtensionRecord,
} from './extensions';
import { requestInstalledExtensionRuntimeRestart } from './hostExtensionRuntimeSupervisor';

const telemetry = getTelemetryLogger('extensions', 'devSessionRegistry');

type PluginDevSessionListener = () => void;

export type PluginDevSessionMode = 'entry-url' | 'entry-path';
export type PluginDevSupportedRuntimeKind = Extract<RuntimeKind, 'webview' | 'extension-host'>;
export type PluginDevDeferredRuntimeKind = Extract<RuntimeKind, 'sidecar'>;

export interface PluginDevSessionRecord {
  pluginId: string;
  projectRoot: string;
  manifestPath: string;
  mode: PluginDevSessionMode;
  entryUrl?: string;
  entryPath?: string;
  runtimeKinds: PluginDevSupportedRuntimeKind[];
  revision: number;
  updatedAt: number;
  lastError?: string | null;
  lastRestartReason?: string | null;
  lastRestartAt?: number | null;
}

export interface PluginDevProjectSource {
  pluginId: string;
  displayName: string;
  manifest: PxpManifestV2;
  projectRoot: string;
  manifestPath: string;
  installedRecord: InstalledHostExtensionRecord | null;
  availableRuntimeKinds: RuntimeKind[];
  supportedRuntimeKinds: PluginDevSupportedRuntimeKind[];
  deferredRuntimeKinds: PluginDevDeferredRuntimeKind[];
  defaultEntryPath: string | null;
  defaultMode: PluginDevSessionMode;
}

export interface PluginDevSessionEntryResolution {
  path: string;
  field: 'entryUrl' | 'entryPath';
  usedFallback: boolean;
}

type PluginDevProjectAssetScopePayload = {
  manifestPath: string;
  rootDir: string;
};

let revision = 0;
const listeners = new Set<PluginDevSessionListener>();
let syncDisposer: null | (() => void) = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    syncDisposer?.();
    listeners.clear();
    revision = 0;
  });
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifyListeners(): void {
  revision += 1;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('extension.dev_session.listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensureSync(): void {
  if (typeof window === 'undefined' || syncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.EXTENSIONS_V2_DEV_SESSIONS_V1) return;
    notifyListeners();
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(
        TAURI_EVENTS.EXTENSIONS_V2_DEV_SESSIONS_UPDATED,
        (payload) => {
          if (
            payload?.key &&
            payload.key !== STORAGE_KEYS.EXTENSIONS_V2_DEV_SESSIONS_V1
          ) {
            return;
          }
          notifyListeners();
        }
      )
    )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // ignore
    });

  syncDisposer = () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
    syncDisposer = null;
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function isUrlLike(value: string): boolean {
  const normalized = normalizeFsPath(value);
  const isWindowsAbsolutePath = /^[a-zA-Z]:\//.test(normalized);
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized) && !isWindowsAbsolutePath;
}

function isAbsoluteFsPath(value: string): boolean {
  const normalized = normalizeFsPath(value);
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
}

function resolveProjectEntryPath(projectRoot: string, entryPath: string): string {
  const trimmedEntryPath = normalizeString(entryPath);
  if (!trimmedEntryPath) {
    throw new Error('Plugin dev session entryPath is required');
  }

  if (isUrlLike(trimmedEntryPath)) {
    return trimmedEntryPath;
  }

  if (isAbsoluteFsPath(trimmedEntryPath)) {
    return normalizeFsPath(trimmedEntryPath);
  }

  const normalizedRoot = normalizeFsPath(normalizeString(projectRoot)).replace(/\/+$/, '');
  const normalizedEntry = normalizeFsPath(trimmedEntryPath)
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  return `${normalizedRoot}/${normalizedEntry}`;
}

function isSupportedRuntimeKind(value: unknown): value is PluginDevSupportedRuntimeKind {
  return value === 'webview' || value === 'extension-host';
}

function listManifestRuntimeKinds(manifest: PxpManifestV2): RuntimeKind[] {
  return Array.from(
    new Set(
      manifest.runtimes
        .map((runtime) => runtime.kind)
        .filter(
          (runtimeKind): runtimeKind is RuntimeKind =>
            runtimeKind === 'webview' ||
            runtimeKind === 'extension-host' ||
            runtimeKind === 'sidecar'
        )
    )
  );
}

function listSupportedManifestRuntimeKinds(
  manifest: PxpManifestV2
): PluginDevSupportedRuntimeKind[] {
  return listManifestRuntimeKinds(manifest).filter(isSupportedRuntimeKind);
}

function listDeferredManifestRuntimeKinds(
  manifest: PxpManifestV2
): PluginDevDeferredRuntimeKind[] {
  return listManifestRuntimeKinds(manifest).filter(
    (runtimeKind): runtimeKind is PluginDevDeferredRuntimeKind => runtimeKind === 'sidecar'
  );
}

function readDefaultEntryPath(manifest: PxpManifestV2, projectRoot: string): string | null {
  const runtime = manifest.runtimes.find(
    (item) => item.kind === 'extension-host' || item.kind === 'webview'
  );
  if (!runtime) return null;
  return resolveProjectEntryPath(projectRoot, runtime.entry);
}

async function allowPluginDevProjectAssetScope(filePath: string): Promise<void> {
  if (!isTauriRuntime()) return;

  await invokeWithTelemetry<PluginDevProjectAssetScopePayload>(
    'plugin_allow_dev_project_asset_scope',
    { filePath },
    {
      moduleId: 'extensions',
      component: 'devSessionRegistry',
      event: 'plugin.dev_session.asset_scope.allow',
      successLevel: 'debug',
    }
  );
}

function sanitizeRuntimeKinds(value: unknown): PluginDevSupportedRuntimeKind[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter(isSupportedRuntimeKind))
  ).sort((left, right) => left.localeCompare(right));
}

function sanitizeDevSessionRecord(value: unknown): PluginDevSessionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const pluginId = normalizeString((value as Record<string, unknown>).pluginId);
  const projectRoot = normalizeFsPath(
    normalizeString((value as Record<string, unknown>).projectRoot)
  );
  const manifestPath = normalizeFsPath(
    normalizeString((value as Record<string, unknown>).manifestPath)
  );
  const entryUrl = normalizeString((value as Record<string, unknown>).entryUrl);
  const entryPath = normalizeString((value as Record<string, unknown>).entryPath);
  const runtimeKinds = sanitizeRuntimeKinds((value as Record<string, unknown>).runtimeKinds);

  if (!pluginId || !projectRoot || !manifestPath || runtimeKinds.length === 0) {
    return null;
  }

  const mode =
    (value as Record<string, unknown>).mode === 'entry-url' ? 'entry-url' : 'entry-path';
  const revisionValue = (value as Record<string, unknown>).revision;
  const updatedAtValue = (value as Record<string, unknown>).updatedAt;
  const lastRestartAtValue = (value as Record<string, unknown>).lastRestartAt;
  const lastErrorValue = (value as Record<string, unknown>).lastError;
  const lastRestartReasonValue = (value as Record<string, unknown>).lastRestartReason;

  return {
    pluginId,
    projectRoot,
    manifestPath,
    mode,
    ...(entryUrl ? { entryUrl } : {}),
    ...(entryPath ? { entryPath: normalizeFsPath(entryPath) } : {}),
    runtimeKinds,
    revision:
      typeof revisionValue === 'number' && Number.isFinite(revisionValue)
        ? Math.max(1, Math.floor(revisionValue))
        : 1,
    updatedAt:
      typeof updatedAtValue === 'number' && Number.isFinite(updatedAtValue)
        ? updatedAtValue
        : Date.now(),
    ...(typeof lastErrorValue === 'string' && lastErrorValue.trim().length > 0
      ? { lastError: lastErrorValue.trim() }
      : {}),
    ...(typeof lastRestartReasonValue === 'string' &&
    lastRestartReasonValue.trim().length > 0
      ? { lastRestartReason: lastRestartReasonValue.trim() }
      : {}),
    ...(typeof lastRestartAtValue === 'number' && Number.isFinite(lastRestartAtValue)
      ? { lastRestartAt: lastRestartAtValue }
      : {}),
  };
}

function savePluginDevSessions(records: PluginDevSessionRecord[]): boolean {
  if (typeof window === 'undefined') return false;
  const ok = tryWriteJson(STORAGE_KEYS.EXTENSIONS_V2_DEV_SESSIONS_V1, records);
  if (!ok) return false;
  notifyListeners();
  void broadcastSignal(TAURI_EVENTS.EXTENSIONS_V2_DEV_SESSIONS_UPDATED);
  return true;
}

function writeSessionRecord(
  session: PluginDevSessionRecord,
  options: { requestRestartReason?: string | null } = {}
): PluginDevSessionRecord {
  const records = loadPluginDevSessions();
  const index = records.findIndex((entry) => entry.pluginId === session.pluginId);
  if (index >= 0) {
    records.splice(index, 1, session);
  } else {
    records.push(session);
  }
  savePluginDevSessions(records);
  if (options.requestRestartReason) {
    requestInstalledExtensionRuntimeRestart(session.pluginId, {
      reason: options.requestRestartReason,
    });
  }
  return session;
}

export function getPluginDevSessionsRevision(): number {
  return revision;
}

export function subscribePluginDevSessions(listener: PluginDevSessionListener): () => void {
  listeners.add(listener);
  ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
    }
  };
}

export function loadPluginDevSessions(): PluginDevSessionRecord[] {
  if (typeof window === 'undefined') return [];
  const parsed = readJson<unknown>(STORAGE_KEYS.EXTENSIONS_V2_DEV_SESSIONS_V1, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => sanitizeDevSessionRecord(entry))
    .filter((entry): entry is PluginDevSessionRecord => entry !== null);
}

export function getPluginDevSessionRecord(
  pluginId: string
): PluginDevSessionRecord | null {
  const normalizedPluginId = normalizeString(pluginId);
  if (!normalizedPluginId) return null;
  return (
    loadPluginDevSessions().find((entry) => entry.pluginId === normalizedPluginId) ?? null
  );
}

export function getPluginDevSessionRevisionToken(pluginId: string): string | null {
  const session = getPluginDevSessionRecord(pluginId);
  if (!session) return null;
  return [
    session.mode,
    session.revision,
    session.updatedAt,
    session.entryUrl ?? '',
    session.entryPath ?? '',
    session.runtimeKinds.join(','),
  ].join('::');
}

export async function createPluginDevProjectSourceFromPath(
  filePath: string
): Promise<PluginDevProjectSource> {
  const parsed = await parseInstalledExtensionSourceFromFilePath(filePath);
  await allowPluginDevProjectAssetScope(filePath);
  const manifest = parsed.record.manifest;
  const pluginId = manifest.identity.id;
  const installedRecord = getInstalledExtensionRecord(pluginId);
  const displayName = manifest.identity.displayName ?? manifest.identity.name;
  const supportedRuntimeKinds = listSupportedManifestRuntimeKinds(manifest);
  const deferredRuntimeKinds = listDeferredManifestRuntimeKinds(manifest);
  const existingSession = getPluginDevSessionRecord(pluginId);
  const defaultMode =
    existingSession?.mode ??
    (supportedRuntimeKinds.includes('webview') ? 'entry-url' : 'entry-path');

  return {
    pluginId,
    displayName,
    manifest,
    projectRoot: parsed.rootDir,
    manifestPath: parsed.manifestPath,
    installedRecord,
    availableRuntimeKinds: listManifestRuntimeKinds(manifest),
    supportedRuntimeKinds,
    deferredRuntimeKinds,
    defaultEntryPath:
      existingSession?.entryPath ?? readDefaultEntryPath(manifest, parsed.rootDir),
    defaultMode,
  };
}

export function upsertPluginDevSession(
  input: Omit<PluginDevSessionRecord, 'revision' | 'updatedAt'> & {
    revision?: number;
    updatedAt?: number;
  },
  options: { requestRestartReason?: string | null } = {}
): PluginDevSessionRecord {
  const pluginId = normalizeString(input.pluginId);
  if (!pluginId) {
    throw new Error('Plugin dev session pluginId is required');
  }

  const installedRecord = getInstalledExtensionRecord(pluginId);
  if (!installedRecord) {
    throw new Error(
      `Install manifest-v2 extension "${pluginId}" before attaching a dev session`
    );
  }

  const projectRoot = normalizeFsPath(normalizeString(input.projectRoot));
  const manifestPath = normalizeFsPath(normalizeString(input.manifestPath));
  if (!projectRoot || !manifestPath) {
    throw new Error('Plugin dev session projectRoot and manifestPath are required');
  }

  const entryUrl = normalizeString(input.entryUrl);
  const entryPath = normalizeString(input.entryPath);
  if (!entryUrl && !entryPath) {
    throw new Error('Plugin dev session must provide entryUrl or entryPath');
  }

  const runtimeKinds = sanitizeRuntimeKinds(input.runtimeKinds);
  if (runtimeKinds.length === 0) {
    throw new Error('Plugin dev session must target at least one supported runtime kind');
  }

  const previous = getPluginDevSessionRecord(pluginId);
  const now = Date.now();
  const requestRestartReason =
    options.requestRestartReason ??
    (previous ? 'dev-session-updated' : 'dev-session-attached');

  const session: PluginDevSessionRecord = {
    pluginId,
    projectRoot,
    manifestPath,
    mode: input.mode === 'entry-url' ? 'entry-url' : 'entry-path',
    ...(entryUrl ? { entryUrl } : {}),
    ...(entryPath ? { entryPath: normalizeFsPath(entryPath) } : {}),
    runtimeKinds,
    revision:
      typeof input.revision === 'number' && Number.isFinite(input.revision)
        ? Math.max(1, Math.floor(input.revision))
        : (previous?.revision ?? 0) + 1,
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : now,
    lastError:
      typeof input.lastError === 'string' && input.lastError.trim().length > 0
        ? input.lastError.trim()
        : null,
    lastRestartReason: requestRestartReason,
    lastRestartAt: now,
  };

  return writeSessionRecord(session, { requestRestartReason });
}

export function refreshPluginDevSession(
  pluginId: string,
  options: { reason?: string } = {}
): PluginDevSessionRecord | null {
  const existing = getPluginDevSessionRecord(pluginId);
  if (!existing) return null;

  const now = Date.now();
  const reason = normalizeString(options.reason) || 'dev-session-refresh';
  return writeSessionRecord(
    {
      ...existing,
      revision: existing.revision + 1,
      updatedAt: now,
      lastRestartReason: reason,
      lastRestartAt: now,
    },
    { requestRestartReason: reason }
  );
}

export function setPluginDevSessionLastError(
  pluginId: string,
  error: unknown
): PluginDevSessionRecord | null {
  const existing = getPluginDevSessionRecord(pluginId);
  if (!existing) return null;

  return writeSessionRecord({
    ...existing,
    lastError: readErrorMessage(error).slice(0, 2000),
    updatedAt: Date.now(),
  });
}

export function clearPluginDevSessionLastError(
  pluginId: string
): PluginDevSessionRecord | null {
  const existing = getPluginDevSessionRecord(pluginId);
  if (!existing) return null;

  return writeSessionRecord({
    ...existing,
    lastError: null,
    updatedAt: Date.now(),
  });
}

export function detachPluginDevSession(
  pluginId: string,
  options: { requestRestartReason?: string | null } = {}
): boolean {
  const normalizedPluginId = normalizeString(pluginId);
  if (!normalizedPluginId) return false;

  const records = loadPluginDevSessions();
  const nextRecords = records.filter((entry) => entry.pluginId !== normalizedPluginId);
  if (nextRecords.length === records.length) return false;

  savePluginDevSessions(nextRecords);
  const requestRestartReason =
    options.requestRestartReason ?? 'dev-session-detached';
  if (requestRestartReason) {
    requestInstalledExtensionRuntimeRestart(normalizedPluginId, {
      reason: requestRestartReason,
    });
  }
  return true;
}

export function resolvePluginDevSessionEntry(
  session: PluginDevSessionRecord,
  runtimeKind: RuntimeKind
): PluginDevSessionEntryResolution | null {
  if (!session.runtimeKinds.includes(runtimeKind as PluginDevSupportedRuntimeKind)) {
    return null;
  }

  const preferredCandidates =
    session.mode === 'entry-url'
      ? [
          { field: 'entryUrl' as const, value: session.entryUrl, fallback: false },
          { field: 'entryPath' as const, value: session.entryPath, fallback: true },
        ]
      : [
          { field: 'entryPath' as const, value: session.entryPath, fallback: false },
          { field: 'entryUrl' as const, value: session.entryUrl, fallback: true },
        ];

  for (const candidate of preferredCandidates) {
    const value = normalizeString(candidate.value);
    if (!value) continue;
    return {
      path:
        candidate.field === 'entryPath'
          ? resolveProjectEntryPath(session.projectRoot, value)
          : value,
      field: candidate.field,
      usedFallback: candidate.fallback,
    };
  }

  return null;
}
