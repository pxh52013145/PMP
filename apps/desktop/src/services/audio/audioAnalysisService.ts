import { createServiceToken } from '../../kernel';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import type {
  AudioAnalysisPriority,
  AudioAnalysisRequestOptions,
  AudioAnalysisTrackIdentity,
  AudioPeakRmsAnalysis,
  AudioPeakRmsSegment,
} from '../../contracts/audioAnalysis';
import {
  getTrackPathForIdentity,
  normalizeTrackIdentityForCompare,
  normalizeTrackPathForCompare,
} from './trackIdentity';
import type { Track } from './types';

export const AUDIO_ANALYSIS_SERVICE_TOKEN = createServiceToken<AudioAnalysisService>(
  'service.audio-analysis'
);

export const AUDIO_ANALYSIS_VERSION = 1;
export const AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT = 1440;

const DATABASE_NAME = 'PixelMatrixAudioAnalysis';
const DATABASE_VERSION = 1;
const STORE_NAME = 'peak-rms-v1';
const MAX_CACHE_ENTRIES = 10_000;
const MAX_QUEUE_LENGTH = 24;
const ANALYSIS_MISS_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ANALYSIS_MISS_RECORDS = 256;

export interface AudioAnalysisCacheRecord {
  key: string;
  trackId: string;
  sourcePath: string;
  normalizedPath: string;
  fileSize: number | null;
  mtimeMs: number | null;
  duration: number | null;
  segmentCount: number;
  version: number;
  createdAt: number;
  lastAccessedAt: number;
  analysis: AudioPeakRmsAnalysis;
}

interface NativeAudioPeakRmsAnalysisPayload {
  version: number;
  segmentCount: number;
  duration: number;
  sampleRate: number;
  channels: number;
  frameCount: number;
  decodedFrames: number;
  analyzedSamples: number;
  elapsedMs: number;
  segments: AudioPeakRmsSegment[];
}

export interface AudioAnalysisService {
  getCachedPeakRms(track: Track, options?: AudioAnalysisRequestOptions): Promise<AudioPeakRmsAnalysis | null>;
  requestPeakRms(track: Track, options?: AudioAnalysisRequestOptions): Promise<AudioPeakRmsAnalysis | null>;
  destroy(): void;
}

interface QueueItem {
  key: string;
  identity: AudioAnalysisTrackIdentity;
  priority: AudioAnalysisPriority;
  reason: string;
  requestedAt: number;
  resolve: (analysis: AudioPeakRmsAnalysis | null) => void;
}

export interface AudioAnalysisFailureInfo {
  message: string;
  code: string | null;
  expectedMiss: boolean;
  reason: string;
}

