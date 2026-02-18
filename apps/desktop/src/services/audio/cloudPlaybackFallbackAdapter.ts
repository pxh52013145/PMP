import { EventBus } from '../../kernel';

export interface CloudPlaybackFallbackRequest {
  entryId: string;
  ownerUid: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  requestedAtMs: number;
  reason: 'local-miss';
}

export interface CloudPlaybackFallbackDispatchResult {
  accepted: boolean;
  deduped: boolean;
  queueSize: number;
}

export interface CloudPlaybackFallbackQueuedEvent {
  request: CloudPlaybackFallbackRequest;
  dispatch: CloudPlaybackFallbackDispatchResult;
}

type CloudPlaybackFallbackAdapterEvents = {
  'cloud-playback/fallback-queued': CloudPlaybackFallbackQueuedEvent;
};

export interface CloudPlaybackFallbackAdapter {
  dispatch(request: CloudPlaybackFallbackRequest): Promise<CloudPlaybackFallbackDispatchResult>;
  snapshot(): CloudPlaybackFallbackRequest[];
  clear(): void;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeQuickFingerprint(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return undefined;
  const normalized = raw.replace(/^qf2:/, '');
  if (!/^[0-9a-f]{16,128}$/.test(normalized)) return undefined;
  return `qf2:${normalized}`;
}

function normalizeRequest(
  request: CloudPlaybackFallbackRequest
): CloudPlaybackFallbackRequest | null {
  const entryId = normalizeOptionalString(request.entryId);
  const ownerUid = normalizeOptionalString(request.ownerUid);
  if (!entryId || !ownerUid) return null;

  const requestedAtMs =
    typeof request.requestedAtMs === 'number' && Number.isFinite(request.requestedAtMs)
      ? Math.max(0, Math.floor(request.requestedAtMs))
      : Date.now();

  return {
    entryId,
    ownerUid,
    cloudContentId: normalizeOptionalString(request.cloudContentId),
    trackId: normalizeOptionalString(request.trackId),
    quickFingerprint: normalizeQuickFingerprint(request.quickFingerprint),
    requestedAtMs,
    reason: 'local-miss',
  };
}

function buildDedupKey(request: CloudPlaybackFallbackRequest): string {
  return [
    request.ownerUid,
    request.entryId,
    request.trackId ?? '',
    request.quickFingerprint ?? '',
    request.cloudContentId ?? '',
  ].join('::');
}

class InMemoryCloudPlaybackFallbackAdapter implements CloudPlaybackFallbackAdapter {
  private queue: CloudPlaybackFallbackRequest[] = [];
  private dedupSet: Set<string> = new Set();

  async dispatch(request: CloudPlaybackFallbackRequest): Promise<CloudPlaybackFallbackDispatchResult> {
    const normalized = normalizeRequest(request);
    if (!normalized) {
      return {
        accepted: false,
        deduped: false,
        queueSize: this.queue.length,
      };
    }

    const dedupKey = buildDedupKey(normalized);
    if (this.dedupSet.has(dedupKey)) {
      const result: CloudPlaybackFallbackDispatchResult = {
        accepted: true,
        deduped: true,
        queueSize: this.queue.length,
      };
      fallbackAdapterEventBus.emit('cloud-playback/fallback-queued', {
        request: normalized,
        dispatch: result,
      });
      return result;
    }

    this.queue.push(normalized);
    this.dedupSet.add(dedupKey);

    const result: CloudPlaybackFallbackDispatchResult = {
      accepted: true,
      deduped: false,
      queueSize: this.queue.length,
    };
    fallbackAdapterEventBus.emit('cloud-playback/fallback-queued', {
      request: normalized,
      dispatch: result,
    });
    return result;
  }

  snapshot(): CloudPlaybackFallbackRequest[] {
    return this.queue.map((item) => ({ ...item }));
  }

  clear(): void {
    this.queue = [];
    this.dedupSet.clear();
  }
}

const fallbackAdapterEventBus = new EventBus<CloudPlaybackFallbackAdapterEvents>();
const fallbackAdapter = new InMemoryCloudPlaybackFallbackAdapter();

export function getCloudPlaybackFallbackAdapter(): CloudPlaybackFallbackAdapter {
  return fallbackAdapter;
}

export function clearCloudPlaybackFallbackQueue(): void {
  fallbackAdapter.clear();
}

export function getCloudPlaybackFallbackQueueSnapshot(): CloudPlaybackFallbackRequest[] {
  return fallbackAdapter.snapshot();
}

export function subscribeCloudPlaybackFallbackQueued(
  listener: (payload: CloudPlaybackFallbackQueuedEvent) => void
): () => void {
  return fallbackAdapterEventBus.on('cloud-playback/fallback-queued', (payload) => {
    listener(payload);
  });
}
