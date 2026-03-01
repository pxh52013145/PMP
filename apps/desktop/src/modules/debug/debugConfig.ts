import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export type VstSidechainModeOverride = 'disabled' | 'silence' | 'self';

export type DebugVstBridgeConfig = {
  stderr: boolean;
  logEditor: boolean;
  minidump: boolean;
  minidumpDir: string | null;
  editorSafeMode: boolean | null;
  sidechainMode: VstSidechainModeOverride | null;
};

export type DebugConfig = {
  version: number;
  enabled: boolean;
  openDebugCenterOnNextStart: boolean;
  vstBridge: DebugVstBridgeConfig;
};

export type DebugEnvSnapshot = Record<string, string | null>;

export type RecentGitCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  committedAtIso: string;
};

const DEFAULT_CONFIG: DebugConfig = {
  version: 1,
  enabled: false,
  openDebugCenterOnNextStart: false,
  vstBridge: {
    stderr: false,
    logEditor: false,
    minidump: false,
    minidumpDir: null,
    editorSafeMode: null,
    sidechainMode: null,
  },
};

function cloneDefault(): DebugConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as DebugConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readBool(record: Record<string, unknown> | null, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(record: Record<string, unknown> | null, key: string, fallback: number): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readOptionalString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readSidechainMode(
  record: Record<string, unknown> | null,
  key: string
): VstSidechainModeOverride | null {
  const value = record?.[key];
  if (value === 'disabled' || value === 'silence' || value === 'self') return value;
  return null;
}

export function ensureDebugConfig(value: unknown): DebugConfig {
  const record = isRecord(value) ? value : null;
  const vstBridgeRecord = isRecord(record?.vstBridge)
    ? (record?.vstBridge as Record<string, unknown>)
    : null;

  return {
    version: readNumber(record, 'version', DEFAULT_CONFIG.version),
    enabled: readBool(record, 'enabled', DEFAULT_CONFIG.enabled),
    openDebugCenterOnNextStart: readBool(
      record,
      'openDebugCenterOnNextStart',
      DEFAULT_CONFIG.openDebugCenterOnNextStart
    ),
    vstBridge: {
      stderr: readBool(vstBridgeRecord, 'stderr', DEFAULT_CONFIG.vstBridge.stderr),
      logEditor: readBool(vstBridgeRecord, 'logEditor', DEFAULT_CONFIG.vstBridge.logEditor),
      minidump: readBool(vstBridgeRecord, 'minidump', DEFAULT_CONFIG.vstBridge.minidump),
      minidumpDir: readOptionalString(vstBridgeRecord, 'minidumpDir'),
      editorSafeMode: readOptionalBoolean(vstBridgeRecord, 'editorSafeMode'),
      sidechainMode: readSidechainMode(vstBridgeRecord, 'sidechainMode'),
    },
  };
}

export function getDefaultDebugConfig(): DebugConfig {
  return cloneDefault();
}

export async function getDebugConfig(): Promise<DebugConfig> {
  if (!isTauriRuntime()) return getDefaultDebugConfig();
  const raw = await invoke<unknown>('debug_get_config').catch(() => null);
  return ensureDebugConfig(raw);
}

export async function setDebugConfig(config: DebugConfig): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('debug_set_config', { config });
}

export async function getDebugEnvSnapshot(): Promise<DebugEnvSnapshot> {
  if (!isTauriRuntime()) return {};
  const raw = await invoke<unknown>('debug_get_env_snapshot').catch(() => null);
  if (!isRecord(raw)) return {};

  const snapshot: DebugEnvSnapshot = {};
  for (const [key, value] of Object.entries(raw)) {
    snapshot[key] = typeof value === 'string' ? value : null;
  }
  return snapshot;
}

function shouldUseSoftRestartInCurrentRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return true;

  try {
    const currentUrl = new URL(window.location.href);
    return (
      currentUrl.protocol === 'http:' &&
      (currentUrl.hostname === 'localhost' || currentUrl.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

function softReloadCurrentWindow(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    window.location.reload();
  }, 0);
}

export async function restartApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  if (shouldUseSoftRestartInCurrentRuntime()) {
    softReloadCurrentWindow();
    return;
  }
  await invoke('app_restart');
}

function ensureRecentGitCommit(value: unknown): RecentGitCommit | null {
  if (!isRecord(value)) return null;

  const hash = typeof value.hash === 'string' ? value.hash.trim() : '';
  const shortHash = typeof value.shortHash === 'string' ? value.shortHash.trim() : '';
  const subject = typeof value.subject === 'string' ? value.subject.trim() : '';
  const committedAtIso = typeof value.committedAtIso === 'string' ? value.committedAtIso.trim() : '';

  if (!hash || !shortHash || !subject || !committedAtIso) return null;
  return { hash, shortHash, subject, committedAtIso };
}

export async function getRecentGitCommits(limit: number = 3): Promise<RecentGitCommit[]> {
  if (!isTauriRuntime()) return [];
  const normalized = Number.isFinite(limit) ? Math.min(20, Math.max(1, Math.floor(limit))) : 3;
  const raw = await invoke<unknown>('debug_get_recent_git_commits', { limit: normalized }).catch(
    () => null
  );
  if (!Array.isArray(raw)) return [];

  const commits: RecentGitCommit[] = [];
  for (const entry of raw) {
    const commit = ensureRecentGitCommit(entry);
    if (!commit) continue;
    commits.push(commit);
  }
  return commits;
}