interface AudioAnalysisMissRecord {
  reason: string;
  untilMs: number;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        store.createIndex('trackId', 'trackId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function decodeFileUrlPath(path: string): string {
  if (!/^file:\/\//i.test(path)) return path;
  let normalized = path.replace(/^file:\/\/(localhost)?/i, '');
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // keep raw value when URI decode fails
  }
  if (/^\/[a-zA-Z]:[\\/]/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function isLocalAbsolutePath(path: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith('\\\\') ||
    path.startsWith('//') ||
    path.startsWith('/')
  );
}

function resolveLocalTrackPath(track: Track | null | undefined): string | null {
  const raw = getTrackPathForIdentity(track);
  if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('blob:') || raw.startsWith('data:')) {
    return null;
  }
  const path = decodeFileUrlPath(raw).trim();
  return path && isLocalAbsolutePath(path) ? path : null;
}

function sanitizeSegmentCount(value: number | undefined): number {
  const next = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT;
  return Math.max(64, Math.min(4096, next));
}

function readFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractFailureCode(message: string): string | null {
  return message.match(/\bAUDIO_ANALYSIS_[A-Z0-9_]+\b/)?.[0] ?? null;
}

export function classifyAudioAnalysisFailure(error: unknown): AudioAnalysisFailureInfo {
  const message = readFailureMessage(error);
  const lower = message.toLowerCase();
  const code = extractFailureCode(message);

  if (code === 'AUDIO_ANALYSIS_NO_SAMPLES') {
    return { message, code, expectedMiss: true, reason: 'no-samples' };
  }

  if (code === 'AUDIO_ANALYSIS_PROBE_FAILED') {
    return { message, code, expectedMiss: true, reason: 'probe-failed' };
  }

  if (
    lower.includes('end of stream') ||
    lower.includes('unexpected eof') ||
    lower.includes('unexpected end of file') ||
    lower.includes('failed to probe audio file for analysis')
  ) {
    return { message, code, expectedMiss: true, reason: 'probe-unavailable' };
  }

  return { message, code, expectedMiss: false, reason: 'unexpected' };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolveAudioAnalysisTrackIdentity(
  track: Track,
  segmentCount = AUDIO_ANALYSIS_DEFAULT_SEGMENT_COUNT
): AudioAnalysisTrackIdentity | null {
  const sourcePath = resolveLocalTrackPath(track);
  if (!sourcePath) return null;

  const normalizedPath = normalizeTrackPathForCompare(sourcePath);
  if (!normalizedPath) return null;

  const mtimeMs = numberOrNull(track.mtimeMs);
  const fileSize = numberOrNull(track.fileSize);
  const duration = numberOrNull(track.duration);
  const safeSegmentCount = sanitizeSegmentCount(segmentCount);
  const trackIdentity = normalizeTrackIdentityForCompare(track) || `path:${normalizedPath}`;
  const contentIdentity = track.quickFingerprint?.trim() || normalizedPath;
  const key = [
    AUDIO_ANALYSIS_VERSION,
    safeSegmentCount,
    contentIdentity,
    mtimeMs ?? 'mtime:none',
    fileSize ?? 'size:none',
    duration ? Math.round(duration * 1000) : 'duration:none',
  ].join('|');

  return {
    key,
    trackId: track.id || trackIdentity,
    sourcePath,
    normalizedPath,
    fileSize,
    mtimeMs,
    duration,
    segmentCount: safeSegmentCount,
    version: AUDIO_ANALYSIS_VERSION,
  };
}

function sanitizeU16(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(65535, Math.round(value)))
    : fallback;
}

function normalizeNativeAnalysis(payload: NativeAudioPeakRmsAnalysisPayload): AudioPeakRmsAnalysis {
  const segmentCount = sanitizeSegmentCount(payload.segmentCount);
  const segments = Array.isArray(payload.segments)
    ? payload.segments.slice(0, segmentCount).map((segment) => ({
        min: sanitizeU16(segment.min, 32768),
        max: sanitizeU16(segment.max, 32768),
        peak: sanitizeU16(segment.peak, 0),
        rms: sanitizeU16(segment.rms, 0),
      }))
    : [];
  while (segments.length < segmentCount) {
    segments.push({ min: 32768, max: 32768, peak: 0, rms: 0 });
  }

  return {
    version: AUDIO_ANALYSIS_VERSION,
    segmentCount,
    duration: Math.max(0, payload.duration || 0),
    sampleRate: Math.max(0, Math.round(payload.sampleRate || 0)),
    channels: Math.max(0, Math.round(payload.channels || 0)),
    frameCount: Math.max(0, Math.round(payload.frameCount || 0)),
    decodedFrames: Math.max(0, Math.round(payload.decodedFrames || 0)),
    analyzedSamples: Math.max(0, Math.round(payload.analyzedSamples || 0)),
    elapsedMs: Math.max(0, Math.round(payload.elapsedMs || 0)),
    segments,
  };
}

export class DefaultAudioAnalysisService implements AudioAnalysisService {
  private readonly telemetry = getTelemetryLogger('audio', 'AudioAnalysisService');
  private readonly inflight = new Map<string, Promise<AudioPeakRmsAnalysis | null>>();
  private readonly queued = new Map<string, QueueItem>();
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly analysisMisses = new Map<string, AudioAnalysisMissRecord>();
  private disposed = false;
  private running = false;

  async getCachedPeakRms(
    track: Track,
    options: AudioAnalysisRequestOptions = {}
  ): Promise<AudioPeakRmsAnalysis | null> {
    const identity = resolveAudioAnalysisTrackIdentity(track, options.segmentCount);
    if (!identity) return null;
    const record = await this.readRecord(identity.key);
    return record?.analysis ?? null;
  }

