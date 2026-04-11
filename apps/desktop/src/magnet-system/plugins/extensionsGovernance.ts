import { readJson, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

const telemetry = getTelemetryLogger('extensions', 'extensionsGovernance');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type InstalledExtensionPermissionDeniedAuditEvent = {
  type: 'permission-denied';
  at: number;
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
};

export type InstalledExtensionCrashAuditEvent = {
  type: 'crash';
  at: number;
  pluginId: string;
  surface: string;
  message: string;
};

export type InstalledExtensionEnabledAuditEvent = {
  type: 'enabled';
  at: number;
  pluginId: string;
};

export type InstalledExtensionDisabledAuditEvent = {
  type: 'disabled';
  at: number;
  pluginId: string;
  reason?: string;
};

export type InstalledExtensionRuntimeUnresponsiveAuditEvent = {
  type: 'runtime-unresponsive';
  at: number;
  pluginId: string;
  surface: string;
  timeoutMs: number;
};

export type InstalledExtensionQuarantinedAuditEvent = {
  type: 'quarantined';
  at: number;
  pluginId: string;
  surface: string;
  message: string;
  timeoutMs?: number;
};

export type InstalledExtensionQuarantineClearedAuditEvent = {
  type: 'quarantine-cleared';
  at: number;
  pluginId: string;
  reason?: string;
};

export type InstalledExtensionRuntimeRestartAuditEvent = {
  type: 'runtime-restart';
  at: number;
  pluginId: string;
  reason?: string;
};

export type InstalledExtensionCapabilitiesUpdatedAuditEvent = {
  type: 'capabilities-updated';
  at: number;
  pluginId: string;
  deniedCapabilities: string[];
};

export type InstalledExtensionInstalledAuditEvent = {
  type: 'installed';
  at: number;
  pluginId: string;
  version: string;
  publisher: string;
  updated: boolean;
};

export type InstalledExtensionUninstalledAuditEvent = {
  type: 'uninstalled';
  at: number;
  pluginId: string;
};

export type InstalledExtensionErrorsClearedAuditEvent = {
  type: 'errors-cleared';
  at: number;
  pluginId: string;
};

export type InstalledExtensionAuditEvent =
  | InstalledExtensionPermissionDeniedAuditEvent
  | InstalledExtensionCrashAuditEvent
  | InstalledExtensionEnabledAuditEvent
  | InstalledExtensionDisabledAuditEvent
  | InstalledExtensionRuntimeUnresponsiveAuditEvent
  | InstalledExtensionQuarantinedAuditEvent
  | InstalledExtensionQuarantineClearedAuditEvent
  | InstalledExtensionRuntimeRestartAuditEvent
  | InstalledExtensionCapabilitiesUpdatedAuditEvent
  | InstalledExtensionInstalledAuditEvent
  | InstalledExtensionUninstalledAuditEvent
  | InstalledExtensionErrorsClearedAuditEvent;

export type InstalledExtensionAuditEventInput =
  | Omit<InstalledExtensionPermissionDeniedAuditEvent, 'at'>
  | Omit<InstalledExtensionCrashAuditEvent, 'at'>
  | Omit<InstalledExtensionEnabledAuditEvent, 'at'>
  | Omit<InstalledExtensionDisabledAuditEvent, 'at'>
  | Omit<InstalledExtensionRuntimeUnresponsiveAuditEvent, 'at'>
  | Omit<InstalledExtensionQuarantinedAuditEvent, 'at'>
  | Omit<InstalledExtensionQuarantineClearedAuditEvent, 'at'>
  | Omit<InstalledExtensionRuntimeRestartAuditEvent, 'at'>
  | Omit<InstalledExtensionCapabilitiesUpdatedAuditEvent, 'at'>
  | Omit<InstalledExtensionInstalledAuditEvent, 'at'>
  | Omit<InstalledExtensionUninstalledAuditEvent, 'at'>
  | Omit<InstalledExtensionErrorsClearedAuditEvent, 'at'>;

export type InstalledExtensionAuditListener = () => void;

const MAX_EVENTS = 200;
const auditListeners = new Set<InstalledExtensionAuditListener>();
let auditRevision = 0;
let auditSyncDisposer: (() => void) | null = null;

function notifyAuditListeners(): void {
  auditRevision += 1;
  for (const listener of Array.from(auditListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('audit.listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensureAuditSync(): void {
  if (typeof window === 'undefined') return;
  if (auditSyncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.EXTENSIONS_V2_AUDIT_LOG_V1) return;
    notifyAuditListeners();
  };

  window.addEventListener('storage', onStorage);
  auditSyncDisposer = () => {
    window.removeEventListener('storage', onStorage);
    auditSyncDisposer = null;
  };
}

export function getInstalledExtensionAuditRevision(): number {
  return auditRevision;
}

export function subscribeInstalledExtensionAudit(
  listener: InstalledExtensionAuditListener
): () => void {
  auditListeners.add(listener);
  ensureAuditSync();
  return () => {
    auditListeners.delete(listener);
    if (auditListeners.size === 0) {
      auditSyncDisposer?.();
    }
  };
}

export function readInstalledExtensionAuditLog(): InstalledExtensionAuditEvent[] {
  const events = readJson<InstalledExtensionAuditEvent[]>(
    STORAGE_KEYS.EXTENSIONS_V2_AUDIT_LOG_V1,
    []
  );
  if (!Array.isArray(events)) return [];
  return events.slice(-MAX_EVENTS);
}

export function clearInstalledExtensionAuditLog(pluginId?: string): void {
  if (!pluginId) {
    writeJson(STORAGE_KEYS.EXTENSIONS_V2_AUDIT_LOG_V1, []);
    notifyAuditListeners();
    return;
  }

  const next = readInstalledExtensionAuditLog().filter((event) => event.pluginId !== pluginId);
  writeJson(STORAGE_KEYS.EXTENSIONS_V2_AUDIT_LOG_V1, next);
  notifyAuditListeners();
}

export function recordInstalledExtensionPermissionDenied(options: {
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
}): void {
  telemetry.warn('permission.denied', {
    message: `[extv2][permission] denied plugin=${options.pluginId} host=${options.hostLabel} capability=${options.capability} action=${options.action}`,
    fields: {
      pluginId: options.pluginId,
      hostLabel: options.hostLabel,
      capability: options.capability,
      action: options.action,
    },
  });

  try {
    recordInstalledExtensionAuditEvent({
      type: 'permission-denied',
      pluginId: options.pluginId,
      hostLabel: options.hostLabel,
      capability: options.capability,
      action: options.action,
    });
  } catch {
    // ignore
  }
}

export function recordInstalledExtensionAuditEvent(
  event: InstalledExtensionAuditEventInput & { at?: number }
): void {
  const now = typeof event.at === 'number' ? event.at : Date.now();
  const nextEvent = { ...event, at: now } as InstalledExtensionAuditEvent;

  const existing = readInstalledExtensionAuditLog();
  const next = [...existing, nextEvent].slice(-MAX_EVENTS);
  writeJson(STORAGE_KEYS.EXTENSIONS_V2_AUDIT_LOG_V1, next);
  notifyAuditListeners();
}
