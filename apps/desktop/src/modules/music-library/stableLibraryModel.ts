export interface StableFallbackAuditEntry {
  atMs: number;
  request: {
    entryId: string;
    ownerUid: string;
    cloudContentId?: string;
    trackId?: string;
    quickFingerprint?: string;
    requestedAtMs: number;
    reason?: string;
  };
  dispatch: {
    accepted: boolean;
    deduped: boolean;
    queueSize: number;
  };
}

export interface StableFallbackAuditSnapshot {
  stats: {
    totalEvents: number;
    acceptedEvents: number;
    dedupedEvents: number;
    rejectedEvents: number;
    lastQueuedAtMs?: number;
  };
  recent: StableFallbackAuditEntry[];
}

export interface StableLibraryStats {
  totalEntries: number;
  inCloud: number;
  missing: number;
  localReady: number;
}

const STABLE_FALLBACK_AUDIT_MAX = 120;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStableFallbackAuditEntry(value: unknown): StableFallbackAuditEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as {
    atMs?: unknown;
    request?: Record<string, unknown>;
    dispatch?: Record<string, unknown>;
  };
  if (!entry.request || typeof entry.request !== 'object') return null;
  if (!entry.dispatch || typeof entry.dispatch !== 'object') return null;

  const ownerUid = asTrimmedString(entry.request.ownerUid);
  const entryId = asTrimmedString(entry.request.entryId);
  if (!ownerUid || !entryId) return null;

  const atMs =
    typeof entry.atMs === 'number' && Number.isFinite(entry.atMs)
      ? Math.max(0, Math.floor(entry.atMs))
      : Date.now();
  const requestedAtMs =
    typeof entry.request.requestedAtMs === 'number' && Number.isFinite(entry.request.requestedAtMs)
      ? Math.max(0, Math.floor(entry.request.requestedAtMs))
      : atMs;
  const queueSize =
    typeof entry.dispatch.queueSize === 'number' && Number.isFinite(entry.dispatch.queueSize)
      ? Math.max(0, Math.floor(entry.dispatch.queueSize))
      : 0;

  return {
    atMs,
    request: {
      entryId,
      ownerUid,
      cloudContentId: asOptionalString(entry.request.cloudContentId),
      trackId: asOptionalString(entry.request.trackId),
      quickFingerprint: asOptionalString(entry.request.quickFingerprint),
      requestedAtMs,
      reason: asOptionalString(entry.request.reason),
    },
    dispatch: {
      accepted: Boolean(entry.dispatch.accepted),
      deduped: Boolean(entry.dispatch.deduped),
      queueSize,
    },
  };
}

export function collectStableFallbackAuditEntries(
  rawAudit: unknown,
  ownerUid?: string
): StableFallbackAuditEntry[] {
  if (!Array.isArray(rawAudit)) return [];

  const normalizedOwnerUid = asTrimmedString(ownerUid);
  const normalized = rawAudit
    .map((item) => normalizeStableFallbackAuditEntry(item))
    .filter((item): item is StableFallbackAuditEntry => item !== null);

  if (!normalizedOwnerUid) return normalized;
  return normalized.filter((item) => item.request.ownerUid === normalizedOwnerUid);
}

export function buildStableFallbackAuditSnapshot(
  entries: StableFallbackAuditEntry[]
): StableFallbackAuditSnapshot {
  const recent = [...entries]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, STABLE_FALLBACK_AUDIT_MAX)
    .map((item) => ({
      atMs: item.atMs,
      request: { ...item.request },
      dispatch: { ...item.dispatch },
    }));

  let acceptedEvents = 0;
  let dedupedEvents = 0;
  let rejectedEvents = 0;
  let lastQueuedAtMs: number | undefined;

  for (const item of recent) {
    if (item.dispatch.accepted) {
      acceptedEvents += 1;
      if (lastQueuedAtMs === undefined || item.atMs > lastQueuedAtMs) {
        lastQueuedAtMs = item.atMs;
      }
    } else {
      rejectedEvents += 1;
    }
    if (item.dispatch.deduped) {
      dedupedEvents += 1;
    }
  }

  return {
    stats: {
      totalEvents: recent.length,
      acceptedEvents,
      dedupedEvents,
      rejectedEvents,
      lastQueuedAtMs,
    },
    recent,
  };
}

export function parseTagsJsonAsText(tagsJson?: string): string {
  const normalized = asTrimmedString(tagsJson);
  if (!normalized) return '';
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!Array.isArray(parsed)) return normalized;
    const tags = parsed
      .map((item) => asTrimmedString(item))
      .filter((item) => item.length > 0);
    return tags.join(', ');
  } catch {
    return normalized;
  }
}

export function buildTagsJsonFromText(raw: string): string | undefined {
  const tags = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (tags.length === 0) return undefined;
  return JSON.stringify(Array.from(new Set(tags)));
}

export function deriveStableLibraryStats(
  entries: Array<{ inCloud?: boolean; isMissing?: boolean }>
): StableLibraryStats {
  const totalEntries = entries.length;
  const inCloud = entries.filter((entry) => entry.inCloud).length;
  const missing = entries.filter((entry) => entry.isMissing).length;

  return {
    totalEntries,
    inCloud,
    missing,
    localReady: Math.max(0, totalEntries - missing),
  };
}
