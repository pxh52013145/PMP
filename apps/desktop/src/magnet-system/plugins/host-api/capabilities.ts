import { HOST_API_VERSION } from '../../../constants/versions';
import { recordPmpmAuditEvent } from '../pmpmGovernance';
import { hasPermission } from './permissions';
import type {
  PluginHostAudioInputAdapterGovernanceOptions,
  PluginHostAudioInputAdapterProviderHealth,
  PluginHostAudioInputAdapterProviderHealthStatus,
  PluginHostAudioInputAdapterProviderInfo,
  PluginHostAudioInputAdapterProviderRegistration,
  PluginHostDesktopPetProviderInfo,
  PluginHostDesktopPetProviderRegistration,
  PluginHostAiAdapterProviderCapability,
  PluginHostAiAdapterProviderHealth,
  PluginHostAiAdapterProviderHealthStatus,
  PluginHostAiAdapterProviderInfo,
  PluginHostAiAdapterProviderInvokeRequest,
  PluginHostAiAdapterProviderRegistration,
  PluginHostCapabilityHandler,
  PluginHostCapabilityInfo,
  PluginHostCapabilityInvokeRequest,
  PluginHostCapabilityRegistration,
  PluginHostCapabilityResult,
  PluginHostRuntimeProviderHealth,
  PluginHostRuntimeProviderHealthStatus,
  PluginHostRuntimeProviderInfo,
  PluginHostRuntimeProviderRegistration,
  PluginHostVoiceTrainingProviderInfo,
  PluginHostVoiceTrainingProviderRegistration,
} from './types';

type PluginHostCapabilityEntry = PluginHostCapabilityRegistration & {
  source: 'builtin' | 'runtime';
};

const entries = new Map<string, PluginHostCapabilityEntry>();
let initialized = false;

const AI_ADAPTER_CAPABILITY_ID = 'foundation.ai-adapter';
const AI_ADAPTER_CAPABILITY_VERSION = '0.4.0';
const AUDIO_INPUT_ADAPTER_CAPABILITY_ID = 'foundation.audio-input-adapter';
const AUDIO_INPUT_ADAPTER_CAPABILITY_VERSION = '0.4.0';
const DESKTOP_PET_RUNTIME_CAPABILITY_ID = 'foundation.desktop-pet-runtime';
const DESKTOP_PET_RUNTIME_CAPABILITY_VERSION = '0.3.0';
const VOICE_TRAINING_RUNTIME_CAPABILITY_ID = 'foundation.voice-training-runtime';
const VOICE_TRAINING_RUNTIME_CAPABILITY_VERSION = '0.3.0';
const AUDIO_INPUT_ADAPTER_PROVIDER_DEFAULT_TIMEOUT_MS = 2000;
const AUDIO_INPUT_ADAPTER_PROVIDER_MAX_TIMEOUT_MS = 10_000;
const AUDIO_INPUT_ADAPTER_MAX_OPEN_SESSIONS_PER_PLUGIN_DEFAULT = 24;
const AUDIO_INPUT_ADAPTER_MAX_OPEN_SESSIONS_PER_PLUGIN_MAX = 256;
const AUDIO_INPUT_ADAPTER_QUARANTINE_THRESHOLD_DEFAULT = 3;
const AUDIO_INPUT_ADAPTER_QUARANTINE_THRESHOLD_MAX = 20;
const AUDIO_INPUT_ADAPTER_QUARANTINE_MS_DEFAULT = 120_000;
const AUDIO_INPUT_ADAPTER_QUARANTINE_MS_MAX = 86_400_000;

const SACD_AUDIO_EXTENSIONS = new Set<string>(['.dsf', '.dff', '.iso']);
const SYMPHONIA_AUDIO_EXTENSIONS = new Set<string>([
  '.mp3',
  '.flac',
  '.wav',
  '.wave',
  '.ogg',
  '.opus',
  '.m4a',
  '.m4b',
  '.mp4',
  '.aac',
  '.aif',
  '.aiff',
  '.alac',
  '.caf',
  '.wma',
]);

type AudioInputAdapterSession = {
  sessionId: string;
  pluginId: string;
  sourcePath: string;
  selectedInputId: string;
  adapterKind: 'builtin' | 'provider';
  adapterId: string;
  providerSessionId?: string;
  openedAtMs: number;
};

const audioInputAdapterSessions = new Map<string, AudioInputAdapterSession>();
let audioInputAdapterSessionCounter = 0;

type AudioInputAdapterProviderEntry = {
  info: PluginHostAudioInputAdapterProviderInfo;
  probe?: PluginHostAudioInputAdapterProviderRegistration['probe'];
  openSession: PluginHostAudioInputAdapterProviderRegistration['openSession'];
  closeSession?: PluginHostAudioInputAdapterProviderRegistration['closeSession'];
  health?: () => Promise<PluginHostAudioInputAdapterProviderHealth> | PluginHostAudioInputAdapterProviderHealth;
};

const audioInputAdapterProviders = new Map<string, AudioInputAdapterProviderEntry>();
let audioInputAdapterDefaultProviderId: string | null = null;

const audioInputAdapterGovernance: {
  thirdPartyEnabled: boolean;
  allowedProviderIds: Set<string> | null;
  timeoutMs: number;
  maxOpenSessionsPerPlugin: number;
  quarantineThreshold: number;
  quarantineMs: number;
} = {
  thirdPartyEnabled: false,
  allowedProviderIds: null,
  timeoutMs: AUDIO_INPUT_ADAPTER_PROVIDER_DEFAULT_TIMEOUT_MS,
  maxOpenSessionsPerPlugin: AUDIO_INPUT_ADAPTER_MAX_OPEN_SESSIONS_PER_PLUGIN_DEFAULT,
  quarantineThreshold: AUDIO_INPUT_ADAPTER_QUARANTINE_THRESHOLD_DEFAULT,
  quarantineMs: AUDIO_INPUT_ADAPTER_QUARANTINE_MS_DEFAULT,
};

type AudioInputAdapterProviderRuntimeState = {
  providerId: string;
  totalProbeCount: number;
  totalOpenSessionCount: number;
  totalCloseSessionCount: number;
  totalFailureCount: number;
  consecutiveFailureCount: number;
  totalSuccessCount: number;
  lastFailureAtMs?: number;
  lastFailureMessage?: string;
  quarantinedUntilMs?: number;
};

const audioInputAdapterProviderRuntimeState = new Map<
  string,
  AudioInputAdapterProviderRuntimeState
>();

const AI_ADAPTER_PROVIDER_CAPABILITIES: ReadonlySet<PluginHostAiAdapterProviderCapability> = new Set<
  PluginHostAiAdapterProviderCapability
>([
  'chat',
  'completion',
  'embedding',
  'image-generation',
  'audio-transcription',
  'audio-synthesis',
  'tool-calling',
  'streaming',
]);

type AiAdapterProviderEntry = {
  info: PluginHostAiAdapterProviderInfo;
  invoke: (
    request: PluginHostAiAdapterProviderInvokeRequest
  ) => Promise<unknown> | unknown;
  health?: () => Promise<PluginHostAiAdapterProviderHealth> | PluginHostAiAdapterProviderHealth;
};

type AiAdapterTrackSummary = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  sourcePath?: string;
};

const aiAdapterProviders = new Map<string, AiAdapterProviderEntry>();
let aiAdapterDefaultProviderId: string | null = null;

type RuntimeProviderEntry = {
  info: PluginHostRuntimeProviderInfo;
  invoke: PluginHostRuntimeProviderRegistration['invoke'];
  health?: PluginHostRuntimeProviderRegistration['health'];
};

const desktopPetRuntimeProviders = new Map<string, RuntimeProviderEntry>();
let desktopPetRuntimeDefaultProviderId: string | null = null;

const voiceTrainingRuntimeProviders = new Map<string, RuntimeProviderEntry>();
let voiceTrainingRuntimeDefaultProviderId: string | null = null;

function resultOk<T>(data: T): PluginHostCapabilityResult<T> {
  return {
    ok: true,
    data,
  };
}

function resultError(
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): PluginHostCapabilityResult {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function toCapabilityInfo(entry: PluginHostCapabilityEntry): PluginHostCapabilityInfo {
  return {
    id: entry.id,
    version: entry.version,
    permission: entry.permission,
    description: entry.description,
    experimental: entry.experimental,
  };
}

function isVisibleToCaller(
  entry: PluginHostCapabilityEntry,
  permissions: ReadonlySet<string>
): boolean {
  if (!entry.permission) return true;
  return hasPermission(permissions, entry.permission);
}

function listVisibleCapabilities(permissions: ReadonlySet<string>): PluginHostCapabilityInfo[] {
  return Array.from(entries.values())
    .filter((entry) => isVisibleToCaller(entry, permissions))
    .map(toCapabilityInfo)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function assertCapabilityId(id: string): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) {
    throw new Error(`Invalid capability id: "${id}"`);
  }
}

function assertVersion(version: string): void {
  if (typeof version !== 'string' || version.trim().length < 1) {
    throw new Error('Capability version is required');
  }
}

function assertAiAdapterProviderId(id: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id)) {
    throw new Error(`Invalid AI adapter provider id: "${id}"`);
  }
}

function assertAudioInputAdapterProviderId(id: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id)) {
    throw new Error(`Invalid audio input adapter provider id: "${id}"`);
  }
}

function toAudioInputAdapterProviderHealthStatus(
  status: unknown
): PluginHostAudioInputAdapterProviderHealthStatus {
  if (status === 'ready' || status === 'degraded' || status === 'offline') {
    return status;
  }
  return 'offline';
}

function toTimeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return Math.max(250, Math.min(AUDIO_INPUT_ADAPTER_PROVIDER_MAX_TIMEOUT_MS, normalized));
}

async function withAdapterTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      globalThis.clearTimeout(timeoutHandle);
    }
  }
}

function toPositiveIntInRange(
  value: unknown,
  fallback: number,
  options: { min: number; max: number }
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return Math.max(options.min, Math.min(options.max, normalized));
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function toAiAdapterTrackSummary(track: unknown): AiAdapterTrackSummary | null {
  const record = asObject(track);
  if (!record) return null;

  const id =
    asNonEmptyString(record.id) ??
    asNonEmptyString(record.filePath) ??
    asNonEmptyString(record.path) ??
    asNonEmptyString(record.originalPath);

  if (!id) return null;

  const summary: AiAdapterTrackSummary = {
    id,
    title: asNonEmptyString(record.title) ?? id,
  };

  const artist = asNonEmptyString(record.artist);
  if (artist) summary.artist = artist;

  const album = asNonEmptyString(record.album);
  if (album) summary.album = album;

  const duration = typeof record.duration === 'number' && Number.isFinite(record.duration)
    ? Math.max(0, record.duration)
    : null;
  if (duration !== null) summary.duration = duration;

  const sourcePath =
    asNonEmptyString(record.filePath) ??
    asNonEmptyString(record.path) ??
    asNonEmptyString(record.originalPath);
  if (sourcePath) summary.sourcePath = sourcePath;

  return summary;
}

function summarizeAiAdapterTracks(tracks: unknown[]): AiAdapterTrackSummary[] {
  if (!Array.isArray(tracks)) return [];
  const out: AiAdapterTrackSummary[] = [];

  for (const track of tracks) {
    const summary = toAiAdapterTrackSummary(track);
    if (summary) {
      out.push(summary);
    }
  }

  return out;
}

function isAiAdapterProviderCapability(
  value: string
): value is PluginHostAiAdapterProviderCapability {
  return AI_ADAPTER_PROVIDER_CAPABILITIES.has(value as PluginHostAiAdapterProviderCapability);
}

function normalizeAiAdapterProviderInfo(
  info: PluginHostAiAdapterProviderInfo
): PluginHostAiAdapterProviderInfo {
  const id = typeof info.id === 'string' ? info.id.trim() : '';
  const name = typeof info.name === 'string' ? info.name.trim() : '';
  const version = typeof info.version === 'string' ? info.version.trim() : '';

  assertAiAdapterProviderId(id);
  assertVersion(version);

  if (!name) {
    throw new Error('AI adapter provider name is required');
  }

  const rawCapabilities = Array.isArray(info.capabilities) ? info.capabilities : [];
  const normalizedCapabilities = Array.from(
    new Set(
      rawCapabilities
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item): item is PluginHostAiAdapterProviderCapability =>
          isAiAdapterProviderCapability(item)
        )
    )
  );

  if (normalizedCapabilities.length < 1) {
    throw new Error(`AI adapter provider "${id}" must declare at least one capability`);
  }

  return {
    id,
    name,
    version,
    vendor: asNonEmptyString(info.vendor) ?? undefined,
    description: asNonEmptyString(info.description) ?? undefined,
    defaultModel: asNonEmptyString(info.defaultModel) ?? undefined,
    capabilities: normalizedCapabilities,
    experimental: info.experimental === true,
  };
}

function nextAiAdapterDefaultProviderId(): string | null {
  const iterator = aiAdapterProviders.keys().next();
  return iterator.done ? null : iterator.value;
}

function resolveAiAdapterProvider(
  requestedProviderId: string | null
): AiAdapterProviderEntry | null {
  if (requestedProviderId) {
    return aiAdapterProviders.get(requestedProviderId) ?? null;
  }

  if (!aiAdapterDefaultProviderId) {
    aiAdapterDefaultProviderId = nextAiAdapterDefaultProviderId();
  }

  if (!aiAdapterDefaultProviderId) return null;
  return aiAdapterProviders.get(aiAdapterDefaultProviderId) ?? null;
}

function listAiAdapterProviderInfos(): PluginHostAiAdapterProviderInfo[] {
  return Array.from(aiAdapterProviders.values())
    .map((entry) => ({
      ...entry.info,
      capabilities: [...entry.info.capabilities],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Unknown runtime error';
}

function normalizeRuntimeProviderCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const capabilities = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(normalized)) continue;
    capabilities.add(normalized);
  }

  return Array.from(capabilities.values());
}

function normalizeRuntimeProviderInfo(
  info: PluginHostRuntimeProviderInfo,
  label: 'desktop-pet' | 'voice-training'
): PluginHostRuntimeProviderInfo {
  const id = typeof info.id === 'string' ? info.id.trim() : '';
  const name = typeof info.name === 'string' ? info.name.trim() : '';
  const version = typeof info.version === 'string' ? info.version.trim() : '';

  assertAiAdapterProviderId(id);
  assertVersion(version);

  if (!name) {
    throw new Error(`${label} runtime provider name is required`);
  }

  const capabilities = normalizeRuntimeProviderCapabilities(info.capabilities);
  if (capabilities.length < 1) {
    throw new Error(`${label} runtime provider "${id}" must declare at least one capability`);
  }

  return {
    id,
    name,
    version,
    vendor: asNonEmptyString(info.vendor) ?? undefined,
    description: asNonEmptyString(info.description) ?? undefined,
    capabilities,
    experimental: info.experimental === true,
  };
}

