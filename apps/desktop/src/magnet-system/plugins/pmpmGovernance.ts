import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type PmpmPermissionDeniedAuditEvent = {
  type: 'permission-denied';
  at: number;
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
};

export type PmpmCrashAuditEvent = {
  type: 'crash';
  at: number;
  pluginId: string;
  surface: string;
  message: string;
};

export type PmpmEnabledAuditEvent = {
  type: 'enabled';
  at: number;
  pluginId: string;
};

export type PmpmDisabledAuditEvent = {
  type: 'disabled';
  at: number;
  pluginId: string;
  reason?: string;
};

export type PmpmRuntimeUnresponsiveAuditEvent = {
  type: 'runtime-unresponsive';
  at: number;
  pluginId: string;
  surface: string;
  timeoutMs: number;
};

export type PmpmRuntimeRestartAuditEvent = {
  type: 'runtime-restart';
  at: number;
  pluginId: string;
  reason?: string;
};

export type PmpmPermissionsUpdatedAuditEvent = {
  type: 'permissions-updated';
  at: number;
  pluginId: string;
  deniedPermissions: string[];
};

export type PmpmAuditEvent =
  | PmpmPermissionDeniedAuditEvent
  | PmpmCrashAuditEvent
  | PmpmEnabledAuditEvent
  | PmpmDisabledAuditEvent
  | PmpmRuntimeUnresponsiveAuditEvent
  | PmpmRuntimeRestartAuditEvent
  | PmpmPermissionsUpdatedAuditEvent;

export type PmpmAuditEventInput =
  | Omit<PmpmPermissionDeniedAuditEvent, 'at'>
  | Omit<PmpmCrashAuditEvent, 'at'>
  | Omit<PmpmEnabledAuditEvent, 'at'>
  | Omit<PmpmDisabledAuditEvent, 'at'>
  | Omit<PmpmRuntimeUnresponsiveAuditEvent, 'at'>
  | Omit<PmpmRuntimeRestartAuditEvent, 'at'>
  | Omit<PmpmPermissionsUpdatedAuditEvent, 'at'>;

export type PmpmAuditListener = () => void;

const MAX_EVENTS = 200;
const auditListeners = new Set<PmpmAuditListener>();
let auditRevision = 0;
let auditSyncDisposer: (() => void) | null = null;

function notifyAuditListeners(): void {
  auditRevision += 1;
  for (const listener of Array.from(auditListeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[pmpm-audit] listener failed', error);
    }
  }
}

function ensureAuditSync(): void {
  if (auditSyncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.PMPM_AUDIT_LOG_V1) return;
    notifyAuditListeners();
  };

  window.addEventListener('storage', onStorage);
  auditSyncDisposer = () => {
    window.removeEventListener('storage', onStorage);
    auditSyncDisposer = null;
  };
}

export function getPmpmAuditRevision(): number {
  return auditRevision;
}

export function subscribePmpmAudit(listener: PmpmAuditListener): () => void {
  auditListeners.add(listener);
  ensureAuditSync();
  return () => {
    auditListeners.delete(listener);
    if (auditListeners.size === 0) {
      auditSyncDisposer?.();
    }
  };
}

export function readPmpmAuditLog(): PmpmAuditEvent[] {
  const events = readJson<PmpmAuditEvent[]>(STORAGE_KEYS.PMPM_AUDIT_LOG_V1, []);
  if (!Array.isArray(events)) return [];
  return events.slice(-MAX_EVENTS);
}

export function clearPmpmAuditLog(pluginId?: string): void {
  if (!pluginId) {
    writeJson(STORAGE_KEYS.PMPM_AUDIT_LOG_V1, []);
    notifyAuditListeners();
    return;
  }

  const next = readPmpmAuditLog().filter((event) => event.pluginId !== pluginId);
  writeJson(STORAGE_KEYS.PMPM_AUDIT_LOG_V1, next);
  notifyAuditListeners();
}

export function recordPmpmAuditEvent(event: PmpmAuditEventInput & { at?: number }): void {
  const now = typeof event.at === 'number' ? event.at : Date.now();
  const nextEvent = { ...event, at: now } as PmpmAuditEvent;

  const existing = readPmpmAuditLog();
  const next = [...existing, nextEvent].slice(-MAX_EVENTS);
  writeJson(STORAGE_KEYS.PMPM_AUDIT_LOG_V1, next);
  notifyAuditListeners();
}
