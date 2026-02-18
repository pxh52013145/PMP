import { createServiceToken } from '../../kernel';
import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import type {
  CloudPlaybackFallbackDispatchResult,
  CloudPlaybackFallbackRequest,
} from './cloudPlaybackFallbackAdapter';

export const CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES = 120;

export type CloudPlaybackQueueAuditEntry = {
  atMs: number;
  request: CloudPlaybackFallbackRequest;
  dispatch: CloudPlaybackFallbackDispatchResult;
};

export type CloudPlaybackQueueAuditStats = {
  totalEvents: number;
  acceptedEvents: number;
  dedupedEvents: number;
  rejectedEvents: number;
  lastQueuedAtMs?: number;
};

export type CloudPlaybackQueueAuditSnapshot = {
  stats: CloudPlaybackQueueAuditStats;
  recent: CloudPlaybackQueueAuditEntry[];
};

export interface CloudPlaybackQueueService {
  getSnapshot(): CloudPlaybackQueueAuditSnapshot;
  listRecent(limit?: number): CloudPlaybackQueueAuditEntry[];
  clearAudit(): void;
  recordQueued(entry: CloudPlaybackQueueAuditEntry): CloudPlaybackQueueAuditSnapshot;
}

export const CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN = createServiceToken<CloudPlaybackQueueService>(
  'service.cloud-playback-queue'
);

function cloneEntry(entry: CloudPlaybackQueueAuditEntry): CloudPlaybackQueueAuditEntry {
  return {
    atMs: entry.atMs,
    request: { ...entry.request },
    dispatch: { ...entry.dispatch },
  };
}

function normalizeAtMs(atMs: unknown): number {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return Date.now();
  return Math.max(0, Math.floor(atMs));
}

function normalizeEntry(entry: CloudPlaybackQueueAuditEntry): CloudPlaybackQueueAuditEntry {
  return {
    atMs: normalizeAtMs(entry.atMs),
    request: { ...entry.request },
    dispatch: {
      accepted: Boolean(entry.dispatch.accepted),
      deduped: Boolean(entry.dispatch.deduped),
      queueSize:
        typeof entry.dispatch.queueSize === 'number' && Number.isFinite(entry.dispatch.queueSize)
          ? Math.max(0, Math.floor(entry.dispatch.queueSize))
          : 0,
    },
  };
}

function computeStats(recent: CloudPlaybackQueueAuditEntry[]): CloudPlaybackQueueAuditStats {
  const stats: CloudPlaybackQueueAuditStats = {
    totalEvents: recent.length,
    acceptedEvents: 0,
    dedupedEvents: 0,
    rejectedEvents: 0,
    lastQueuedAtMs: undefined,
  };

  for (const item of recent) {
    if (item.dispatch.accepted) {
      stats.acceptedEvents += 1;
      stats.lastQueuedAtMs = item.atMs;
    } else {
      stats.rejectedEvents += 1;
    }
    if (item.dispatch.deduped) {
      stats.dedupedEvents += 1;
    }
  }

  return stats;
}

export class DefaultCloudPlaybackQueueService implements CloudPlaybackQueueService {
  private recent: CloudPlaybackQueueAuditEntry[] = [];

  constructor() {
    this.recent = this.readAuditFromStorage();
  }

  getSnapshot(): CloudPlaybackQueueAuditSnapshot {
    const recent = this.listRecent();
    return {
      stats: computeStats(recent),
      recent,
    };
  }

  listRecent(limit?: number): CloudPlaybackQueueAuditEntry[] {
    const max =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(0, Math.floor(limit))
        : this.recent.length;
    if (max <= 0) return [];
    const start = Math.max(0, this.recent.length - max);
    return this.recent.slice(start).map(cloneEntry);
  }

  clearAudit(): void {
    this.recent = [];
    this.persist();
  }

  recordQueued(entry: CloudPlaybackQueueAuditEntry): CloudPlaybackQueueAuditSnapshot {
    this.recent = [...this.recent, normalizeEntry(entry)].slice(-CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES);
    this.persist();
    return this.getSnapshot();
  }

  private readAuditFromStorage(): CloudPlaybackQueueAuditEntry[] {
    try {
      const raw = readJson<CloudPlaybackQueueAuditEntry[]>(
        STORAGE_KEYS.MUSIC_LIBRARY_CLOUD_FALLBACK_AUDIT_V1,
        []
      );
      if (!Array.isArray(raw)) return [];
      const normalized = raw.map((item) => normalizeEntry(item));
      return normalized.slice(-CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      writeJson(STORAGE_KEYS.MUSIC_LIBRARY_CLOUD_FALLBACK_AUDIT_V1, this.recent, {
        mode: 'idle',
        debounceMs: 300,
      });
    } catch (error) {
      console.warn('[cloud-playback-queue] failed to persist audit entries', error);
    }
  }
}