function listRuntimeProviderInfos(
  registry: Map<string, RuntimeProviderEntry>
): PluginHostRuntimeProviderInfo[] {
  return Array.from(registry.values())
    .map((entry) => ({
      ...entry.info,
      capabilities: [...entry.info.capabilities],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function nextRuntimeDefaultProviderId(registry: Map<string, RuntimeProviderEntry>): string | null {
  const iterator = registry.keys().next();
  return iterator.done ? null : iterator.value;
}

function toRuntimeProviderHealthStatus(status: unknown): PluginHostRuntimeProviderHealthStatus {
  if (status === 'ready' || status === 'degraded' || status === 'offline') {
    return status;
  }
  return 'ready';
}

async function readRuntimeProviderHealth(
  provider: RuntimeProviderEntry
): Promise<PluginHostRuntimeProviderHealth> {
  if (typeof provider.health !== 'function') {
    return { status: 'ready' };
  }

  try {
    const result = await provider.health();
    return {
      status: toRuntimeProviderHealthStatus(result?.status),
      message: asNonEmptyString(result?.message) ?? undefined,
    };
  } catch (error) {
    return {
      status: 'offline',
      message: toErrorMessage(error),
    };
  }
}

function ensureAudioInputAdapterProviderRuntimeState(
  providerId: string
): AudioInputAdapterProviderRuntimeState {
  const existing = audioInputAdapterProviderRuntimeState.get(providerId);
  if (existing) return existing;

  const created: AudioInputAdapterProviderRuntimeState = {
    providerId,
    totalProbeCount: 0,
    totalOpenSessionCount: 0,
    totalCloseSessionCount: 0,
    totalFailureCount: 0,
    consecutiveFailureCount: 0,
    totalSuccessCount: 0,
  };
  audioInputAdapterProviderRuntimeState.set(providerId, created);
  return created;
}

function isAudioInputAdapterProviderQuarantined(providerId: string, now = Date.now()): boolean {
  const runtimeState = audioInputAdapterProviderRuntimeState.get(providerId);
  if (!runtimeState?.quarantinedUntilMs) return false;
  return runtimeState.quarantinedUntilMs > now;
}

function markAudioInputAdapterProviderSuccess(providerId: string): void {
  const runtimeState = ensureAudioInputAdapterProviderRuntimeState(providerId);
  runtimeState.totalSuccessCount += 1;
  runtimeState.consecutiveFailureCount = 0;
  runtimeState.lastFailureMessage = undefined;
  runtimeState.lastFailureAtMs = undefined;
  runtimeState.quarantinedUntilMs = undefined;
}

function markAudioInputAdapterProviderFailure(
  providerId: string,
  message: string,
  context?: { pluginId: string; hostLabel: string }
): void {
  const runtimeState = ensureAudioInputAdapterProviderRuntimeState(providerId);
  runtimeState.totalFailureCount += 1;
  runtimeState.consecutiveFailureCount += 1;
  runtimeState.lastFailureAtMs = Date.now();
  runtimeState.lastFailureMessage = message;

  if (runtimeState.consecutiveFailureCount >= audioInputAdapterGovernance.quarantineThreshold) {
    runtimeState.quarantinedUntilMs = Date.now() + audioInputAdapterGovernance.quarantineMs;
    recordAudioInputAdapterAuditEvent({
      type: 'audio-input-adapter-provider-quarantined',
      pluginId: context?.pluginId ?? 'system',
      hostLabel: context?.hostLabel ?? 'PluginHost',
      providerId,
      reason: message,
      consecutiveFailures: runtimeState.consecutiveFailureCount,
      quarantineUntilMs: runtimeState.quarantinedUntilMs,
    });
  }
}

function clearAudioInputAdapterProviderQuarantine(providerId: string): void {
  const runtimeState = ensureAudioInputAdapterProviderRuntimeState(providerId);
  runtimeState.consecutiveFailureCount = 0;
  runtimeState.quarantinedUntilMs = undefined;
}

function listAudioInputAdapterProviderRuntimeStats(): Array<{
  providerId: string;
  totalProbeCount: number;
  totalOpenSessionCount: number;
  totalCloseSessionCount: number;
  totalFailureCount: number;
  consecutiveFailureCount: number;
  totalSuccessCount: number;
  lastFailureAtMs?: number;
  lastFailureMessage?: string;
  quarantinedUntilMs?: number;
  quarantined: boolean;
}> {
  return Array.from(audioInputAdapterProviderRuntimeState.values())
    .map((runtimeState) => ({
      providerId: runtimeState.providerId,
      totalProbeCount: runtimeState.totalProbeCount,
      totalOpenSessionCount: runtimeState.totalOpenSessionCount,
      totalCloseSessionCount: runtimeState.totalCloseSessionCount,
      totalFailureCount: runtimeState.totalFailureCount,
      consecutiveFailureCount: runtimeState.consecutiveFailureCount,
      totalSuccessCount: runtimeState.totalSuccessCount,
      lastFailureAtMs: runtimeState.lastFailureAtMs,
      lastFailureMessage: runtimeState.lastFailureMessage,
      quarantinedUntilMs: runtimeState.quarantinedUntilMs,
      quarantined: isAudioInputAdapterProviderQuarantined(runtimeState.providerId),
    }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function recordAudioInputAdapterAuditEvent(event: Parameters<typeof recordPmpmAuditEvent>[0]): void {
  try {
    recordPmpmAuditEvent(event);
  } catch {
    // best-effort only
  }
}

function toHealthStatus(status: unknown): PluginHostAiAdapterProviderHealthStatus {
  if (status === 'ready' || status === 'degraded' || status === 'offline') {
    return status;
  }
  return 'ready';
}

async function readProviderHealth(
  provider: AiAdapterProviderEntry
): Promise<PluginHostAiAdapterProviderHealth> {
  if (typeof provider.health !== 'function') {
    return { status: 'ready' };
  }

  try {
    const result = await provider.health();
    return {
      status: toHealthStatus(result?.status),
      message: asNonEmptyString(result?.message) ?? undefined,
    };
  } catch (error) {
    return {
      status: 'offline',
      message: toErrorMessage(error),
    };
  }
}

function normalizeAudioInputAdapterIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(normalized)) continue;
    ids.add(normalized);
  }

  return Array.from(ids.values());
}

function findAudioInputAdapterId(
  inputIds: string[],
  requestedInputId: string | null
): string | null {
  if (!requestedInputId) return null;
  const normalizedRequestedId = requestedInputId.trim().toLowerCase();
  for (const inputId of inputIds) {
    if (inputId.toLowerCase() === normalizedRequestedId) {
      return inputId;
    }
  }
  return null;
}

function normalizeAudioInputSourcePath(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  if (!/^file:\/\//i.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'file:') return trimmed;

    let pathname = decodeURIComponent(url.pathname || '').replace(/\//g, '/');
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || trimmed;
  } catch {
    return trimmed;
  }
}

function resolveAudioInputSourcePath(payload: Record<string, unknown>): string | null {
  const sourcePath =
    asNonEmptyString(payload.path) ??
    asNonEmptyString(payload.sourcePath) ??
    asNonEmptyString(payload.sourceUri) ??
    asNonEmptyString(payload.resourceUri);

  if (!sourcePath) return null;
  const normalized = normalizeAudioInputSourcePath(sourcePath);
  return normalized.length > 0 ? normalized : null;
}

function extractAudioFileExtension(sourcePath: string): string | null {
  const normalized = sourcePath.replace(/\\/g, '/').toLowerCase();
  const fileName = normalized.split('/').pop() ?? normalized;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= fileName.length - 1) return null;
  return fileName.slice(dotIndex);
}

function chooseAudioInputForSourcePath(options: {
  sourcePath: string;
  inputIds: string[];
  preferredInputId: string | null;
}): {
  inputId: string;
  confidence: 'explicit' | 'matched' | 'fallback';
  extension: string | null;
} {
  const preferredMatch = findAudioInputAdapterId(options.inputIds, options.preferredInputId);
  const extension = extractAudioFileExtension(options.sourcePath);

  if (preferredMatch) {
    return {
      inputId: preferredMatch,
      confidence: 'explicit',
      extension,
    };
  }

  if (extension && SACD_AUDIO_EXTENSIONS.has(extension)) {
    const sacdMatch = findAudioInputAdapterId(options.inputIds, 'sacd');
    if (sacdMatch) {
      return {
        inputId: sacdMatch,
        confidence: 'matched',
        extension,
      };
    }
  }

  if (extension && SYMPHONIA_AUDIO_EXTENSIONS.has(extension)) {
    const symphoniaMatch = findAudioInputAdapterId(options.inputIds, 'symphonia');
    if (symphoniaMatch) {
      return {
        inputId: symphoniaMatch,
        confidence: 'matched',
        extension,
      };
    }
  }

  const rodioMatch = findAudioInputAdapterId(options.inputIds, 'rodio');
  if (rodioMatch) {
    return {
      inputId: rodioMatch,
      confidence: 'fallback',
      extension,
    };
  }

  return {
    inputId: options.inputIds[0]!,
    confidence: 'fallback',
    extension,
  };
}

async function listAudioInputAdapterIds(
  request: PluginHostCapabilityInvokeRequest
): Promise<string[] | null> {
  const bridge = request.context.audioInputAdapter;
  if (!bridge) return null;
  const inputIds = await Promise.resolve(bridge.listInputs());
  return normalizeAudioInputAdapterIds(inputIds);
}

function normalizeAudioInputAdapterProviderInfo(
  info: PluginHostAudioInputAdapterProviderInfo
): PluginHostAudioInputAdapterProviderInfo {
  const id = typeof info.id === 'string' ? info.id.trim() : '';
  const name = typeof info.name === 'string' ? info.name.trim() : '';
  const version = typeof info.version === 'string' ? info.version.trim() : '';
  const protocolVersion =
    typeof info.protocolVersion === 'string' ? info.protocolVersion.trim() : '';

  assertAudioInputAdapterProviderId(id);
  assertVersion(version);
  assertVersion(protocolVersion);

  if (!name) {
    throw new Error('Audio input adapter provider name is required');
  }

  return {
    id,
    name,
    version,
    protocolVersion,
    vendor: asNonEmptyString(info.vendor) ?? undefined,
    description: asNonEmptyString(info.description) ?? undefined,
    experimental: info.experimental === true,
  };
}

function nextAudioInputAdapterDefaultProviderId(): string | null {
  const iterator = audioInputAdapterProviders.keys().next();
  return iterator.done ? null : iterator.value;
}

function getAudioInputAdapterProviderUnavailableReason(providerId: string): string | null {
  if (!audioInputAdapterGovernance.thirdPartyEnabled) {
    return 'third-party-disabled';
  }

  const allowed = audioInputAdapterGovernance.allowedProviderIds;
  if (allowed && !allowed.has(providerId)) {
    return 'provider-disabled-by-governance';
  }

  if (isAudioInputAdapterProviderQuarantined(providerId)) {
    return 'provider-quarantined';
  }

  return null;
}

function listAvailableAudioInputAdapterProviders(): Array<{
  providerId: string;
  entry: AudioInputAdapterProviderEntry;
}> {
  const providers: Array<{
    providerId: string;
    entry: AudioInputAdapterProviderEntry;
  }> = [];

  for (const [providerId, entry] of audioInputAdapterProviders.entries()) {
    if (getAudioInputAdapterProviderUnavailableReason(providerId)) continue;
    providers.push({ providerId, entry });
  }

  providers.sort((left, right) => left.providerId.localeCompare(right.providerId));
  return providers;
}

function resolveAudioInputAdapterProvider(
  requestedProviderId: string | null
): { providerId: string; entry: AudioInputAdapterProviderEntry } | null {
  const available = listAvailableAudioInputAdapterProviders();
  if (available.length < 1) return null;

  if (requestedProviderId) {
    const normalizedRequestedId = requestedProviderId.trim().toLowerCase();
    return (
      available.find((candidate) => candidate.providerId.toLowerCase() === normalizedRequestedId) ??
      null
    );
  }

  if (
    audioInputAdapterDefaultProviderId &&
    !getAudioInputAdapterProviderUnavailableReason(audioInputAdapterDefaultProviderId)
  ) {
    const defaultMatch = available.find(
      (candidate) => candidate.providerId === audioInputAdapterDefaultProviderId
    );
    if (defaultMatch) return defaultMatch;
  }

  audioInputAdapterDefaultProviderId = available[0]?.providerId ?? null;
  if (!audioInputAdapterDefaultProviderId) return null;

  return (
    available.find((candidate) => candidate.providerId === audioInputAdapterDefaultProviderId) ?? null
  );
}

function normalizeAudioInputAdapterProviderScore(score: unknown): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0.5;
  return Math.max(0, Math.min(1, score));
}

function normalizeAudioInputAdapterProviderOpenResult(
  value: unknown
): { providerSessionId?: string; selectedInputId?: string; metadata?: unknown } {
  const payload = asObject(value);
  if (!payload) return {};

  const providerSessionId = asNonEmptyString(payload.providerSessionId) ?? undefined;
  const selectedInputId = asNonEmptyString(payload.selectedInputId) ?? undefined;
  const metadata = Object.prototype.hasOwnProperty.call(payload, 'metadata')
    ? payload.metadata
    : undefined;

  return {
    providerSessionId,
    selectedInputId,
    metadata,
  };
}

async function readAudioInputAdapterProviderHealth(
  provider: AudioInputAdapterProviderEntry
): Promise<PluginHostAudioInputAdapterProviderHealth> {
  if (typeof provider.health !== 'function') {
    return { status: 'ready' };
  }

  try {
    const result = await provider.health();
    return {
      status: toAudioInputAdapterProviderHealthStatus(result?.status),
      message: asNonEmptyString(result?.message) ?? undefined,
    };
  } catch (error) {
    return {
      status: 'offline',
      message: toErrorMessage(error),
    };
  }
}

function nextAudioInputAdapterSessionId(): string {
  audioInputAdapterSessionCounter += 1;
  return `audio-input-session-${Date.now()}-${audioInputAdapterSessionCounter}`;
}

function countPluginAudioInputAdapterSessions(pluginId: string): number {
  let count = 0;
  for (const session of audioInputAdapterSessions.values()) {
    if (session.pluginId === pluginId) count += 1;
  }
  return count;
}

function createAudioInputAdapterHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe': {
        const inputIds = await listAudioInputAdapterIds(request);
        const bridgeAvailable = Array.isArray(inputIds);
        const inputCount = inputIds?.length ?? 0;
        const providerCount = audioInputAdapterProviders.size;
        const availableProviderCount = listAvailableAudioInputAdapterProviders().length;
        const ready =
          (bridgeAvailable && inputCount > 0) ||
          (audioInputAdapterGovernance.thirdPartyEnabled && availableProviderCount > 0);

        return resultOk({
          capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
          domain: 'audio-input-adapter',
          stage: 'phase-d',
          implementation: 'hybrid-bridge',
          ready,
          bridgeAvailable,
          thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
          inputCount,
          providerCount,
          availableProviderCount,
          defaultProviderId: audioInputAdapterDefaultProviderId,
          governance: {
            timeoutMs: audioInputAdapterGovernance.timeoutMs,
            allowlistEnabled: audioInputAdapterGovernance.allowedProviderIds !== null,
            maxOpenSessionsPerPlugin: audioInputAdapterGovernance.maxOpenSessionsPerPlugin,
            quarantineThreshold: audioInputAdapterGovernance.quarantineThreshold,
            quarantineMs: audioInputAdapterGovernance.quarantineMs,
          },
          pluginOpenSessionCount: countPluginAudioInputAdapterSessions(request.context.pluginId),
          methods: [
            'describe',
            'health',
            'listInputs',
            'listProviders',
            'stats',
            'clearProviderQuarantine',
            'probe',
            'openSession',
            'closeSession',
          ],
        });
      }
      case 'health': {
        const payload = asObject(request.payload);
        const providerId = asNonEmptyString(payload?.providerId);
        const inputIds = await listAudioInputAdapterIds(request);
        const availableProviderCount = listAvailableAudioInputAdapterProviders().length;

        if (providerId) {
          const entry = audioInputAdapterProviders.get(providerId);
          if (!entry) {
            return resultError('NOT_FOUND', `Unknown audio input adapter provider: ${providerId}`);
          }

          const unavailableReason = getAudioInputAdapterProviderUnavailableReason(providerId);
          if (unavailableReason) {
            return resultOk({
              capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
              providerId,
              ready: false,
              status: 'offline',
              reason: unavailableReason,
            });
          }

          const health = await readAudioInputAdapterProviderHealth(entry);
          const runtimeState = ensureAudioInputAdapterProviderRuntimeState(providerId);
          return resultOk({
            capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
            providerId,
            ready: health.status === 'ready',
            status: health.status,
            message: health.message,
            thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
            totalFailureCount: runtimeState.totalFailureCount,
            consecutiveFailureCount: runtimeState.consecutiveFailureCount,
            quarantined: isAudioInputAdapterProviderQuarantined(providerId),
          });
        }

        if (!inputIds) {
          const hasProviderOnlyPath =
            audioInputAdapterGovernance.thirdPartyEnabled && availableProviderCount > 0;
          return resultOk({
            capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
            ready: hasProviderOnlyPath,
            status: hasProviderOnlyPath ? 'ready' : 'idle',
            reason: hasProviderOnlyPath ? 'provider-only' : 'bridge-unavailable',
            inputCount: 0,
            availableProviderCount,
            pluginOpenSessionCount: 0,
          });
        }

        const pluginOpenSessionCount = countPluginAudioInputAdapterSessions(request.context.pluginId);
        return resultOk({
          capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
          ready: inputIds.length > 0,
          status: inputIds.length > 0 ? 'ready' : 'degraded',
          reason: inputIds.length > 0 ? undefined : 'no-input-registered',
          inputCount: inputIds.length,
          availableProviderCount,
          thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
          pluginOpenSessionCount,
        });
      }
      case 'listInputs': {
        const inputIds = await listAudioInputAdapterIds(request);
        if (!inputIds) {
          return resultError('NOT_AVAILABLE', 'Audio input adapter bridge is not available');
        }

        const providers = listAvailableAudioInputAdapterProviders();

        return resultOk({
          inputCount: inputIds.length + providers.length,
          builtinInputCount: inputIds.length,
          providerCount: providers.length,
          thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
          inputs: inputIds.map((id) => ({
            id,
            builtin: true,
          })),
          providerInputs: providers.map(({ providerId, entry }) => ({
            id: providerId,
            name: entry.info.name,
            protocolVersion: entry.info.protocolVersion,
            builtin: false,
          })),
        });
      }
      case 'listProviders': {
        const providers = Array.from(audioInputAdapterProviders.entries())
          .map(([providerId, entry]) => ({
            ...ensureAudioInputAdapterProviderRuntimeState(providerId),
            ...entry.info,
            enabled: !getAudioInputAdapterProviderUnavailableReason(providerId),
            unavailableReason: getAudioInputAdapterProviderUnavailableReason(providerId),
            quarantined: isAudioInputAdapterProviderQuarantined(providerId),
            allowlisted:
              audioInputAdapterGovernance.allowedProviderIds === null
                ? true
                : audioInputAdapterGovernance.allowedProviderIds.has(providerId),
          }))
          .sort((left, right) => left.id.localeCompare(right.id));

        return resultOk({
          thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
          providerCount: providers.length,
          defaultProviderId: audioInputAdapterDefaultProviderId,
          providers,
          timeoutMs: audioInputAdapterGovernance.timeoutMs,
          maxOpenSessionsPerPlugin: audioInputAdapterGovernance.maxOpenSessionsPerPlugin,
          quarantineThreshold: audioInputAdapterGovernance.quarantineThreshold,
          quarantineMs: audioInputAdapterGovernance.quarantineMs,
        });
      }
      case 'stats': {
        const payload = asObject(request.payload);
        const providerIdFilter = asNonEmptyString(payload?.providerId)?.toLowerCase() ?? null;
        const providerStats = listAudioInputAdapterProviderRuntimeStats().filter((provider) =>
          providerIdFilter ? provider.providerId.toLowerCase() === providerIdFilter : true
        );

        return resultOk({
          capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
          thirdPartyEnabled: audioInputAdapterGovernance.thirdPartyEnabled,
          timeoutMs: audioInputAdapterGovernance.timeoutMs,
          maxOpenSessionsPerPlugin: audioInputAdapterGovernance.maxOpenSessionsPerPlugin,
          quarantineThreshold: audioInputAdapterGovernance.quarantineThreshold,
          quarantineMs: audioInputAdapterGovernance.quarantineMs,
          pluginOpenSessionCount: countPluginAudioInputAdapterSessions(request.context.pluginId),
          totalOpenSessionCount: audioInputAdapterSessions.size,
          providerStats,
        });
      }
      case 'clearProviderQuarantine': {
        const payload = asObject(request.payload);
        const providerId = asNonEmptyString(payload?.providerId);

        if (providerId) {
          if (!audioInputAdapterProviders.has(providerId)) {
            return resultError('NOT_FOUND', `Unknown audio input adapter provider: ${providerId}`);
          }

          clearAudioInputAdapterProviderQuarantine(providerId);
          recordAudioInputAdapterAuditEvent({
            type: 'audio-input-adapter-provider-quarantine-cleared',
            pluginId: request.context.pluginId,
            hostLabel: request.context.hostLabel,
            providerId,
            reason: 'requested',
          });

          return resultOk({
            capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
            providerId,
            cleared: true,
          });
        }

        for (const knownProviderId of audioInputAdapterProviders.keys()) {
          clearAudioInputAdapterProviderQuarantine(knownProviderId);
        }

        recordAudioInputAdapterAuditEvent({
          type: 'audio-input-adapter-provider-quarantine-cleared',
          pluginId: request.context.pluginId,
          hostLabel: request.context.hostLabel,
          reason: 'requested-all',
        });

        return resultOk({
          capabilityId: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
          cleared: true,
          providerCount: audioInputAdapterProviders.size,
        });
      }
      case 'probe': {
        const payload = asObject(request.payload);
        if (!payload) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        const sourcePath = resolveAudioInputSourcePath(payload);
        if (!sourcePath) {
          return resultError('INVALID_PAYLOAD', 'payload.path or payload.sourceUri is required');
        }

        const requestedProviderId = asNonEmptyString(payload.providerId);
        const preferredInputId = asNonEmptyString(payload.preferredInputId);

        const explicitProviderReason = requestedProviderId
          ? getAudioInputAdapterProviderUnavailableReason(requestedProviderId)
          : null;

        const provider = resolveAudioInputAdapterProvider(requestedProviderId);
        if (requestedProviderId && !provider) {
          if (!audioInputAdapterProviders.has(requestedProviderId)) {
            return resultError('NOT_FOUND', `Unknown audio input adapter provider: ${requestedProviderId}`);
          }

          return resultError(
            'PROVIDER_UNAVAILABLE',
            `Audio input adapter provider unavailable: ${requestedProviderId}`,
            {
              details: {
                providerId: requestedProviderId,
                reason: explicitProviderReason ?? 'unavailable',
              },
            }
          );
        }

        const inputIds = await listAudioInputAdapterIds(request);
        if (inputIds && inputIds.length > 0) {
          if (preferredInputId && !findAudioInputAdapterId(inputIds, preferredInputId)) {
            return resultError('NOT_FOUND', `Unknown audio input adapter: ${preferredInputId}`);
          }
        }

        if (provider?.entry.probe) {
          const runtimeState = ensureAudioInputAdapterProviderRuntimeState(provider.providerId);
          runtimeState.totalProbeCount += 1;

          try {
            const probeResult = await withAdapterTimeout(
              Promise.resolve(
                provider.entry.probe({
                  sourcePath,
                  preferredInputId,
                  context: request.context,
                })
              ),
              audioInputAdapterGovernance.timeoutMs,
              `Audio input adapter provider probe timed out: ${provider.providerId}`
            );

            const supported = probeResult?.supported === true;
            if (supported) {
              markAudioInputAdapterProviderSuccess(provider.providerId);

              const selectedInputId =
                asNonEmptyString(probeResult.inputId) ??
                preferredInputId ??
                provider.providerId;
              return resultOk({
                sourcePath,
                selectedAdapterKind: 'provider',
                selectedProviderId: provider.providerId,
                selectedInputId,
                supported: true,
                confidence: 'provider',
                providerScore: normalizeAudioInputAdapterProviderScore(probeResult.score),
                details: probeResult.details,
                builtinCandidates: inputIds ?? [],
              });
            }

            if (probeResult?.supported === false && asNonEmptyString(probeResult.reason)) {
              markAudioInputAdapterProviderFailure(
                provider.providerId,
                asNonEmptyString(probeResult.reason) ?? 'probe-not-supported',
                request.context
              );
            }
          } catch (error) {
            markAudioInputAdapterProviderFailure(
              provider.providerId,
              toErrorMessage(error),
              request.context
            );
            if (!inputIds || inputIds.length < 1) {
              return resultError('PROVIDER_ERROR', toErrorMessage(error), {
                retryable: true,
                details: { providerId: provider.providerId },
              });
            }
          }
        }

        if (!inputIds) {
          return resultError('NOT_AVAILABLE', 'Audio input adapter bridge is not available');
        }
        if (inputIds.length < 1) {
          return resultError('NOT_CONFIGURED', 'No audio input adapters are available');
        }

        const selection = chooseAudioInputForSourcePath({
          sourcePath,
          inputIds,
          preferredInputId,
        });

        return resultOk({
          sourcePath,
          extension: selection.extension,
          supported: true,
          selectedAdapterKind: 'builtin',
          selectedInputId: selection.inputId,
          confidence: selection.confidence,
          candidates: inputIds,
          fallbackFromProvider: provider?.providerId,
        });
      }
      case 'openSession': {
        const payload = asObject(request.payload);
        if (!payload) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        const sourcePath = resolveAudioInputSourcePath(payload);
        if (!sourcePath) {
          return resultError('INVALID_PAYLOAD', 'payload.path or payload.sourceUri is required');
        }

        const requestedProviderId = asNonEmptyString(payload.providerId);
        const allowFallbackToBuiltin = payload.fallbackToBuiltin !== false;
        const preferredInputId = asNonEmptyString(payload.preferredInputId);

        const pluginOpenSessionCount = countPluginAudioInputAdapterSessions(request.context.pluginId);
        if (pluginOpenSessionCount >= audioInputAdapterGovernance.maxOpenSessionsPerPlugin) {
          return resultError(
            'RESOURCE_EXHAUSTED',
            `Audio input adapter session limit exceeded (${audioInputAdapterGovernance.maxOpenSessionsPerPlugin})`,
            {
              details: {
                pluginOpenSessionCount,
                maxOpenSessionsPerPlugin: audioInputAdapterGovernance.maxOpenSessionsPerPlugin,
              },
            }
          );
        }

        const explicitProviderReason = requestedProviderId
          ? getAudioInputAdapterProviderUnavailableReason(requestedProviderId)
          : null;

        const provider = resolveAudioInputAdapterProvider(requestedProviderId);
        if (requestedProviderId && !provider) {
          if (!audioInputAdapterProviders.has(requestedProviderId)) {
            return resultError('NOT_FOUND', `Unknown audio input adapter provider: ${requestedProviderId}`);
          }

          return resultError(
            'PROVIDER_UNAVAILABLE',
            `Audio input adapter provider unavailable: ${requestedProviderId}`,
            {
              details: {
                providerId: requestedProviderId,
                reason: explicitProviderReason ?? 'unavailable',
              },
            }
          );
        }

        let providerFailure:
          | {
              providerId: string;
              message: string;
            }
          | undefined;

        if (provider) {
          const runtimeState = ensureAudioInputAdapterProviderRuntimeState(provider.providerId);
          runtimeState.totalOpenSessionCount += 1;

          try {
            const providerOpenRaw = await withAdapterTimeout(
              Promise.resolve(
                provider.entry.openSession({
                  sourcePath,
                  preferredInputId,
                  context: request.context,
                })
              ),
              audioInputAdapterGovernance.timeoutMs,
              `Audio input adapter provider openSession timed out: ${provider.providerId}`
            );

            const providerOpen = normalizeAudioInputAdapterProviderOpenResult(providerOpenRaw);
            const selectedInputId =
              providerOpen.selectedInputId ?? preferredInputId ?? provider.providerId;

            markAudioInputAdapterProviderSuccess(provider.providerId);

            const sessionId = nextAudioInputAdapterSessionId();
            const openedAtMs = Date.now();
            audioInputAdapterSessions.set(sessionId, {
              sessionId,
              pluginId: request.context.pluginId,
              sourcePath,
              selectedInputId,
              adapterKind: 'provider',
              adapterId: provider.providerId,
              providerSessionId: providerOpen.providerSessionId,
              openedAtMs,
            });

            recordAudioInputAdapterAuditEvent({
              type: 'audio-input-adapter-selected',
              pluginId: request.context.pluginId,
              hostLabel: request.context.hostLabel,
              sessionId,
              sourcePath,
              adapterKind: 'provider',
              adapterId: provider.providerId,
              selectedInputId,
              providerSessionId: providerOpen.providerSessionId,
            });

            return resultOk({
              sessionId,
              sourcePath,
              selectedAdapterKind: 'provider',
              selectedProviderId: provider.providerId,
              selectedInputId,
              providerSessionId: providerOpen.providerSessionId,
              metadata: providerOpen.metadata,
              openedAtMs,
            });
          } catch (error) {
            markAudioInputAdapterProviderFailure(
              provider.providerId,
              toErrorMessage(error),
              request.context
            );

            providerFailure = {
              providerId: provider.providerId,
              message: toErrorMessage(error),
            };
            if (!allowFallbackToBuiltin) {
              return resultError('OPEN_SESSION_FAILED', providerFailure.message, {
                retryable: true,
                details: {
                  providerId: provider.providerId,
                },
              });
            }
          }
        }

        const inputIds = await listAudioInputAdapterIds(request);
        if (!inputIds) {
          return resultError('NOT_AVAILABLE', 'Audio input adapter bridge is not available');
        }
        if (inputIds.length < 1) {
          return resultError('NOT_CONFIGURED', 'No audio input adapters are available');
        }

        if (preferredInputId && !findAudioInputAdapterId(inputIds, preferredInputId)) {
          return resultError('NOT_FOUND', `Unknown audio input adapter: ${preferredInputId}`);
        }

        const selection = chooseAudioInputForSourcePath({
          sourcePath,
          inputIds,
          preferredInputId,
        });

        const bridge = request.context.audioInputAdapter;
        if (bridge?.selectInput) {
          try {
            await Promise.resolve(bridge.selectInput(selection.inputId));
          } catch (error) {
            return resultError('INPUT_SELECT_FAILED', toErrorMessage(error), {
              retryable: true,
              details: {
                selectedInputId: selection.inputId,
              },
            });
          }
        }

        const sessionId = nextAudioInputAdapterSessionId();
        const openedAtMs = Date.now();
        audioInputAdapterSessions.set(sessionId, {
          sessionId,
          pluginId: request.context.pluginId,
          sourcePath,
          selectedInputId: selection.inputId,
          adapterKind: 'builtin',
          adapterId: selection.inputId,
          openedAtMs,
        });

        if (providerFailure) {
          recordAudioInputAdapterAuditEvent({
            type: 'audio-input-adapter-fallback',
            pluginId: request.context.pluginId,
            hostLabel: request.context.hostLabel,
            sourcePath,
            fromProviderId: providerFailure.providerId,
            toAdapterKind: 'builtin',
            toAdapterId: selection.inputId,
            selectedInputId: selection.inputId,
            reason: providerFailure.message,
          });
        }

        recordAudioInputAdapterAuditEvent({
          type: 'audio-input-adapter-selected',
          pluginId: request.context.pluginId,
          hostLabel: request.context.hostLabel,
          sessionId,
          sourcePath,
          adapterKind: 'builtin',
          adapterId: selection.inputId,
          selectedInputId: selection.inputId,
          fallbackFromProviderId: providerFailure?.providerId,
        });

        return resultOk({
          sessionId,
          sourcePath,
          selectedAdapterKind: 'builtin',
          selectedInputId: selection.inputId,
          confidence: selection.confidence,
          fallbackFromProvider: providerFailure,
          openedAtMs,
        });
      }
      case 'closeSession': {
        const payload = asObject(request.payload);
        const sessionId = asNonEmptyString(payload?.sessionId);
        if (!sessionId) {
          return resultError('INVALID_PAYLOAD', 'payload.sessionId is required');
        }

        const existing = audioInputAdapterSessions.get(sessionId);
        if (!existing) {
          return resultError('NOT_FOUND', `Unknown audio input adapter session: ${sessionId}`);
        }
        if (existing.pluginId !== request.context.pluginId) {
          return resultError('FORBIDDEN', 'Session ownership mismatch');
        }

        if (existing.adapterKind === 'provider') {
          const provider = audioInputAdapterProviders.get(existing.adapterId);
          const runtimeState = ensureAudioInputAdapterProviderRuntimeState(existing.adapterId);
          runtimeState.totalCloseSessionCount += 1;

          if (provider?.closeSession) {
            try {
              await withAdapterTimeout(
                Promise.resolve(
                  provider.closeSession({
                    sessionId,
                    providerSessionId: existing.providerSessionId,
                    context: request.context,
                  })
                ),
                audioInputAdapterGovernance.timeoutMs,
                `Audio input adapter provider closeSession timed out: ${existing.adapterId}`
              );
              markAudioInputAdapterProviderSuccess(existing.adapterId);
            } catch (error) {
              markAudioInputAdapterProviderFailure(
                existing.adapterId,
                toErrorMessage(error),
                request.context
              );
              return resultError('CLOSE_SESSION_FAILED', toErrorMessage(error), {
                retryable: true,
                details: {
                  sessionId,
                  providerId: existing.adapterId,
                },
              });
            }
          }
        }

        audioInputAdapterSessions.delete(sessionId);

        recordAudioInputAdapterAuditEvent({
          type: 'audio-input-adapter-session-closed',
          pluginId: request.context.pluginId,
          hostLabel: request.context.hostLabel,
          sessionId,
          adapterKind: existing.adapterKind,
          adapterId: existing.adapterId,
          providerSessionId: existing.providerSessionId,
          reason: 'requested',
        });

        return resultOk({
          sessionId,
          closed: true,
          adapterKind: existing.adapterKind,
          adapterId: existing.adapterId,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported audio input adapter method: ${request.method}`
        );
    }
  };
}

function createAiAdapterHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: AI_ADAPTER_CAPABILITY_ID,
          domain: 'ai-runtime',
          stage: 'prototype',
          implementation: 'provider-registry',
          ready: aiAdapterProviders.size > 0,
          providerCount: aiAdapterProviders.size,
          defaultProviderId: aiAdapterDefaultProviderId,
          methods: [
            'describe',
            'health',
            'listProviders',
            'invoke',
            'searchTracks',
            'queueTracks',
            'playTrack',
          ],
        });
      case 'health': {
        const payload = asObject(request.payload);
        const providerId = asNonEmptyString(payload?.providerId);

        if (!providerId) {
          if (aiAdapterProviders.size < 1) {
            return resultOk({
              capabilityId: AI_ADAPTER_CAPABILITY_ID,
              ready: false,
              status: 'idle',
              reason: 'not-configured',
              providerCount: 0,
            });
          }

          return resultOk({
            capabilityId: AI_ADAPTER_CAPABILITY_ID,
            ready: true,
            status: 'ready',
            providerCount: aiAdapterProviders.size,
            defaultProviderId: aiAdapterDefaultProviderId,
          });
        }

        const provider = aiAdapterProviders.get(providerId);
        if (!provider) {
          return resultError('NOT_FOUND', `Unknown AI adapter provider: ${providerId}`);
        }

        const health = await readProviderHealth(provider);
        return resultOk({
          capabilityId: AI_ADAPTER_CAPABILITY_ID,
          providerId,
          ready: health.status === 'ready',
          status: health.status,
          message: health.message,
        });
      }
      case 'listProviders': {
        const payload = asObject(request.payload);
        const requestedCapability = asNonEmptyString(payload?.capability);

        if (
          requestedCapability &&
          !isAiAdapterProviderCapability(requestedCapability)
        ) {
          return resultError(
            'INVALID_PAYLOAD',
            `payload.capability must be one of: ${Array.from(
              AI_ADAPTER_PROVIDER_CAPABILITIES
            ).join(', ')}`
          );
        }

        const capabilityFilter =
          requestedCapability && isAiAdapterProviderCapability(requestedCapability)
            ? requestedCapability
            : null;

        const providers = listAiAdapterProviderInfos().filter((provider) =>
          capabilityFilter
            ? provider.capabilities.includes(capabilityFilter)
            : true
        );

        return resultOk({
          providers,
          defaultProviderId: aiAdapterDefaultProviderId,
          providerCount: providers.length,
        });
      }
      case 'searchTracks': {
        const controls = request.context.aiControl;
        if (!controls) {
          return resultError('NOT_AVAILABLE', 'Host AI controls are not available');
        }

        const payload = asObject(request.payload);
        const query = asNonEmptyString(payload?.query);
        if (!query) {
          return resultError('INVALID_PAYLOAD', 'payload.query is required');
        }

        const limit = toPositiveIntInRange(payload?.limit, 25, { min: 1, max: 200 });
        const tracks = await controls.searchTracks(query, limit);
        const summaries = summarizeAiAdapterTracks(tracks);

        return resultOk({
          query,
          limit,
          count: summaries.length,
          tracks: summaries,
        });
      }
      case 'queueTracks': {
        const controls = request.context.aiControl;
        if (!controls) {
          return resultError('NOT_AVAILABLE', 'Host AI controls are not available');
        }

        const payload = asObject(request.payload);
        const query = asNonEmptyString(payload?.query);
        if (!query) {
          return resultError('INVALID_PAYLOAD', 'payload.query is required');
        }

        const limit = toPositiveIntInRange(payload?.limit, 25, { min: 1, max: 200 });
        const tracks = await controls.searchTracks(query, limit);
        const summaries = summarizeAiAdapterTracks(tracks);

        const queueState = controls.enqueueTracks(tracks, { replaceQueue: false });

        return resultOk({
          query,
          queuedCount: summaries.length,
          queueSize: queueState.nextQueueSize,
          tracks: summaries,
        });
      }
      case 'playTrack': {
        const controls = request.context.aiControl;
        if (!controls) {
          return resultError('NOT_AVAILABLE', 'Host AI controls are not available');
        }

        const payload = asObject(request.payload);
        const query = asNonEmptyString(payload?.query);
        if (!query) {
          return resultError('INVALID_PAYLOAD', 'payload.query is required');
        }

        const limit = toPositiveIntInRange(payload?.limit, 25, { min: 1, max: 200 });
        const matchIndex = toNonNegativeInt(payload?.matchIndex, 0);
        const queueMode = asNonEmptyString(payload?.queueMode);

        if (queueMode && queueMode !== 'replace' && queueMode !== 'append') {
          return resultError('INVALID_PAYLOAD', 'payload.queueMode must be "replace" or "append"');
        }

        const tracks = await controls.searchTracks(query, limit);
        const summaries = summarizeAiAdapterTracks(tracks);

        if (summaries.length < 1) {
          return resultError('NOT_FOUND', `No tracks matched query: ${query}`);
        }

        if (matchIndex >= summaries.length) {
          return resultError(
            'NOT_FOUND',
            `matchIndex out of range: ${matchIndex} (tracks=${summaries.length})`
          );
        }

        const replaceQueue = queueMode !== 'append';
        const queueState = controls.enqueueTracks(tracks, { replaceQueue });
        const queueIndex = replaceQueue ? matchIndex : queueState.previousQueueSize + matchIndex;

        await controls.playQueueIndex(queueIndex);

        return resultOk({
          query,
          queueMode: replaceQueue ? 'replace' : 'append',
          matchCount: summaries.length,
          selectedIndex: matchIndex,
          queueIndex,
          queueSize: queueState.nextQueueSize,
          track: summaries[matchIndex],
        });
      }
      case 'invoke': {
        const payload = asObject(request.payload);
        if (!payload) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        const providerId = asNonEmptyString(payload.providerId);
        const task = asNonEmptyString(payload.task);
        const options = payload.options;
        const optionsRecord = asObject(options);

        if (!task) {
          return resultError('INVALID_PAYLOAD', 'payload.task is required');
        }

        if (typeof options !== 'undefined' && !optionsRecord) {
          return resultError('INVALID_PAYLOAD', 'payload.options must be an object');
        }

        const provider = resolveAiAdapterProvider(providerId);
        if (!provider) {
          if (providerId) {
            return resultError('NOT_FOUND', `Unknown AI adapter provider: ${providerId}`);
          }
          return resultError('NOT_CONFIGURED', 'No AI adapter provider is configured');
        }

        const startedAt = Date.now();

        try {
          const output = await provider.invoke({
            task,
            input: payload.input,
            options: optionsRecord ?? {},
            context: request.context,
          });

          return resultOk({
            providerId: provider.info.id,
            task,
            elapsedMs: Date.now() - startedAt,
            output,
          });
        } catch (error) {
          return resultError('PROVIDER_ERROR', toErrorMessage(error), {
            retryable: true,
            details: {
              providerId: provider.info.id,
              task,
            },
          });
        }
      }
      default:
        return resultError('METHOD_NOT_SUPPORTED', `Unsupported AI adapter method: ${request.method}`);
    }
  };
}

function resolveRuntimeProvider(
  registry: Map<string, RuntimeProviderEntry>,
  defaultProviderId: string | null,
  requestedProviderId: string | null
): { providerId: string; provider: RuntimeProviderEntry } | null {
  if (requestedProviderId) {
    const provider = registry.get(requestedProviderId);
    if (!provider) return null;
    return {
      providerId: requestedProviderId,
      provider,
    };
  }

  if (defaultProviderId) {
    const provider = registry.get(defaultProviderId);
    if (provider) {
      return {
        providerId: defaultProviderId,
        provider,
      };
    }
  }

  const nextProviderId = nextRuntimeDefaultProviderId(registry);
  if (!nextProviderId) return null;
  const nextProvider = registry.get(nextProviderId);
  if (!nextProvider) return null;
  return {
    providerId: nextProviderId,
    provider: nextProvider,
  };
}

function createRuntimeProviderCapabilityHandler(options: {
  capabilityId: string;
  domain: 'desktop-pet' | 'voice-training';
  registry: Map<string, RuntimeProviderEntry>;
  getDefaultProviderId: () => string | null;
  setDefaultProviderId: (providerId: string | null) => void;
}): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: options.capabilityId,
          domain: options.domain,
          stage: 'foundation-runtime',
          implementation: 'provider-registry',
          ready: options.registry.size > 0,
          providerCount: options.registry.size,
          defaultProviderId: options.getDefaultProviderId(),
          methods: ['describe', 'health', 'listProviders', 'invoke'],
        });
      case 'health': {
        const payload = asObject(request.payload);
        const providerId = asNonEmptyString(payload?.providerId);

        if (!providerId) {
          if (options.registry.size < 1) {
            return resultOk({
              capabilityId: options.capabilityId,
              ready: false,
              status: 'idle',
              reason: 'not-configured',
              providerCount: 0,
            });
          }

          return resultOk({
            capabilityId: options.capabilityId,
            ready: true,
            status: 'ready',
            providerCount: options.registry.size,
            defaultProviderId: options.getDefaultProviderId(),
          });
        }

        const provider = options.registry.get(providerId);
        if (!provider) {
          return resultError('NOT_FOUND', `Unknown runtime provider: ${providerId}`);
        }

        const health = await readRuntimeProviderHealth(provider);
        return resultOk({
          capabilityId: options.capabilityId,
          providerId,
          ready: health.status === 'ready',
          status: health.status,
          message: health.message,
        });
      }
      case 'listProviders': {
        const payload = asObject(request.payload);
        const capabilityFilter = asNonEmptyString(payload?.capability);

        const providers = listRuntimeProviderInfos(options.registry).filter((provider) =>
          capabilityFilter ? provider.capabilities.includes(capabilityFilter) : true
        );

        return resultOk({
          capabilityId: options.capabilityId,
          providers,
          providerCount: providers.length,
          defaultProviderId: options.getDefaultProviderId(),
        });
      }
      case 'invoke': {
        const payload = asObject(request.payload);
        if (!payload) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        const providerId = asNonEmptyString(payload.providerId);
        const task = asNonEmptyString(payload.task);
        const optionsRecord = asObject(payload.options);

        if (!task) {
          return resultError('INVALID_PAYLOAD', 'payload.task is required');
        }

        if (typeof payload.options !== 'undefined' && !optionsRecord) {
          return resultError('INVALID_PAYLOAD', 'payload.options must be an object');
        }

        const resolved = resolveRuntimeProvider(
          options.registry,
          options.getDefaultProviderId(),
          providerId
        );

        if (!resolved) {
          if (providerId) {
            return resultError('NOT_FOUND', `Unknown runtime provider: ${providerId}`);
          }
          return resultError('NOT_CONFIGURED', 'No runtime provider is configured');
        }

        if (!options.getDefaultProviderId()) {
          options.setDefaultProviderId(resolved.providerId);
        }

        const startedAt = Date.now();
        try {
          const output = await resolved.provider.invoke({
            task,
            input: payload.input,
            options: optionsRecord ?? {},
            context: request.context,
          });

          return resultOk({
            capabilityId: options.capabilityId,
            providerId: resolved.providerId,
            task,
            elapsedMs: Date.now() - startedAt,
            output,
          });
        } catch (error) {
          return resultError('PROVIDER_ERROR', toErrorMessage(error), {
            retryable: true,
            details: {
              providerId: resolved.providerId,
              task,
            },
          });
        }
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported ${options.domain} runtime method: ${request.method}`
        );
    }
  };
}

function createRegistryHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'list': {
        return resultOk(listVisibleCapabilities(request.context.permissions));
      }
      case 'get': {
        const payload = asObject(request.payload);
        const capabilityId = asNonEmptyString(payload?.id);
        if (!capabilityId) {
          return resultError('INVALID_PAYLOAD', 'payload.id is required');
        }

        const entry = entries.get(capabilityId);
        if (!entry) {
          return resultError('NOT_FOUND', `Unknown capability: ${capabilityId}`);
        }

        if (!isVisibleToCaller(entry, request.context.permissions)) {
          return resultError('FORBIDDEN', `Permission denied for capability: ${capabilityId}`);
        }

        return resultOk(toCapabilityInfo(entry));
      }
      case 'has': {
        const payload = asObject(request.payload);
        const capabilityId = asNonEmptyString(payload?.id);
        if (!capabilityId) {
          return resultError('INVALID_PAYLOAD', 'payload.id is required');
        }

        const entry = entries.get(capabilityId);
        const visible = Boolean(entry && isVisibleToCaller(entry, request.context.permissions));
        return resultOk({ id: capabilityId, visible });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported registry method: ${request.method}`
        );
    }
  };
}

const BUILTIN_CAPABILITIES: PluginHostCapabilityRegistration[] = [
  {
    id: 'core.host-api',
    version: HOST_API_VERSION,
    description: 'Core PMPM host API surface',
  },
  {
    id: 'foundation.capability-registry',
    version: '1.1.0',
    permission: 'api:host',
    description: 'Capability discovery and invocation contract',
    handler: createRegistryHandler(),
  },
  {
    id: AI_ADAPTER_CAPABILITY_ID,
    version: AI_ADAPTER_CAPABILITY_VERSION,
    permission: 'api:ai-runtime',
    experimental: true,
    description: 'AI adapter provider registry and invocation bridge',
    handler: createAiAdapterHandler(),
  },
  {
    id: AUDIO_INPUT_ADAPTER_CAPABILITY_ID,
    version: AUDIO_INPUT_ADAPTER_CAPABILITY_VERSION,
    permission: 'api:audio-input-adapter',
    experimental: true,
    description: 'Hybrid audio input adapter bridge with optional third-party provider fallback',
    handler: createAudioInputAdapterHandler(),
  },
  {
    id: DESKTOP_PET_RUNTIME_CAPABILITY_ID,
    version: DESKTOP_PET_RUNTIME_CAPABILITY_VERSION,
    permission: 'api:desktop-pet',
    experimental: true,
    description: 'Desktop companion runtime provider registry and invocation bridge',
    handler: createRuntimeProviderCapabilityHandler({
      capabilityId: DESKTOP_PET_RUNTIME_CAPABILITY_ID,
      domain: 'desktop-pet',
      registry: desktopPetRuntimeProviders,
      getDefaultProviderId: () => desktopPetRuntimeDefaultProviderId,
      setDefaultProviderId: (providerId) => {
        desktopPetRuntimeDefaultProviderId = providerId;
      },
    }),
  },
  {
    id: VOICE_TRAINING_RUNTIME_CAPABILITY_ID,
    version: VOICE_TRAINING_RUNTIME_CAPABILITY_VERSION,
    permission: 'api:voice-training',
    experimental: true,
    description: 'Voice training runtime provider registry and invocation bridge',
    handler: createRuntimeProviderCapabilityHandler({
      capabilityId: VOICE_TRAINING_RUNTIME_CAPABILITY_ID,
      domain: 'voice-training',
      registry: voiceTrainingRuntimeProviders,
      getDefaultProviderId: () => voiceTrainingRuntimeDefaultProviderId,
      setDefaultProviderId: (providerId) => {
        voiceTrainingRuntimeDefaultProviderId = providerId;
      },
    }),
  },
];

function bootstrapBuiltins(): void {
  if (initialized) return;
  initialized = true;

  for (const builtin of BUILTIN_CAPABILITIES) {
    entries.set(builtin.id, {
      ...builtin,
      source: 'builtin',
    });
  }
}

export function listPluginHostCapabilities(): PluginHostCapabilityInfo[] {
  bootstrapBuiltins();
  return Array.from(entries.values())
    .map(toCapabilityInfo)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getPluginHostCapability(capabilityId: string): PluginHostCapabilityInfo | null {
  bootstrapBuiltins();
  const entry = entries.get(capabilityId);
  if (!entry) return null;
  return toCapabilityInfo(entry);
}

export async function invokePluginHostCapability(
  capabilityId: string,
  request: PluginHostCapabilityInvokeRequest
): Promise<unknown> {
  bootstrapBuiltins();
  const entry = entries.get(capabilityId);
  if (!entry) {
    throw new Error(`Unknown host capability: ${capabilityId}`);
  }
  if (typeof entry.handler !== 'function') {
    throw new Error(`Host capability is not invokable: ${capabilityId}`);
  }
  return await entry.handler(request);
}

export function registerPluginHostCapability(
  registration: PluginHostCapabilityRegistration
): () => void {
  bootstrapBuiltins();

  const id = typeof registration.id === 'string' ? registration.id.trim() : '';
  const version = typeof registration.version === 'string' ? registration.version.trim() : '';

  assertCapabilityId(id);
  assertVersion(version);

  if (entries.has(id)) {
    throw new Error(`Plugin host capability already exists: ${id}`);
  }

  entries.set(id, {
    ...registration,
    id,
    version,
    source: 'runtime',
  });

  return () => {
    const current = entries.get(id);
    if (!current || current.source !== 'runtime') return;
    entries.delete(id);
  };
}

export function registerAiAdapterProvider(
  registration: PluginHostAiAdapterProviderRegistration,
  options?: { setAsDefault?: boolean }
): () => void {
  const info = normalizeAiAdapterProviderInfo(registration.info);

  if (typeof registration.invoke !== 'function') {
    throw new Error(`AI adapter provider "${info.id}" must provide invoke(request)`);
  }

  if (aiAdapterProviders.has(info.id)) {
    throw new Error(`AI adapter provider already exists: ${info.id}`);
  }

  aiAdapterProviders.set(info.id, {
    info,
    invoke: registration.invoke,
    health: registration.health,
  });

  if (!aiAdapterDefaultProviderId || options?.setAsDefault) {
    aiAdapterDefaultProviderId = info.id;
  }

  return () => {
    const current = aiAdapterProviders.get(info.id);
    if (!current) return;
    aiAdapterProviders.delete(info.id);

    if (aiAdapterDefaultProviderId === info.id) {
      aiAdapterDefaultProviderId = nextAiAdapterDefaultProviderId();
    }
  };
}

export function listAiAdapterProviders(): PluginHostAiAdapterProviderInfo[] {
  return listAiAdapterProviderInfos();
}

export function setDefaultAiAdapterProvider(providerId: string): void {
  const normalizedId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedId) {
    throw new Error('AI adapter provider id is required');
  }

  if (!aiAdapterProviders.has(normalizedId)) {
    throw new Error(`Unknown AI adapter provider: ${normalizedId}`);
  }

  aiAdapterDefaultProviderId = normalizedId;
}

export function registerAudioInputAdapterProvider(
  registration: PluginHostAudioInputAdapterProviderRegistration,
  options?: { setAsDefault?: boolean }
): () => void {
  const info = normalizeAudioInputAdapterProviderInfo(registration.info);

  if (typeof registration.openSession !== 'function') {
    throw new Error(`Audio input adapter provider "${info.id}" must provide openSession(request)`);
  }

  if (audioInputAdapterProviders.has(info.id)) {
    throw new Error(`Audio input adapter provider already exists: ${info.id}`);
  }

  audioInputAdapterProviders.set(info.id, {
    info,
    probe: registration.probe,
    openSession: registration.openSession,
    closeSession: registration.closeSession,
    health: registration.health,
  });
  ensureAudioInputAdapterProviderRuntimeState(info.id);

  if (!audioInputAdapterDefaultProviderId || options?.setAsDefault) {
    audioInputAdapterDefaultProviderId = info.id;
  }

  return () => {
    const current = audioInputAdapterProviders.get(info.id);
    if (!current) return;
    audioInputAdapterProviders.delete(info.id);
    audioInputAdapterProviderRuntimeState.delete(info.id);

    if (audioInputAdapterDefaultProviderId === info.id) {
      audioInputAdapterDefaultProviderId = nextAudioInputAdapterDefaultProviderId();
    }
  };
}

export function listAudioInputAdapterProviders(): PluginHostAudioInputAdapterProviderInfo[] {
  return Array.from(audioInputAdapterProviders.values())
    .map((entry) => ({
      ...entry.info,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function setDefaultAudioInputAdapterProvider(providerId: string): void {
  const normalizedId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedId) {
    throw new Error('Audio input adapter provider id is required');
  }

  if (!audioInputAdapterProviders.has(normalizedId)) {
    throw new Error(`Unknown audio input adapter provider: ${normalizedId}`);
  }

  audioInputAdapterDefaultProviderId = normalizedId;
}

export function configureAudioInputAdapterGovernance(
  options: PluginHostAudioInputAdapterGovernanceOptions = {}
): void {
  if (typeof options.thirdPartyEnabled === 'boolean') {
    audioInputAdapterGovernance.thirdPartyEnabled = options.thirdPartyEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(options, 'allowedProviderIds')) {
    const allowedProviderIds = options.allowedProviderIds;
    if (!Array.isArray(allowedProviderIds)) {
      audioInputAdapterGovernance.allowedProviderIds = null;
    } else {
      const normalized = new Set<string>();
      for (const value of allowedProviderIds) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        normalized.add(trimmed);
      }
      audioInputAdapterGovernance.allowedProviderIds = normalized;
    }
  }

  if (Object.prototype.hasOwnProperty.call(options, 'timeoutMs')) {
    audioInputAdapterGovernance.timeoutMs = toTimeoutMs(
      options.timeoutMs,
      AUDIO_INPUT_ADAPTER_PROVIDER_DEFAULT_TIMEOUT_MS
    );
  }

  if (Object.prototype.hasOwnProperty.call(options, 'maxOpenSessionsPerPlugin')) {
    audioInputAdapterGovernance.maxOpenSessionsPerPlugin = toPositiveIntInRange(
      options.maxOpenSessionsPerPlugin,
      AUDIO_INPUT_ADAPTER_MAX_OPEN_SESSIONS_PER_PLUGIN_DEFAULT,
      {
        min: 1,
        max: AUDIO_INPUT_ADAPTER_MAX_OPEN_SESSIONS_PER_PLUGIN_MAX,
      }
    );
  }

  if (Object.prototype.hasOwnProperty.call(options, 'quarantineThreshold')) {
    audioInputAdapterGovernance.quarantineThreshold = toPositiveIntInRange(
      options.quarantineThreshold,
      AUDIO_INPUT_ADAPTER_QUARANTINE_THRESHOLD_DEFAULT,
      {
        min: 1,
        max: AUDIO_INPUT_ADAPTER_QUARANTINE_THRESHOLD_MAX,
      }
    );
  }

  if (Object.prototype.hasOwnProperty.call(options, 'quarantineMs')) {
    audioInputAdapterGovernance.quarantineMs = toPositiveIntInRange(
      options.quarantineMs,
      AUDIO_INPUT_ADAPTER_QUARANTINE_MS_DEFAULT,
      {
        min: 1_000,
        max: AUDIO_INPUT_ADAPTER_QUARANTINE_MS_MAX,
      }
    );
  }
}

export function registerDesktopPetRuntimeProvider(
  registration: PluginHostDesktopPetProviderRegistration,
  options?: { setAsDefault?: boolean }
): () => void {
  const info = normalizeRuntimeProviderInfo(registration.info, 'desktop-pet');

  if (typeof registration.invoke !== 'function') {
    throw new Error(`Desktop pet runtime provider "${info.id}" must provide invoke(request)`);
  }

  if (desktopPetRuntimeProviders.has(info.id)) {
    throw new Error(`Desktop pet runtime provider already exists: ${info.id}`);
  }

  desktopPetRuntimeProviders.set(info.id, {
    info,
    invoke: registration.invoke,
    health: registration.health,
  });

  if (!desktopPetRuntimeDefaultProviderId || options?.setAsDefault) {
    desktopPetRuntimeDefaultProviderId = info.id;
  }

  return () => {
    const current = desktopPetRuntimeProviders.get(info.id);
    if (!current) return;
    desktopPetRuntimeProviders.delete(info.id);

    if (desktopPetRuntimeDefaultProviderId === info.id) {
      desktopPetRuntimeDefaultProviderId = nextRuntimeDefaultProviderId(desktopPetRuntimeProviders);
    }
  };
}

export function listDesktopPetRuntimeProviders(): PluginHostDesktopPetProviderInfo[] {
  return listRuntimeProviderInfos(desktopPetRuntimeProviders);
}

export function setDefaultDesktopPetRuntimeProvider(providerId: string): void {
  const normalizedId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedId) {
    throw new Error('Desktop pet runtime provider id is required');
  }

  if (!desktopPetRuntimeProviders.has(normalizedId)) {
    throw new Error(`Unknown desktop pet runtime provider: ${normalizedId}`);
  }

  desktopPetRuntimeDefaultProviderId = normalizedId;
}

export function registerVoiceTrainingRuntimeProvider(
  registration: PluginHostVoiceTrainingProviderRegistration,
  options?: { setAsDefault?: boolean }
): () => void {
  const info = normalizeRuntimeProviderInfo(registration.info, 'voice-training');

  if (typeof registration.invoke !== 'function') {
    throw new Error(`Voice training runtime provider "${info.id}" must provide invoke(request)`);
  }

  if (voiceTrainingRuntimeProviders.has(info.id)) {
    throw new Error(`Voice training runtime provider already exists: ${info.id}`);
  }

  voiceTrainingRuntimeProviders.set(info.id, {
    info,
    invoke: registration.invoke,
    health: registration.health,
  });

  if (!voiceTrainingRuntimeDefaultProviderId || options?.setAsDefault) {
    voiceTrainingRuntimeDefaultProviderId = info.id;
  }

  return () => {
    const current = voiceTrainingRuntimeProviders.get(info.id);
    if (!current) return;
    voiceTrainingRuntimeProviders.delete(info.id);

    if (voiceTrainingRuntimeDefaultProviderId === info.id) {
      voiceTrainingRuntimeDefaultProviderId = nextRuntimeDefaultProviderId(voiceTrainingRuntimeProviders);
    }
  };
}

export function listVoiceTrainingRuntimeProviders(): PluginHostVoiceTrainingProviderInfo[] {
  return listRuntimeProviderInfos(voiceTrainingRuntimeProviders);
}

export function setDefaultVoiceTrainingRuntimeProvider(providerId: string): void {
  const normalizedId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedId) {
    throw new Error('Voice training runtime provider id is required');
  }

  if (!voiceTrainingRuntimeProviders.has(normalizedId)) {
    throw new Error(`Unknown voice training runtime provider: ${normalizedId}`);
  }

  voiceTrainingRuntimeDefaultProviderId = normalizedId;
}
