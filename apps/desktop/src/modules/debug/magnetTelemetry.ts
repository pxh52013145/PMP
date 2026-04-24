import type { TelemetryCountBucket, TelemetryQueryInput, TelemetryRecord } from '../../contracts/telemetry';
import type { Magnet } from '../../types/pixel';

type MagnetLike = Pick<Magnet, 'id' | 'renderer' | 'name'>;

type MagnetTelemetryRegistration = {
  moduleIds?: readonly string[];
  eventPrefixes?: readonly string[];
  searchTerms?: readonly string[];
};

export type MagnetTelemetryProfileSource = 'registry' | 'heuristic';

export type MagnetTelemetryProfile = {
  magnetId: string;
  moduleIds: string[];
  eventPrefixes: string[];
  searchTerms: string[];
  source: MagnetTelemetryProfileSource;
};

export type TelemetryRecordSummary = {
  firstMatchedTs: number | null;
  lastMatchedTs: number | null;
  eventCounts: TelemetryCountBucket[];
  levelCounts: TelemetryCountBucket[];
  moduleCounts: TelemetryCountBucket[];
};

const DEFAULT_MAGNET_TELEMETRY_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

const MAGNET_TELEMETRY_REGISTRY: Record<string, MagnetTelemetryRegistration> = {
  'navigation-page': {
    moduleIds: ['navigation'],
    eventPrefixes: ['navigation.'],
  },
  'platform-magnet': {
    moduleIds: ['magnet.platform', 'music-platform'],
    eventPrefixes: [
      'platform.',
      'music-platform.pack.',
      'music-platform.instance-auth.',
      'music-platform.facade.',
      'music-platform.sidecar.',
    ],
  },
  'btn-platform-login': {
    moduleIds: ['music-platform'],
    eventPrefixes: ['music-platform.instance-auth.', 'music-platform.pack.'],
  },
  'process-perf-monitor': {
    moduleIds: ['performance', 'memory-governance'],
    eventPrefixes: ['performance.', 'memory-governance.', 'background.gc.'],
  },
  'btn-window-pin': {
    moduleIds: ['windowing'],
    searchTerms: ['window pin', 'pin button', 'pinned'],
  },
  'btn-desktop-lyrics': {
    moduleIds: ['windowing'],
    eventPrefixes: ['desktop-lyrics.'],
  },
  'btn-play-queue': {
    moduleIds: ['audio'],
    eventPrefixes: ['play_queue.'],
  },
  'btn-playlists': {
    moduleIds: ['playlists'],
    eventPrefixes: ['playlists.'],
  },
  'btn-debug': {
    moduleIds: ['debug', 'navigation'],
    eventPrefixes: ['debug_button.'],
  },
  'btn-matrix-change': {
    moduleIds: ['magnets'],
    eventPrefixes: ['layout.', 'space.'],
  },
  'dsp-vst': {
    moduleIds: ['vst'],
    eventPrefixes: ['vst.'],
  },
  'audio-visualizer': {
    moduleIds: ['visualizer'],
    eventPrefixes: ['visualizer.'],
  },
};

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function toLowerCaseList(values: ReadonlyArray<string | null | undefined>): string[] {
  return dedupeStrings(
    values.map((value) => (typeof value === 'string' ? value.toLowerCase() : value))
  );
}

function getProfileRegistration(magnet: MagnetLike): MagnetTelemetryRegistration | null {
  const id = normalizeString(magnet.id);
  const renderer = normalizeString(magnet.renderer);
  return MAGNET_TELEMETRY_REGISTRY[id] ?? MAGNET_TELEMETRY_REGISTRY[renderer] ?? null;
}

function buildFallbackSearchTerms(magnet: MagnetLike): string[] {
  return toLowerCaseList([
    magnet.id,
    magnet.renderer,
    magnet.name,
    magnet.id.replace(/-/g, ' '),
    normalizeString(magnet.renderer).replace(/-/g, ' '),
  ]);
}

function stringifyFields(fields: TelemetryRecord['fields']): string {
  if (!fields) return '';
  try {
    return JSON.stringify(fields);
  } catch {
    return String(fields);
  }
}

function buildRecordSearchText(record: TelemetryRecord): string {
  return [
    record.moduleId,
    record.event,
    record.component,
    record.message,
    stringifyFields(record.fields),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' | ')
    .toLowerCase();
}

function countBy(
  records: readonly TelemetryRecord[],
  selector: (record: TelemetryRecord) => string
): TelemetryCountBucket[] {
  const buckets = new Map<string, number>();

  for (const record of records) {
    const key = normalizeString(selector(record));
    if (!key) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export function getRegisteredMagnetTelemetryIds(): string[] {
  return Object.keys(MAGNET_TELEMETRY_REGISTRY);
}

export function resolveMagnetTelemetryProfile(magnet: MagnetLike): MagnetTelemetryProfile {
  const registration = getProfileRegistration(magnet);
  const source: MagnetTelemetryProfileSource = registration ? 'registry' : 'heuristic';
  const fallbackTerms = buildFallbackSearchTerms(magnet);

  return {
    magnetId: magnet.id,
    moduleIds: dedupeStrings(registration?.moduleIds ? [...registration.moduleIds] : source === 'heuristic' ? ['magnets'] : []),
    eventPrefixes: dedupeStrings(registration?.eventPrefixes ? [...registration.eventPrefixes] : []),
    searchTerms:
      source === 'heuristic'
        ? fallbackTerms
        : toLowerCaseList([...(registration?.searchTerms ?? [])]),
    source,
  };
}

export function buildMagnetTelemetryAiQuery(): TelemetryQueryInput {
  const moduleIds = dedupeStrings(
    Object.values(MAGNET_TELEMETRY_REGISTRY).flatMap((entry) => entry.moduleIds ?? [])
  );
  const eventPrefixes = dedupeStrings(
    Object.values(MAGNET_TELEMETRY_REGISTRY).flatMap((entry) => entry.eventPrefixes ?? [])
  );

  return {
    moduleIds,
    eventPrefixes,
    levels: [...DEFAULT_MAGNET_TELEMETRY_LEVELS],
    limit: 220,
  };
}

export function matchesMagnetTelemetryRecord(
  record: TelemetryRecord,
  profile: MagnetTelemetryProfile
): boolean {
  if (profile.moduleIds.length > 0 && !profile.moduleIds.includes(record.moduleId)) {
    return false;
  }

  if (
    profile.eventPrefixes.length > 0 &&
    !profile.eventPrefixes.some((prefix) => record.event.startsWith(prefix))
  ) {
    return false;
  }

  if (profile.searchTerms.length < 1) {
    return true;
  }

  const haystack = buildRecordSearchText(record);
  return profile.searchTerms.some((term) => haystack.includes(term));
}

export function summarizeTelemetryRecords(records: readonly TelemetryRecord[]): TelemetryRecordSummary {
  let firstMatchedTs: number | null = null;
  let lastMatchedTs: number | null = null;

  for (const record of records) {
    if (firstMatchedTs === null || record.ts < firstMatchedTs) firstMatchedTs = record.ts;
    if (lastMatchedTs === null || record.ts > lastMatchedTs) lastMatchedTs = record.ts;
  }

  return {
    firstMatchedTs,
    lastMatchedTs,
    eventCounts: countBy(records, (record) => record.event),
    levelCounts: countBy(records, (record) => record.level),
    moduleCounts: countBy(records, (record) => record.moduleId),
  };
}