  async requestPeakRms(
    track: Track,
    options: AudioAnalysisRequestOptions = {}
  ): Promise<AudioPeakRmsAnalysis | null> {
    const identity = resolveAudioAnalysisTrackIdentity(track, options.segmentCount);
    if (!identity || !isTauriRuntime()) return null;
    const cached = await this.readRecord(identity.key);
    if (cached) return cached.analysis;
    if (this.isAnalysisMissCoolingDown(identity.key)) return null;
    const priority = options.priority ?? 'background';
    return this.enqueue({
      key: identity.key,
      identity,
      priority,
      reason: options.reason ?? 'explicit',
      requestedAt: Date.now(),
    });
  }

  destroy(): void {
    this.disposed = true;
    for (const item of this.queued.values()) {
      item.resolve(null);
    }
    this.queued.clear();
    this.inflight.clear();
    this.analysisMisses.clear();
    void this.dbPromise?.then((db) => db.close()).catch(() => undefined);
    this.dbPromise = null;
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  private async readRecord(key: string): Promise<AudioAnalysisCacheRecord | null> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const record = await requestToPromise<AudioAnalysisCacheRecord | undefined>(
        transaction.objectStore(STORE_NAME).get(key)
      );
      if (!record || record.version !== AUDIO_ANALYSIS_VERSION) return null;
      void this.touchRecord(record);
      return record;
    } catch (error) {
      this.telemetry.warn('audio.analysis.cache.read.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async touchRecord(record: AudioAnalysisCacheRecord): Promise<void> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        ...record,
        lastAccessedAt: Date.now(),
      } satisfies AudioAnalysisCacheRecord);
      await transactionToPromise(transaction);
    } catch {
      // best-effort LRU metadata only
    }
  }

  private async writeRecord(record: AudioAnalysisCacheRecord): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      await transactionToPromise(transaction);
      void this.pruneCache();
      return true;
    } catch (error) {
      this.telemetry.warn('audio.analysis.cache.write.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async pruneCache(): Promise<void> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const count = await requestToPromise(store.count());
      if (count <= MAX_CACHE_ENTRIES) return;
      const excess = count - MAX_CACHE_ENTRIES;
      const index = store.index('lastAccessedAt');
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || removed >= excess) {
            resolve();
            return;
          }
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
        request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
      });
      await transactionToPromise(transaction);
    } catch (error) {
      this.telemetry.warn('audio.analysis.cache.prune.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enqueue(item: Omit<QueueItem, 'resolve'>): Promise<AudioPeakRmsAnalysis | null> {
    if (this.disposed) return Promise.resolve(null);
    const existingQueued = this.queued.get(item.key);
    if (existingQueued) {
      if (priorityRank(item.priority) > priorityRank(existingQueued.priority)) {
        this.queued.set(item.key, {
          ...existingQueued,
          priority: item.priority,
          reason: item.reason,
        });
      }
      return this.inflight.get(item.key) ?? Promise.resolve(null);
    }

    const running = this.inflight.get(item.key);
    if (running) return running;

    let resolveItem: (analysis: AudioPeakRmsAnalysis | null) => void = () => undefined;
    const promise = new Promise<AudioPeakRmsAnalysis | null>((resolve) => {
      resolveItem = resolve;
    });
    this.inflight.set(item.key, promise);

    this.queued.set(item.key, { ...item, resolve: resolveItem });
    while (this.queued.size > MAX_QUEUE_LENGTH) {
      const background = Array.from(this.queued.values())
        .filter((entry) => entry.priority === 'background')
        .sort((left, right) => left.requestedAt - right.requestedAt)[0];
      const drop = background ?? this.queued.values().next().value;
      if (!drop) break;
      this.queued.delete(drop.key);
      this.inflight.delete(drop.key);
      drop.resolve(null);
    }

    this.pumpQueue();
    return promise;
  }

  private pumpQueue(): void {
    if (this.running || this.disposed) return;
    const next = this.pickNextQueueItem();
    if (!next) return;
    this.running = true;
    this.queued.delete(next.key);

    void this.runAnalysis(next)
      .catch((error) => {
        const failure = classifyAudioAnalysisFailure(error);
        if (failure.expectedMiss) {
          this.rememberAnalysisMiss(next.key, failure.reason);
          this.telemetry.debug('audio.analysis.request.missed', {
            message: failure.message,
            fields: {
              reason: next.reason,
              priority: next.priority,
              failureReason: failure.reason,
              failureCode: failure.code,
              cooldownMs: ANALYSIS_MISS_COOLDOWN_MS,
            },
          });
          return null;
        }

        this.telemetry.warn('audio.analysis.request.failed', {
          message: failure.message,
          fields: {
            reason: next.reason,
            priority: next.priority,
            failureCode: failure.code,
          },
        });
        return null;
      })
      .then((analysis) => {
        next.resolve(analysis);
      })
      .finally(() => {
        this.inflight.delete(next.key);
        this.running = false;
        this.pumpQueue();
      });
  }

  private pickNextQueueItem(): QueueItem | null {
    return Array.from(this.queued.values()).sort((left, right) => {
      const rankDelta = priorityRank(right.priority) - priorityRank(left.priority);
      if (rankDelta !== 0) return rankDelta;
      return left.requestedAt - right.requestedAt;
    })[0] ?? null;
  }

  private async runAnalysis(item: QueueItem): Promise<AudioPeakRmsAnalysis | null> {
    const cached = await this.readRecord(item.key);
    if (cached) return cached.analysis;

    const payload = await invokeWithTelemetry<NativeAudioPeakRmsAnalysisPayload>(
      'native_audio_analyze_peak_rms',
      {
        path: item.identity.sourcePath,
        segmentCount: item.identity.segmentCount,
      },
      {
        moduleId: 'audio',
        component: 'AudioAnalysisService',
        event: 'audio.analysis.peak-rms.invoke',
        slowThresholdMs: 500,
        failureLevel: 'debug',
      }
    );
    const analysis = normalizeNativeAnalysis(payload);
    this.analysisMisses.delete(item.key);
    const now = Date.now();
    const record: AudioAnalysisCacheRecord = {
      key: item.key,
      trackId: item.identity.trackId,
      sourcePath: item.identity.sourcePath,
      normalizedPath: item.identity.normalizedPath,
      fileSize: item.identity.fileSize,
      mtimeMs: item.identity.mtimeMs,
      duration: item.identity.duration,
      segmentCount: item.identity.segmentCount,
      version: AUDIO_ANALYSIS_VERSION,
      createdAt: now,
      lastAccessedAt: now,
      analysis,
    };
    const cacheWritten = await this.writeRecord(record);
    this.telemetry.info('audio.analysis.peak-rms.completed', {
      fields: {
        reason: item.reason,
        priority: item.priority,
        cacheWritten,
        segmentCount: analysis.segmentCount,
        durationMs: Math.round(analysis.duration * 1000),
        decodedFrames: analysis.decodedFrames,
        elapsedMs: analysis.elapsedMs,
      },
    });
    return analysis;
  }

  private isAnalysisMissCoolingDown(key: string): boolean {
    const miss = this.analysisMisses.get(key);
    if (!miss) return false;
    if (miss.untilMs <= Date.now()) {
      this.analysisMisses.delete(key);
      return false;
    }
    return true;
  }

  private rememberAnalysisMiss(key: string, reason: string): void {
    this.analysisMisses.set(key, {
      reason,
      untilMs: Date.now() + ANALYSIS_MISS_COOLDOWN_MS,
    });

    while (this.analysisMisses.size > MAX_ANALYSIS_MISS_RECORDS) {
      const first = this.analysisMisses.keys().next().value as string | undefined;
      if (!first) break;
      this.analysisMisses.delete(first);
    }
  }
}

export function audioAnalysisPriorityRank(priority: AudioAnalysisPriority): number {
  switch (priority) {
    case 'current':
      return 3;
    case 'next':
      return 2;
    case 'background':
      return 1;
    default:
      return 0;
  }
}

function priorityRank(priority: AudioAnalysisPriority): number {
  return audioAnalysisPriorityRank(priority);
}
