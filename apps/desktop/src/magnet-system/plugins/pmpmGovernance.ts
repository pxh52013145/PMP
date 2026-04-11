import { readJson, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

const telemetry = getTelemetryLogger('pmpm', 'pmpmGovernance');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

export type PmpmQuarantinedAuditEvent = {
  type: 'quarantined';
  at: number;
  pluginId: string;
  surface: string;
  message: string;
  timeoutMs?: number;
};

export type PmpmQuarantineClearedAuditEvent = {
  type: 'quarantine-cleared';
  at: number;
  pluginId: string;
  reason?: string;
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

export type PmpmAudioInputAdapterSelectedAuditEvent = {
  type: 'audio-input-adapter-selected';
  at: number;
  pluginId: string;
  hostLabel: string;
  sessionId: string;
  sourcePath: string;
  adapterKind: 'builtin' | 'provider';
  adapterId: string;
  selectedInputId: string;
  providerSessionId?: string;
  fallbackFromProviderId?: string;
};

export type PmpmAudioInputAdapterFallbackAuditEvent = {
  type: 'audio-input-adapter-fallback';
  at: number;
  pluginId: string;
  hostLabel: string;
  sourcePath: string;
  fromProviderId: string;
  toAdapterKind: 'builtin' | 'provider';
  toAdapterId: string;
  selectedInputId?: string;
  reason: string;
};

export type PmpmAudioInputAdapterSessionClosedAuditEvent = {
  type: 'audio-input-adapter-session-closed';
  at: number;
  pluginId: string;
  hostLabel: string;
  sessionId: string;
  adapterKind: 'builtin' | 'provider';
  adapterId: string;
  providerSessionId?: string;
  reason?: string;
};

export type PmpmAudioInputAdapterProviderQuarantinedAuditEvent = {
  type: 'audio-input-adapter-provider-quarantined';
  at: number;
  pluginId: string;
  hostLabel: string;
  providerId: string;
  reason: string;
  consecutiveFailures: number;
  quarantineUntilMs: number;
};

export type PmpmAudioInputAdapterProviderQuarantineClearedAuditEvent = {
  type: 'audio-input-adapter-provider-quarantine-cleared';
  at: number;
  pluginId: string;
  hostLabel: string;
  providerId?: string;
  reason?: string;
};

export type PmpmAuditEvent =
  | PmpmPermissionDeniedAuditEvent
  | PmpmCrashAuditEvent
  | PmpmEnabledAuditEvent
  | PmpmDisabledAuditEvent
  | PmpmRuntimeUnresponsiveAuditEvent
  | PmpmQuarantinedAuditEvent
  | PmpmQuarantineClearedAuditEvent
  | PmpmRuntimeRestartAuditEvent
  | PmpmPermissionsUpdatedAuditEvent
  | PmpmAudioInputAdapterSelectedAuditEvent
  | PmpmAudioInputAdapterFallbackAuditEvent
  | PmpmAudioInputAdapterSessionClosedAuditEvent
  | PmpmAudioInputAdapterProviderQuarantinedAuditEvent
  | PmpmAudioInputAdapterProviderQuarantineClearedAuditEvent;

export type PmpmAuditEventInput =
  | Omit<PmpmPermissionDeniedAuditEvent, 'at'>
  | Omit<PmpmCrashAuditEvent, 'at'>
  | Omit<PmpmEnabledAuditEvent, 'at'>
  | Omit<PmpmDisabledAuditEvent, 'at'>
  | Omit<PmpmRuntimeUnresponsiveAuditEvent, 'at'>
  | Omit<PmpmQuarantinedAuditEvent, 'at'>
  | Omit<PmpmQuarantineClearedAuditEvent, 'at'>
  | Omit<PmpmRuntimeRestartAuditEvent, 'at'>
  | Omit<PmpmPermissionsUpdatedAuditEvent, 'at'>
  | Omit<PmpmAudioInputAdapterSelectedAuditEvent, 'at'>
  | Omit<PmpmAudioInputAdapterFallbackAuditEvent, 'at'>
  | Omit<PmpmAudioInputAdapterSessionClosedAuditEvent, 'at'>
  | Omit<PmpmAudioInputAdapterProviderQuarantinedAuditEvent, 'at'>
  | Omit<PmpmAudioInputAdapterProviderQuarantineClearedAuditEvent, 'at'>;

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
      telemetry.warn('audit.listener.failed', {
        message: readErrorMessage(error),
      });
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

export function recordPmpmPermissionDenied(options: {
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
}): void {
  telemetry.warn('permission.denied', {
    message: `[pmpm][permission] denied plugin=${options.pluginId} host=${options.hostLabel} capability=${options.capability} action=${options.action}`,
    fields: {
      pluginId: options.pluginId,
      hostLabel: options.hostLabel,
      capability: options.capability,
      action: options.action,
    },
  });
  try {
    recordPmpmAuditEvent({
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

export function recordPmpmAuditEvent(event: PmpmAuditEventInput & { at?: number }): void {
  const now = typeof event.at === 'number' ? event.at : Date.now();
  const nextEvent = { ...event, at: now } as PmpmAuditEvent;

  const existing = readPmpmAuditLog();
  const next = [...existing, nextEvent].slice(-MAX_EVENTS);
  writeJson(STORAGE_KEYS.PMPM_AUDIT_LOG_V1, next);
  notifyAuditListeners();
}
