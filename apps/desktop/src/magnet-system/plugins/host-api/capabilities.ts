import { HOST_API_VERSION } from '../../../constants/versions';
import { BUILTIN_MAGNET_IDS } from '../../../constants/magnets';
import type { CommandContribution } from '../../../contracts/contributions';
import {
  PMP_HOST_CAPABILITY_FAMILIES,
  PMP_HOST_CAPABILITY_PACK_DESCRIPTOR,
  type PmpHostCapabilityFamilyId,
  type PmpHostCapabilityPackDescriptor,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  createDefaultMagnetSpaceLayout,
  ensureMagnetCatalogState,
  ensureMagnetSpaceLayout,
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  readMagnetCatalogState,
  removeMagnetCatalogMagnet,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetCatalogState,
  sanitizeMagnetSpaceLayout,
  upsertMagnetCatalogMagnet,
  type MagnetLayoutStorePatch,
  type MagnetSpaceLayout,
} from '../../../modules/magnets';
import {
  getMagnetRenderer,
  listRegisteredMagnetRenderers,
  type MagnetRendererDefinition,
} from '../../../magnet-system/registry';
import {
  listMagnetVariants,
  type MagnetVariantDefinition,
} from '../../../magnet-system/variantRegistry';
import {
  SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID,
  getSystemAnchorsByMagnetId,
} from '../../../modules/magnets/systemLayouts';
import {
  beginPlatformInstanceQrLogin,
  clearPlatformInstanceAuthCookies,
  getPlatformInstanceAuthSnapshot,
  listPlatformConnectorDefinitions,
  listPlatformInstanceAuthSnapshots,
  listPlatformConnectorFacadeItems,
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspacePages,
  listPlatformWorkspaceQualityState,
  listPlatformWorkspaceRecommendedCollections,
  listPlatformWorkspaceRecommendedResources,
  logoutPlatformInstance,
  getPlatformWorkspacePageModel,
  pollPlatformInstanceQrLogin,
  preparePlatformPlayback,
  preparePlatformWorkspacePlayback,
  refreshPlatformInstanceAuthSnapshot,
  resolvePlatformInstanceId,
  resolvePlatformWorkspaceCoverAssetUrl,
  searchPlatformWorkspaceResources,
  searchPlatformTracks,
  setPlatformWorkspaceQualityPreference,
} from '../../../modules/music-platform';
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  getLocale,
  isLocale,
  setLocale,
  type Locale,
  type Messages,
} from '../../../i18n/core';
import {
  listNativeLibraryFacetCatalog,
  listNativeLibraryFacetEntries,
  listNativeLibraryTextFacetValues,
  listNativeLibraryTrackFieldCatalog,
} from '../../../modules/music-library';
import { readDurableText, removeDurableText, writeDurableText } from '../../../modules/storage';
import { resolveThemeBinding, resolveThemeSurfaceTargetId } from '../../../themes/bindings';
import { getStoredOrDefaultTheme } from '../../../themes/runtimeTheme';
import { resolveThemeSurface } from '../../../themes/surfaces';
import type { ThemeBindingId, ThemeSurfaceId } from '../../../themes/types/theme';
import type { Magnet, PixelAnchor } from '../../../types/pixel';
import {
  TELEMETRY_KINDS,
  TELEMETRY_LEVELS,
  type TelemetryFields,
  type TelemetryKind,
  type TelemetryLevel,
} from '../../../contracts/telemetry';
import { getGlobalTelemetryService } from '../../../services/telemetry/TelemetryService';
import {
  broadcastDataUpdate,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../../utils/windowCommunication';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { readExtensionConfigSyncState } from '../pluginConfig';
import { recordInstalledExtensionAuditEvent } from '../extensionsGovernance';
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
const CORE_CAPABILITY_REGISTRY_CAPABILITY_ID = 'core.capability-registry';
const CORE_CAPABILITY_REGISTRY_CAPABILITY_VERSION = '1.1.0';
const AUDIO_INPUT_ADAPTER_CAPABILITY_ID = 'foundation.audio-input-adapter';
const AUDIO_INPUT_ADAPTER_CAPABILITY_VERSION = '0.4.0';
const HOST_PMP_NAVIGATION_CAPABILITY_ID = 'host.pmp.navigation';
const HOST_PMP_NAVIGATION_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_WINDOW_CAPABILITY_ID = 'host.pmp.shell.window';
const HOST_PMP_WINDOW_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_SHELL_MENU_CAPABILITY_ID = 'host.pmp.shell.menu';
const HOST_PMP_SHELL_MENU_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_SHELL_CONTEXT_MENU_CAPABILITY_ID = 'host.pmp.shell.context-menu';
const HOST_PMP_SHELL_CONTEXT_MENU_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_SHELL_TRAY_CAPABILITY_ID = 'host.pmp.shell.tray';
const HOST_PMP_SHELL_TRAY_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_SHELL_STATUS_ITEM_CAPABILITY_ID = 'host.pmp.shell.status-item';
const HOST_PMP_SHELL_STATUS_ITEM_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_STORAGE_CONFIG_CAPABILITY_ID = 'host.pmp.storage.config';
const HOST_PMP_STORAGE_CONFIG_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_STORAGE_DURABLE_TEXT_CAPABILITY_ID = 'host.pmp.storage.durable-text';
const HOST_PMP_STORAGE_DURABLE_TEXT_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_STORAGE_SYNC_CAPABILITY_ID = 'host.pmp.storage.sync';
const HOST_PMP_STORAGE_SYNC_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MAGNETS_CATALOG_CAPABILITY_ID = 'host.pmp.magnets.catalog';
const HOST_PMP_MAGNETS_CATALOG_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MAGNETS_LAYOUT_CAPABILITY_ID = 'host.pmp.magnets.layout';
const HOST_PMP_MAGNETS_LAYOUT_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MAGNETS_RENDERER_CAPABILITY_ID = 'host.pmp.magnets.renderer';
const HOST_PMP_MAGNETS_RENDERER_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_AUDIO_PLAYBACK_CAPABILITY_ID = 'host.pmp.audio-engine.playback';
const HOST_PMP_AUDIO_PLAYBACK_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_AUDIO_ANALYSIS_CAPABILITY_ID = 'host.pmp.audio-engine.analysis';
const HOST_PMP_AUDIO_ANALYSIS_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_AUDIO_INPUT_CAPABILITY_ID = 'host.pmp.audio-engine.input';
const HOST_PMP_AUDIO_INPUT_CAPABILITY_VERSION = '0.4.0';
const HOST_PMP_MUSIC_PLATFORM_CATALOG_CAPABILITY_ID = 'host.pmp.music-platform.catalog';
const HOST_PMP_MUSIC_PLATFORM_CATALOG_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_ID = 'host.pmp.music-platform.workspace';
const HOST_PMP_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MUSIC_PLATFORM_SEARCH_CAPABILITY_ID = 'host.pmp.music-platform.search';
const HOST_PMP_MUSIC_PLATFORM_SEARCH_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_MUSIC_PLATFORM_PREPARE_CAPABILITY_ID = 'host.pmp.music-platform.prepare';
const HOST_PMP_MUSIC_PLATFORM_PREPARE_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_CONNECTOR_AUTH_CAPABILITY_ID = 'host.pmp.connector-auth';
const HOST_PMP_CONNECTOR_AUTH_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_THEME_BINDINGS_CAPABILITY_ID = 'host.pmp.theme-bindings';
const HOST_PMP_THEME_BINDINGS_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_LIBRARY_FIELDS_CAPABILITY_ID = 'host.pmp.library-fields';
const HOST_PMP_LIBRARY_FIELDS_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_KEYBINDING_CONTEXT_CAPABILITY_ID = 'host.pmp.keybinding-context';
const HOST_PMP_KEYBINDING_CONTEXT_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_I18N_CAPABILITY_ID = 'host.pmp.i18n';
const HOST_PMP_I18N_CAPABILITY_VERSION = '1.0.0';
const HOST_PMP_TELEMETRY_CAPABILITY_ID = 'host.pmp.telemetry';
const HOST_PMP_TELEMETRY_CAPABILITY_VERSION = '1.0.0';
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
const TELEMETRY_IDENTIFIER_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/i;
const TELEMETRY_REDACTED_VALUE = '[REDACTED]';
const TELEMETRY_PLUGIN_MODULE_ID = 'extensions-plugin';
const TELEMETRY_MAX_TEXT_LENGTH = 2_048;
const TELEMETRY_MAX_FIELD_DEPTH = 4;
const TELEMETRY_MAX_FIELD_ITEMS = 50;
const SHELL_MENU_ITEM_PERMISSION_BY_COMMAND_ID: Record<string, string | null> = {
  'commandPalette:toggle': null,
  'commandPalette:close': null,
  'app:open-keyboard-shortcuts-window': 'api:window',
  'app:open-theme-editor-window': 'api:window',
  'app:open-debug-editor-window': 'api:window',
  'app:open-control-editor-window': 'api:window',
  'app:open-creator-editor-window': 'api:window',
  'app:open-custom-background-editor-window': 'api:window',
  'app:open-statistics-editor-window': 'api:window',
  'app:open-library-editor-window': 'api:window',
  'app:open-style-editor-window': 'api:window',
  'app:open-background-editor-window': 'api:window',
  'app:open-style-pixel-editor-window': 'api:window',
  'app:open-style-cover-color-editor-window': 'api:window',
  'app:open-style-background-effect-editor-window': 'api:window',
  'app:open-style-border-effect-editor-window': 'api:window',
  'app:navigate-home': 'api:navigation',
  'app:navigate-settings': 'api:navigation',
  'app:navigate-music-library': 'api:navigation',
  'app:navigate-dsp-rack': 'api:navigation',
  'app:navigate-perf-monitor': 'api:navigation',
  'app:navigate-native-debug': 'api:navigation',
  'app:navigate-debug-center': 'api:navigation',
  'app:open-vst3-plugin-manager': 'api:window',
  'app:go-back': 'api:navigation',
  'audio:previous-track': 'api:audio-control',
  'audio:next-track': 'api:audio-control',
  'audio:toggle-play-pause': 'api:audio-control',
};
const SHELL_TRAY_PRIMARY_ACTION_ID = 'toggle-main-window';
const SHELL_TRAY_ITEMS = [
  {
    id: 'show',
    label: 'Show Window',
    action: 'show-main-window',
    requiredPermission: 'api:window',
  },
  {
    id: 'hide',
    label: 'Hide Window',
    action: 'hide-main-window',
    requiredPermission: 'api:window',
  },
  {
    id: 'quit',
    label: 'Quit',
    action: 'request-app-exit',
    requiredPermission: 'api:window',
  },
] as const;
const SHELL_CONTEXT_MENU_SURFACE_SCHEMA = {
  supported: true,
  bridgeMode: 'schema-only',
  surfaceId: 'overlay.context-menu',
  itemKinds: ['action', 'divider', 'submenu'],
  supportsIcons: true,
  supportsDangerState: true,
  supportsNestedMenus: true,
  closeTriggers: ['outside-pointerdown', 'escape', 'item-activation'],
  placement: 'viewport-clamped-pointer-anchor',
} as const;
const SHELL_STATUS_ITEM_SLOT_SNAPSHOT = {
  supported: false,
  bridgeMode: 'unavailable',
  reason: 'not-wired',
  slotCount: 0,
  slots: [],
} as const;

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
  health?: () =>
    | Promise<PluginHostAudioInputAdapterProviderHealth>
    | PluginHostAudioInputAdapterProviderHealth;
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

const AI_ADAPTER_PROVIDER_CAPABILITIES: ReadonlySet<PluginHostAiAdapterProviderCapability> =
  new Set<PluginHostAiAdapterProviderCapability>([
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
  invoke: (request: PluginHostAiAdapterProviderInvokeRequest) => Promise<unknown> | unknown;
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
const pluginI18nMessageStores = new Map<string, Map<Locale, Messages>>();
const telemetryLevelSet = new Set<TelemetryLevel>(TELEMETRY_LEVELS);
const telemetryKindSet = new Set<TelemetryKind>(TELEMETRY_KINDS);

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

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

function asWindowId(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  return /^[a-z0-9-]{1,48}$/.test(normalized) ? normalized : null;
}

function resolvePayloadRecord(value: unknown, key?: string): Record<string, unknown> | null {
  const record = asObject(value);
  if (!record) return null;
  if (!key) return record;
  const nested = asObject(record[key]);
  return nested ?? record;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const values = new Set<string>();
  for (const item of value) {
    const normalized = asNonEmptyString(item);
    if (normalized) {
      values.add(normalized);
    }
  }

  return Array.from(values.values());
}

function asLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

function sanitizePluginMessages(value: unknown): Messages {
  const record = asObject(value);
  if (!record) return {};

  const messages: Messages = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key || typeof rawValue !== 'string') continue;
    messages[key] = rawValue;
  }
  return messages;
}

function getPluginI18nMessageStore(pluginId: string): Map<Locale, Messages> {
  let store = pluginI18nMessageStores.get(pluginId);
  if (!store) {
    store = new Map<Locale, Messages>();
    pluginI18nMessageStores.set(pluginId, store);
  }
  return store;
}

function listPluginI18nRegisteredLocales(pluginId: string): Locale[] {
  const store = pluginI18nMessageStores.get(pluginId);
  if (!store) return [];
  return Array.from(store.keys()).sort((left, right) => left.localeCompare(right));
}

function formatPluginMessage(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
  });
}

function resolvePluginMessageTemplate(
  pluginId: string,
  locale: Locale,
  key: string
): { template: string | null; resolvedLocale: Locale | null } {
  const store = pluginI18nMessageStores.get(pluginId);
  if (!store) {
    return {
      template: null,
      resolvedLocale: null,
    };
  }

  const primary = store.get(locale);
  if (primary && typeof primary[key] === 'string') {
    return {
      template: primary[key],
      resolvedLocale: locale,
    };
  }

  const fallback = store.get(FALLBACK_LOCALE);
  if (fallback && typeof fallback[key] === 'string') {
    return {
      template: fallback[key],
      resolvedLocale: FALLBACK_LOCALE,
    };
  }

  return {
    template: null,
    resolvedLocale: null,
  };
}

function sanitizeTelemetryText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let text = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|auth[_-]?header|cookie|access[_-]?token|refresh[_-]?token|csrf(?:[_-]?token)?|music[_-]?u)\s*[:=]\s*([^\s;]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/\bhttps?:\/\/\S*(?:qr|qrcode)\S*/gi, '[REDACTED_URL]');

  if (text.length > TELEMETRY_MAX_TEXT_LENGTH) {
    text = `${text.slice(0, TELEMETRY_MAX_TEXT_LENGTH)}...`;
  }

  return text;
}

function shouldRedactTelemetryField(key: string | null): boolean {
  if (!key) return false;
  return /token|secret|cookie|authorization|auth[_-]?header|password|credential|qrcode|qr[_-]?(url|image)|music[_-]?u|csrf/i.test(
    key
  );
}

function sanitizeTelemetryFieldValue(
  value: unknown,
  options: { key: string | null; depth: number }
): unknown {
  if (shouldRedactTelemetryField(options.key)) {
    return TELEMETRY_REDACTED_VALUE;
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeTelemetryText(value);
  }

  if (Array.isArray(value)) {
    if (options.depth >= TELEMETRY_MAX_FIELD_DEPTH) {
      return `[Array(${value.length})]`;
    }
    return value.slice(0, TELEMETRY_MAX_FIELD_ITEMS).map((entry) =>
      sanitizeTelemetryFieldValue(entry, {
        key: null,
        depth: options.depth + 1,
      })
    );
  }

  if (value && typeof value === 'object') {
    if (options.depth >= TELEMETRY_MAX_FIELD_DEPTH) {
      return '[Object]';
    }

    const sanitized: Record<string, unknown> = {};
    let count = 0;
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = entryKey.trim();
      if (!normalizedKey) continue;

      if (count >= TELEMETRY_MAX_FIELD_ITEMS) {
        sanitized.__truncated = true;
        break;
      }

      sanitized[normalizedKey] = sanitizeTelemetryFieldValue(entryValue, {
        key: normalizedKey,
        depth: options.depth + 1,
      });
      count += 1;
    }
    return sanitized;
  }

  return String(value);
}

function sanitizeTelemetryFields(value: unknown): TelemetryFields | null {
  const record = asObject(value);
  if (!record) return null;

  const fields: TelemetryFields = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key) continue;
    fields[key] = sanitizeTelemetryFieldValue(rawValue, {
      key,
      depth: 0,
    });
  }

  return Object.keys(fields).length > 0 ? fields : null;
}

function asTelemetryLevel(value: unknown): TelemetryLevel | null {
  return typeof value === 'string' && telemetryLevelSet.has(value as TelemetryLevel)
    ? (value as TelemetryLevel)
    : null;
}

function asTelemetryKind(value: unknown): TelemetryKind | null {
  return typeof value === 'string' && telemetryKindSet.has(value as TelemetryKind)
    ? (value as TelemetryKind)
    : null;
}

function buildPmpTelemetryStatus() {
  const service = getGlobalTelemetryService();
  if (!service) return null;

  const snapshot = service.getSnapshot();
  return {
    policy: {
      enabled: snapshot.policy.enabled,
      uiTailEnabled: snapshot.policy.uiTailEnabled,
      frontendMinLevel: snapshot.policy.frontendMinLevel,
      backendMinLevel: snapshot.policy.backendMinLevel,
      persistMinLevel: snapshot.policy.persistMinLevel,
      batchFlushMs: snapshot.policy.batchFlushMs,
      batchMaxItems: snapshot.policy.batchMaxItems,
    },
    status: {
      enabled: snapshot.status.enabled,
      currentSessionId: snapshot.status.currentSessionId,
      queuedRecords: snapshot.status.queuedRecords,
      flushedRecords: snapshot.status.flushedRecords,
      droppedRecords: snapshot.status.droppedRecords,
      currentFileBytes: snapshot.status.currentFileBytes,
      frontendMinLevel: snapshot.status.frontendMinLevel,
      backendMinLevel: snapshot.status.backendMinLevel,
      persistMinLevel: snapshot.status.persistMinLevel,
      lastError: snapshot.status.lastError,
    },
    transportAvailable: snapshot.transportAvailable,
    bootstrapState: snapshot.bootstrapState,
    bufferedRecords: snapshot.bufferedRecords,
    queueDroppedRecords: snapshot.queueDroppedRecords,
    tailDroppedRecords: snapshot.tailDroppedRecords,
    lastFlushAtMs: snapshot.lastFlushAtMs,
    lastBootstrapAtMs: snapshot.lastBootstrapAtMs,
  };
}

function clonePixelAnchors(anchors: readonly PixelAnchor[]): PixelAnchor[] {
  return anchors.map((anchor) => ({ ...anchor }));
}

function cloneAnchorsByMagnetId(
  anchorsByMagnetId: Record<string, readonly PixelAnchor[]>
): Record<string, PixelAnchor[]> {
  return Object.fromEntries(
    Object.entries(anchorsByMagnetId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([magnetId, anchors]) => [magnetId, clonePixelAnchors(anchors)])
  );
}

function toMagnetRendererDescriptor(renderer: MagnetRendererDefinition) {
  return {
    id: renderer.id,
    description: renderer.description,
    group: renderer.group,
    tags: renderer.tags ? [...renderer.tags] : [],
    source: renderer.source ?? 'runtime',
    hasPreview: typeof renderer.preview !== 'undefined',
    metadata: renderer.metadata ? { ...renderer.metadata } : undefined,
  };
}

function toMagnetVariantDescriptor(rendererId: string, variant: MagnetVariantDefinition) {
  return {
    rendererId,
    id: variant.id,
    label: variant.label,
    description: variant.description,
    source: variant.source ?? 'runtime',
    metadata: variant.metadata ? { ...variant.metadata } : undefined,
  };
}

function listSortedMagnetRendererDescriptors() {
  return listRegisteredMagnetRenderers()
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((renderer) => toMagnetRendererDescriptor(renderer));
}

function getShellMenuItemRequiredPermission(commandId: string): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(SHELL_MENU_ITEM_PERMISSION_BY_COMMAND_ID, commandId)
    ? SHELL_MENU_ITEM_PERMISSION_BY_COMMAND_ID[commandId]
    : undefined;
}

function listBuiltinShellMenuCommands(
  commands: NonNullable<PluginHostCapabilityInvokeRequest['context']['commands']>
): CommandContribution[] {
  return commands
    .list()
    .filter((command) => {
      const requiredPermission = getShellMenuItemRequiredPermission(command.id);
      if (typeof requiredPermission === 'undefined') return false;
      return command.source === 'builtin';
    })
    .slice()
    .sort((left, right) => {
      const leftOrder = typeof left.order === 'number' ? left.order : Number.MAX_SAFE_INTEGER;
      const rightOrder = typeof right.order === 'number' ? right.order : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.id.localeCompare(right.id);
    });
}

function getBuiltinShellMenuCommand(
  commands: NonNullable<PluginHostCapabilityInvokeRequest['context']['commands']>,
  commandId: string
): CommandContribution | null {
  const command = commands.get(commandId);
  if (!command) return null;

  const requiredPermission = getShellMenuItemRequiredPermission(command.id);
  if (typeof requiredPermission === 'undefined') return null;
  if (command.source !== 'builtin') return null;
  return command;
}

function toShellMenuItemDescriptor(command: CommandContribution, permissions: ReadonlySet<string>) {
  const requiredPermission = getShellMenuItemRequiredPermission(command.id) ?? null;
  return {
    id: command.id,
    title: command.title,
    description: command.description,
    group: command.group ?? 'general',
    order: typeof command.order === 'number' ? command.order : null,
    source: command.source ?? 'runtime',
    tags: command.tags ? [...command.tags] : [],
    requiredPermission,
    available: !requiredPermission || hasPermission(permissions, requiredPermission),
    metadata: command.metadata ? { ...command.metadata } : undefined,
  };
}

function listShellTrayItemDescriptors(permissions: ReadonlySet<string>) {
  return SHELL_TRAY_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    action: item.action,
    requiredPermission: item.requiredPermission,
    available: hasPermission(permissions, item.requiredPermission),
  }));
}

function getShellTrayItemDescriptor(itemId: string, permissions: ReadonlySet<string>) {
  const item = SHELL_TRAY_ITEMS.find((entry) => entry.id === itemId) ?? null;
  if (!item) return null;

  return {
    id: item.id,
    label: item.label,
    action: item.action,
    requiredPermission: item.requiredPermission,
    available: hasPermission(permissions, item.requiredPermission),
  };
}

function buildPluginTelemetryComponent(
  pluginId: string,
  loggerId: string,
  explicitComponent: string | null
): string {
  if (explicitComponent) {
    return `${pluginId}:${explicitComponent}`;
  }
  return `${pluginId}:${loggerId}`;
}

function asPluginDurableTextKey(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized) ? normalized : null;
}

function buildPluginDurableTextId(pluginId: string, key: string): string {
  return `${pluginId}__${key}`;
}

function sanitizeCatalogMagnet(value: unknown): Magnet | null {
  return (
    sanitizeMagnetCatalogState({
      version: 1,
      magnets: [value],
    }).magnets[0] ?? null
  );
}

function sanitizeLayoutAnchors(
  magnetId: string,
  value: unknown
): MagnetSpaceLayout['anchorsByMagnetId'][string] {
  return (
    sanitizeMagnetSpaceLayout({
      version: 1,
      activeMagnetIds: [],
      anchorsByMagnetId: {
        [magnetId]: value,
      },
    }).anchorsByMagnetId[magnetId] ?? []
  );
}

function buildLayoutWithActiveMagnetIds(
  layout: MagnetSpaceLayout,
  activeMagnetIds: string[]
): MagnetSpaceLayout {
  return sanitizeMagnetSpaceLayout({
    version: 1,
    activeMagnetIds,
    anchorsByMagnetId: layout.anchorsByMagnetId,
  });
}

function buildLayoutWithMagnetActive(
  layout: MagnetSpaceLayout,
  magnetId: string,
  active: boolean
): MagnetSpaceLayout {
  const activeMagnetIds = new Set(layout.activeMagnetIds);
  if (active) {
    activeMagnetIds.add(magnetId);
  } else {
    activeMagnetIds.delete(magnetId);
  }
  return buildLayoutWithActiveMagnetIds(layout, Array.from(activeMagnetIds));
}

function buildLayoutWithUpdatedAnchors(
  layout: MagnetSpaceLayout,
  magnetId: string,
  anchors: MagnetSpaceLayout['anchorsByMagnetId'][string]
): MagnetSpaceLayout {
  const anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {
    ...layout.anchorsByMagnetId,
  };

  if (anchors.length > 0) {
    anchorsByMagnetId[magnetId] = anchors;
  } else {
    delete anchorsByMagnetId[magnetId];
  }

  return sanitizeMagnetSpaceLayout({
    version: 1,
    activeMagnetIds: layout.activeMagnetIds,
    anchorsByMagnetId,
  });
}

type PmpMagnetLayoutSnapshot = {
  layout: MagnetSpaceLayout;
  revision: number | null;
  source: 'layout-store' | 'storage';
  didCreate: boolean;
};

async function getPmpMagnetLayoutStoreState() {
  const bootstrapped = await magnetLayoutStoreBootstrap();
  return bootstrapped?.state ?? (await magnetLayoutStoreGetState());
}

async function readPmpMagnetLayoutSnapshot(spaceId: string): Promise<PmpMagnetLayoutSnapshot> {
  if (isTauriRuntime()) {
    const store = await getPmpMagnetLayoutStoreState();
    if (store) {
      const layout = store.layoutsBySpaceId[spaceId] ?? createDefaultMagnetSpaceLayout(spaceId);
      return {
        layout: sanitizeMagnetSpaceLayout(layout),
        revision: store.revision,
        source: 'layout-store',
        didCreate: false,
      };
    }
  }

  const ensured = ensureMagnetSpaceLayout(spaceId);
  return {
    layout: ensured.layout,
    revision: null,
    source: 'storage',
    didCreate: false,
  };
}

async function ensurePmpMagnetLayoutSnapshot(
  spaceId: string
): Promise<
  | { ok: true; snapshot: PmpMagnetLayoutSnapshot }
  | { ok: false; errorResult: PluginHostCapabilityResult }
> {
  if (!isTauriRuntime()) {
    const ensured = ensureMagnetSpaceLayout(spaceId);
    return {
      ok: true,
      snapshot: {
        layout: ensured.layout,
        revision: null,
        source: 'storage',
        didCreate: ensured.didCreate,
      },
    };
  }

  const store = await getPmpMagnetLayoutStoreState();
  if (!store) {
    return {
      ok: false,
      errorResult: resultError('NOT_AVAILABLE', 'Magnet layout store is not available', {
        retryable: true,
      }),
    };
  }

  const existing = store.layoutsBySpaceId[spaceId];
  if (existing) {
    return {
      ok: true,
      snapshot: {
        layout: sanitizeMagnetSpaceLayout(existing),
        revision: store.revision,
        source: 'layout-store',
        didCreate: false,
      },
    };
  }

  const createdLayout = createDefaultMagnetSpaceLayout(spaceId);
  const applied = await applyPmpMagnetLayoutPatches({
    spaceId,
    reason: 'ensureLayout',
    patches: [{ kind: 'setSpaceLayout', spaceId, layout: createdLayout }],
    fallbackLayout: createdLayout,
  });
  if (!applied.ok) {
    return applied;
  }

  return {
    ok: true,
    snapshot: {
      ...applied.snapshot,
      didCreate: true,
    },
  };
}

async function applyPmpMagnetLayoutPatches(options: {
  spaceId: string;
  reason: string;
  patches: MagnetLayoutStorePatch[];
  fallbackLayout: MagnetSpaceLayout;
}): Promise<
  | { ok: true; snapshot: PmpMagnetLayoutSnapshot }
  | { ok: false; errorResult: PluginHostCapabilityResult }
> {
  if (isTauriRuntime()) {
    const store = await getPmpMagnetLayoutStoreState();
    if (!store) {
      return {
        ok: false,
        errorResult: resultError('NOT_AVAILABLE', 'Magnet layout store is not available', {
          retryable: true,
        }),
      };
    }

    const response = await magnetLayoutStoreApplyPatchWithRetry(
      {
        expectedRevision: store.revision,
        patches: options.patches,
        reason: options.reason,
      },
      { maxRetries: 2 }
    );

    if (!response) {
      return {
        ok: false,
        errorResult: resultError('WRITE_FAILED', 'Failed to apply magnet layout patch', {
          retryable: true,
          details: {
            spaceId: options.spaceId,
            reason: options.reason,
          },
        }),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        errorResult: resultError(
          response.error?.code ?? 'WRITE_FAILED',
          response.error?.message ?? 'Failed to apply magnet layout patch',
          {
            retryable: response.error?.code === 'revisionConflict',
            details: {
              spaceId: options.spaceId,
              reason: options.reason,
            },
          }
        ),
      };
    }

    const nextLayout =
      response.state.layoutsBySpaceId[options.spaceId] ??
      createDefaultMagnetSpaceLayout(options.spaceId);

    return {
      ok: true,
      snapshot: {
        layout: sanitizeMagnetSpaceLayout(nextLayout),
        revision: response.state.revision,
        source: 'layout-store',
        didCreate: false,
      },
    };
  }

  const nextLayout = sanitizeMagnetSpaceLayout(options.fallbackLayout);
  await broadcastDataUpdate(resolveMagnetLayoutStorageKey(options.spaceId), nextLayout);
  return {
    ok: true,
    snapshot: {
      layout: nextLayout,
      revision: null,
      source: 'storage',
      didCreate: false,
    },
  };
}

function readMethodPermissionError(
  request: PluginHostCapabilityInvokeRequest,
  permission: string
): PluginHostCapabilityResult | null {
  if (hasPermission(request.context.permissions, permission)) {
    return null;
  }

  return resultError('FORBIDDEN', `Permission denied: ${permission}`, {
    details: {
      method: request.method,
      permission,
    },
  });
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

function clonePmpHostCapabilityPackDescriptor(): PmpHostCapabilityPackDescriptor {
  return {
    ...PMP_HOST_CAPABILITY_PACK_DESCRIPTOR,
    capabilityFamilies: [...PMP_HOST_CAPABILITY_PACK_DESCRIPTOR.capabilityFamilies],
  };
}

function resolvePmpHostCapabilityFamilyId(capabilityId: string): PmpHostCapabilityFamilyId | null {
  if (!capabilityId.startsWith('host.pmp.')) {
    return null;
  }

  for (const familyId of PMP_HOST_CAPABILITY_FAMILIES) {
    if (capabilityId === familyId || capabilityId.startsWith(`${familyId}.`)) {
      return familyId;
    }
  }

  return null;
}

function listVisiblePmpHostCapabilityFamilies(
  permissions: ReadonlySet<string>
): PmpHostCapabilityFamilyId[] {
  const visibleFamilies = new Set<PmpHostCapabilityFamilyId>();
  for (const capability of listVisibleCapabilities(permissions)) {
    const familyId = resolvePmpHostCapabilityFamilyId(capability.id);
    if (!familyId) continue;
    visibleFamilies.add(familyId);
  }

  return Array.from(visibleFamilies.values()).sort((left, right) => left.localeCompare(right));
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

async function withAdapterTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
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

  const duration =
    typeof record.duration === 'number' && Number.isFinite(record.duration)
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

function recordAudioInputAdapterAuditEvent(
  event: Parameters<typeof recordInstalledExtensionAuditEvent>[0]
): void {
  try {
    recordInstalledExtensionAuditEvent(event);
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
    available.find((candidate) => candidate.providerId === audioInputAdapterDefaultProviderId) ??
    null
  );
}

function normalizeAudioInputAdapterProviderScore(score: unknown): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0.5;
  return Math.max(0, Math.min(1, score));
}

function normalizeAudioInputAdapterProviderOpenResult(value: unknown): {
  providerSessionId?: string;
  selectedInputId?: string;
  metadata?: unknown;
} {
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

        const pluginOpenSessionCount = countPluginAudioInputAdapterSessions(
          request.context.pluginId
        );
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
            return resultError(
              'NOT_FOUND',
              `Unknown audio input adapter provider: ${requestedProviderId}`
            );
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
                asNonEmptyString(probeResult.inputId) ?? preferredInputId ?? provider.providerId;
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

        const pluginOpenSessionCount = countPluginAudioInputAdapterSessions(
          request.context.pluginId
        );
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
            return resultError(
              'NOT_FOUND',
              `Unknown audio input adapter provider: ${requestedProviderId}`
            );
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
        const closeReason = asNonEmptyString(payload?.reason) ?? 'requested';
        const bestEffortClose =
          closeReason === 'runtime-dispose' ||
          closeReason === 'runtime-crash' ||
          closeReason === 'runtime-unresponsive' ||
          closeReason === 'runtime-command-finished';
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
              if (!bestEffortClose) {
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
          reason: closeReason,
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

        if (requestedCapability && !isAiAdapterProviderCapability(requestedCapability)) {
          return resultError(
            'INVALID_PAYLOAD',
            `payload.capability must be one of: ${Array.from(AI_ADAPTER_PROVIDER_CAPABILITIES).join(
              ', '
            )}`
          );
        }

        const capabilityFilter =
          requestedCapability && isAiAdapterProviderCapability(requestedCapability)
            ? requestedCapability
            : null;

        const providers = listAiAdapterProviderInfos().filter((provider) =>
          capabilityFilter ? provider.capabilities.includes(capabilityFilter) : true
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
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported AI adapter method: ${request.method}`
        );
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

function createPmpNavigationHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:navigation');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const navigation = request.context.navigation;
    if (!navigation) {
      return resultError('NOT_AVAILABLE', 'Navigation bridge is not available');
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_NAVIGATION_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-host-navigation',
          methods: ['describe', 'getSnapshot', 'canGoBack', 'navigateTo', 'goBack'],
        });
      case 'getSnapshot':
        return resultOk(
          typeof navigation.getSnapshot === 'function' ? (navigation.getSnapshot() ?? null) : null
        );
      case 'canGoBack': {
        const snapshot =
          typeof navigation.getSnapshot === 'function' ? (navigation.getSnapshot() ?? null) : null;
        return resultOk({
          canGoBack: Boolean(
            snapshot &&
              typeof snapshot === 'object' &&
              typeof snapshot.currentIndex === 'number' &&
              snapshot.currentIndex > 0
          ),
        });
      }
      case 'navigateTo': {
        const payload = asObject(request.payload);
        const page = asNonEmptyString(payload?.page);
        if (!page) {
          return resultError('INVALID_PAYLOAD', 'payload.page is required');
        }
        if (
          typeof payload?.params !== 'undefined' &&
          payload.params !== null &&
          !asObject(payload.params)
        ) {
          return resultError('INVALID_PAYLOAD', 'payload.params must be an object when provided');
        }

        const params = asObject(payload?.params) ?? undefined;
        const nextParams =
          (page === 'plugin-page' || page === 'plugin-visualizer') &&
          request.context.sourceKind &&
          params
            ? ({ ...params, sourceKind: request.context.sourceKind } as Record<string, unknown>)
            : params;

        navigation.navigateTo(page as never, nextParams as never);
        return resultOk({
          capabilityId: HOST_PMP_NAVIGATION_CAPABILITY_ID,
          page,
          navigated: true,
        });
      }
      case 'goBack':
        navigation.goBack();
        return resultOk({
          capabilityId: HOST_PMP_NAVIGATION_CAPABILITY_ID,
          wentBack: true,
        });
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported navigation method: ${request.method}`
        );
    }
  };
}

function createPmpWindowHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:window');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const windowApi = request.context.windowApi;
    if (!windowApi) {
      return resultError('NOT_AVAILABLE', 'Window bridge is not available');
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_WINDOW_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-host-window-shell',
          methods: ['describe', 'open', 'close'],
        });
      case 'open': {
        const payload = asObject(request.payload);
        const windowId = asWindowId(payload?.windowId);
        if (!windowId) {
          return resultError('INVALID_PAYLOAD', 'payload.windowId is required');
        }
        if (
          typeof payload?.options !== 'undefined' &&
          payload.options !== null &&
          !asObject(payload.options)
        ) {
          return resultError('INVALID_PAYLOAD', 'payload.options must be an object when provided');
        }

        await windowApi.open(windowId, (asObject(payload?.options) ?? undefined) as never);
        return resultOk({
          capabilityId: HOST_PMP_WINDOW_CAPABILITY_ID,
          opened: true,
          windowId,
        });
      }
      case 'close': {
        const payload = asObject(request.payload);
        const windowId = asWindowId(payload?.windowId);
        if (!windowId) {
          return resultError('INVALID_PAYLOAD', 'payload.windowId is required');
        }

        await windowApi.close(windowId);
        return resultOk({
          capabilityId: HOST_PMP_WINDOW_CAPABILITY_ID,
          closed: true,
          windowId,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported shell.window method: ${request.method}`
        );
    }
  };
}

function createPmpShellMenuHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:host');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const commands = request.context.commands;
    if (!commands) {
      return resultError('NOT_AVAILABLE', 'Shell menu command service is not available', {
        retryable: true,
      });
    }

    const items = listBuiltinShellMenuCommands(commands).map((command) =>
      toShellMenuItemDescriptor(command, request.context.permissions)
    );

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_SHELL_MENU_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'builtin-command-catalog',
          methods: ['describe', 'listItems', 'getItem', 'activateItem'],
          itemCount: items.length,
          availableItemCount: items.filter((item) => item.available).length,
          groups: Array.from(new Set(items.map((item) => item.group))).sort((left, right) =>
            left.localeCompare(right)
          ),
        });
      case 'listItems': {
        const payload = asObject(request.payload);
        const group = asNonEmptyString(payload?.group);
        const availableOnly = payload?.availableOnly === true;
        const filtered = items.filter((item) => {
          if (group && item.group !== group) return false;
          if (availableOnly && !item.available) return false;
          return true;
        });

        return resultOk({
          itemCount: filtered.length,
          items: filtered,
        });
      }
      case 'getItem': {
        const payload = asObject(request.payload);
        const itemId = asNonEmptyString(payload?.itemId ?? payload?.id);
        if (!itemId) {
          return resultError('INVALID_PAYLOAD', 'payload.itemId is required');
        }

        const command = getBuiltinShellMenuCommand(commands, itemId);
        const item = command
          ? toShellMenuItemDescriptor(command, request.context.permissions)
          : null;

        return resultOk({
          itemId,
          found: item !== null,
          item,
        });
      }
      case 'activateItem': {
        const payload = asObject(request.payload);
        const itemId = asNonEmptyString(payload?.itemId ?? payload?.id);
        if (!itemId) {
          return resultError('INVALID_PAYLOAD', 'payload.itemId is required');
        }

        const command = getBuiltinShellMenuCommand(commands, itemId);
        if (!command) {
          return resultError('NOT_FOUND', `Unknown shell menu item: ${itemId}`);
        }

        const requiredPermission = getShellMenuItemRequiredPermission(command.id) ?? null;
        if (requiredPermission && !hasPermission(request.context.permissions, requiredPermission)) {
          return resultError('FORBIDDEN', `Permission denied: ${requiredPermission}`, {
            details: {
              itemId,
              requiredPermission,
            },
          });
        }

        try {
          await commands.dispatch(command.id, payload?.args);
        } catch (error) {
          return resultError('COMMAND_FAILED', toErrorMessage(error), {
            details: {
              itemId,
            },
          });
        }

        return resultOk({
          itemId,
          activated: true,
          requiredPermission,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported shell.menu method: ${request.method}`
        );
    }
  };
}

function createPmpShellContextMenuHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:host');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_SHELL_CONTEXT_MENU_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-react-context-menu-surface',
          methods: ['describe', 'getSchema'],
          ...SHELL_CONTEXT_MENU_SURFACE_SCHEMA,
        });
      case 'getSchema':
        return resultOk({
          ...SHELL_CONTEXT_MENU_SURFACE_SCHEMA,
        });
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported shell.context-menu method: ${request.method}`
        );
    }
  };
}

function createPmpShellTrayHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:host');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const trayApi = request.context.trayApi;
    if (!trayApi) {
      return resultError('NOT_AVAILABLE', 'Shell tray bridge is not available', {
        retryable: true,
      });
    }

    const items = listShellTrayItemDescriptors(request.context.permissions);

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_SHELL_TRAY_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'tauri-system-tray-bridge',
          methods: ['describe', 'getState', 'listItems', 'activateItem'],
          supported: trayApi.supported,
          primaryActionId: SHELL_TRAY_PRIMARY_ACTION_ID,
          itemCount: items.length,
          availableItemCount: items.filter((item) => item.available).length,
        });
      case 'getState': {
        const mainWindowVisible = await Promise.resolve(trayApi.getMainWindowVisible());
        return resultOk({
          supported: trayApi.supported,
          primaryActionId: SHELL_TRAY_PRIMARY_ACTION_ID,
          mainWindowVisible,
          itemCount: items.length,
          items,
        });
      }
      case 'listItems':
        return resultOk({
          supported: trayApi.supported,
          primaryActionId: SHELL_TRAY_PRIMARY_ACTION_ID,
          itemCount: items.length,
          items,
        });
      case 'activateItem': {
        const payload = asObject(request.payload);
        const itemId = asNonEmptyString(payload?.itemId ?? payload?.id);
        if (!itemId) {
          return resultError('INVALID_PAYLOAD', 'payload.itemId is required');
        }

        const requestedDescriptor =
          itemId === SHELL_TRAY_PRIMARY_ACTION_ID
            ? {
                id: SHELL_TRAY_PRIMARY_ACTION_ID,
                label: 'Toggle Main Window',
                action: 'toggle-main-window',
                requiredPermission: 'api:window',
                available: hasPermission(request.context.permissions, 'api:window'),
              }
            : getShellTrayItemDescriptor(itemId, request.context.permissions);

        if (!requestedDescriptor) {
          return resultError('NOT_FOUND', `Unknown shell tray item: ${itemId}`);
        }

        if (!hasPermission(request.context.permissions, requestedDescriptor.requiredPermission)) {
          return resultError(
            'FORBIDDEN',
            `Permission denied: ${requestedDescriptor.requiredPermission}`,
            {
              details: {
                itemId,
                requiredPermission: requestedDescriptor.requiredPermission,
              },
            }
          );
        }

        if (!trayApi.supported) {
          return resultError('NOT_AVAILABLE', 'System tray is not available', {
            retryable: true,
          });
        }

        try {
          await trayApi.activateItem(itemId);
        } catch (error) {
          return resultError('TRAY_ACTION_FAILED', toErrorMessage(error), {
            details: {
              itemId,
            },
          });
        }

        return resultOk({
          itemId,
          activated: true,
          mainWindowVisible: await Promise.resolve(trayApi.getMainWindowVisible()),
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported shell.tray method: ${request.method}`
        );
    }
  };
}

function createPmpShellStatusItemHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:host');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_SHELL_STATUS_ITEM_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'host-shell-status-item-placeholder',
          methods: ['describe', 'listSlots'],
          ...SHELL_STATUS_ITEM_SLOT_SNAPSHOT,
        });
      case 'listSlots':
        return resultOk({
          ...SHELL_STATUS_ITEM_SLOT_SNAPSHOT,
        });
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported shell.status-item method: ${request.method}`
        );
    }
  };
}

function buildPmpStorageSyncSnapshot(pluginId: string, config: Record<string, unknown>) {
  return {
    config,
    syncState: readExtensionConfigSyncState(pluginId),
  };
}

function createPmpStorageConfigHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'storage:local');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const configApi = request.context.configApi;
    if (!configApi) {
      return resultError('NOT_AVAILABLE', 'Config bridge is not available');
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_STORAGE_CONFIG_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-plugin-config',
          methods: ['describe', 'get', 'set', 'patch', 'reset'],
        });
      case 'get':
        return resultOk(configApi.get());
      case 'set': {
        const next = resolvePayloadRecord(request.payload, 'value');
        if (!next) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }
        configApi.set(next);
        return resultOk(configApi.get());
      }
      case 'patch': {
        const patch = resolvePayloadRecord(request.payload, 'value');
        if (!patch) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }
        configApi.patch(patch);
        return resultOk(configApi.get());
      }
      case 'reset':
        configApi.reset();
        return resultOk(configApi.get());
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported storage.config method: ${request.method}`
        );
    }
  };
}

function createPmpStorageSyncHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'storage:local');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const configApi = request.context.configApi;
    if (!configApi) {
      return resultError('NOT_AVAILABLE', 'Config bridge is not available');
    }

    const pluginId = request.context.pluginId;

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_STORAGE_SYNC_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'plugin-config-sync-snapshot',
          methods: [
            'describe',
            'readConfig',
            'writeConfig',
            'patchConfig',
            'removeConfig',
            'getSyncState',
          ],
          subscriptionMode: 'revision-poll',
          scope: 'plugin-config',
        });
      case 'readConfig':
        return resultOk(buildPmpStorageSyncSnapshot(pluginId, configApi.get()));
      case 'getSyncState':
        return resultOk({
          syncState: readExtensionConfigSyncState(pluginId),
        });
      case 'writeConfig': {
        const next = resolvePayloadRecord(request.payload, 'value');
        if (!next) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        configApi.set(next);
        return resultOk(buildPmpStorageSyncSnapshot(pluginId, configApi.get()));
      }
      case 'patchConfig': {
        const patch = resolvePayloadRecord(request.payload, 'value');
        if (!patch) {
          return resultError('INVALID_PAYLOAD', 'payload must be an object');
        }

        configApi.patch(patch);
        return resultOk(buildPmpStorageSyncSnapshot(pluginId, configApi.get()));
      }
      case 'removeConfig':
        configApi.reset();
        return resultOk(buildPmpStorageSyncSnapshot(pluginId, configApi.get()));
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported storage.sync method: ${request.method}`
        );
    }
  };
}

function createPmpStorageDurableTextHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'storage:durable-text');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_STORAGE_DURABLE_TEXT_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'plugin-scoped-durable-text',
          methods: ['describe', 'read', 'write', 'remove'],
          keyPattern: '^[a-z0-9][a-z0-9._-]{0,127}$',
        });
      case 'read': {
        const payload = asObject(request.payload);
        const key = asPluginDurableTextKey(payload?.key);
        if (!key) {
          return resultError('INVALID_PAYLOAD', 'payload.key is required');
        }

        const value = await readDurableText(
          'plugin-data',
          buildPluginDurableTextId(request.context.pluginId, key)
        );
        return resultOk({ key, value });
      }
      case 'write': {
        const payload = asObject(request.payload);
        const key = asPluginDurableTextKey(payload?.key);
        const value = typeof payload?.value === 'string' ? payload.value : null;
        if (!key) {
          return resultError('INVALID_PAYLOAD', 'payload.key is required');
        }
        if (value === null) {
          return resultError('INVALID_PAYLOAD', 'payload.value must be a string');
        }

        const ok = await writeDurableText(
          'plugin-data',
          buildPluginDurableTextId(request.context.pluginId, key),
          value
        );
        if (!ok) {
          return resultError('WRITE_FAILED', 'Failed to persist durable text', {
            retryable: true,
            details: { key },
          });
        }

        return resultOk({ key, written: true });
      }
      case 'remove': {
        const payload = asObject(request.payload);
        const key = asPluginDurableTextKey(payload?.key);
        if (!key) {
          return resultError('INVALID_PAYLOAD', 'payload.key is required');
        }

        await removeDurableText(
          'plugin-data',
          buildPluginDurableTextId(request.context.pluginId, key)
        );
        return resultOk({ key, removed: true });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported storage.durable-text method: ${request.method}`
        );
    }
  };
}

function createPmpMagnetsCatalogHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:magnets-catalog');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MAGNETS_CATALOG_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'magnets-domain-catalog',
          methods: ['describe', 'list', 'get', 'upsert', 'remove'],
          writePolicy: {
            builtinIdsReadonly: true,
          },
        });
      case 'list': {
        const ensured = ensureMagnetCatalogState();
        return resultOk({
          didCreate: ensured.didCreate,
          magnetCount: ensured.state.magnets.length,
          magnets: ensured.state.magnets,
        });
      }
      case 'get': {
        const payload = asObject(request.payload);
        const magnetId = asNonEmptyString(payload?.magnetId ?? payload?.id);
        if (!magnetId) {
          return resultError('INVALID_PAYLOAD', 'payload.magnetId is required');
        }

        const magnet =
          readMagnetCatalogState().magnets.find((entry) => entry.id === magnetId) ?? null;
        return resultOk({
          magnetId,
          found: magnet !== null,
          magnet,
        });
      }
      case 'upsert': {
        const magnetPayload = resolvePayloadRecord(request.payload, 'magnet');
        const requestedMagnetId = asNonEmptyString(magnetPayload?.id);
        if (!magnetPayload) {
          return resultError('INVALID_PAYLOAD', 'payload.magnet must be an object');
        }
        if (requestedMagnetId && BUILTIN_MAGNET_IDS.has(requestedMagnetId)) {
          return resultError('FORBIDDEN', 'Built-in magnet ids are host-managed');
        }

        const magnet = sanitizeCatalogMagnet(magnetPayload);
        if (!magnet) {
          return resultError('INVALID_PAYLOAD', 'payload.magnet must be a valid custom magnet');
        }

        const next = upsertMagnetCatalogMagnet(magnet);
        return resultOk({
          magnetId: magnet.id,
          magnet,
          magnetCount: next.magnets.length,
          state: next,
        });
      }
      case 'remove': {
        const payload = asObject(request.payload);
        const magnetId = asNonEmptyString(payload?.magnetId ?? payload?.id);
        if (!magnetId) {
          return resultError('INVALID_PAYLOAD', 'payload.magnetId is required');
        }

        const before = readMagnetCatalogState();
        const next = removeMagnetCatalogMagnet(magnetId);
        return resultOk({
          magnetId,
          removed: next.magnets.length < before.magnets.length,
          magnetCount: next.magnets.length,
          state: next,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported magnets.catalog method: ${request.method}`
        );
    }
  };
}

function createPmpMagnetsLayoutHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:magnets-layout');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MAGNETS_LAYOUT_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'magnets-domain-layout',
          methods: [
            'describe',
            'getLayout',
            'ensureLayout',
            'setLayout',
            'setActiveMagnetIds',
            'setMagnetActive',
            'updateMagnetAnchors',
          ],
          runtime: {
            tauri: 'layout-store',
            web: 'storage-key',
          },
        });
      case 'getLayout': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }

        const snapshot = await readPmpMagnetLayoutSnapshot(spaceId);
        return resultOk({
          spaceId,
          layout: snapshot.layout,
          revision: snapshot.revision,
          source: snapshot.source,
        });
      }
      case 'ensureLayout': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }

        const ensured = await ensurePmpMagnetLayoutSnapshot(spaceId);
        if (!ensured.ok) {
          return ensured.errorResult;
        }

        return resultOk({
          spaceId,
          didCreate: ensured.snapshot.didCreate,
          layout: ensured.snapshot.layout,
          revision: ensured.snapshot.revision,
          source: ensured.snapshot.source,
        });
      }
      case 'setLayout': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        const layoutPayload = asObject(payload?.layout);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }
        if (!layoutPayload) {
          return resultError('INVALID_PAYLOAD', 'payload.layout must be an object');
        }

        const nextLayout = sanitizeMagnetSpaceLayout(layoutPayload);
        const applied = await applyPmpMagnetLayoutPatches({
          spaceId,
          reason: 'setLayout',
          patches: [{ kind: 'setSpaceLayout', spaceId, layout: nextLayout }],
          fallbackLayout: nextLayout,
        });
        if (!applied.ok) {
          return applied.errorResult;
        }

        return resultOk({
          spaceId,
          layout: applied.snapshot.layout,
          revision: applied.snapshot.revision,
          source: applied.snapshot.source,
        });
      }
      case 'setActiveMagnetIds': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }
        if (!Array.isArray(payload?.activeMagnetIds)) {
          return resultError('INVALID_PAYLOAD', 'payload.activeMagnetIds must be an array');
        }

        const current = await readPmpMagnetLayoutSnapshot(spaceId);
        const nextLayout = buildLayoutWithActiveMagnetIds(
          current.layout,
          asStringArray(payload.activeMagnetIds)
        );
        const applied = await applyPmpMagnetLayoutPatches({
          spaceId,
          reason: 'setActiveMagnetIds',
          patches: [
            {
              kind: 'setActiveMagnetIds',
              spaceId,
              activeMagnetIds: nextLayout.activeMagnetIds,
            },
          ],
          fallbackLayout: nextLayout,
        });
        if (!applied.ok) {
          return applied.errorResult;
        }

        return resultOk({
          spaceId,
          layout: applied.snapshot.layout,
          revision: applied.snapshot.revision,
          source: applied.snapshot.source,
        });
      }
      case 'setMagnetActive': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        const magnetId = asNonEmptyString(payload?.magnetId);
        const active = asBoolean(payload?.active);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }
        if (!magnetId) {
          return resultError('INVALID_PAYLOAD', 'payload.magnetId is required');
        }
        if (active === null) {
          return resultError('INVALID_PAYLOAD', 'payload.active must be a boolean');
        }

        const current = await readPmpMagnetLayoutSnapshot(spaceId);
        const nextLayout = buildLayoutWithMagnetActive(current.layout, magnetId, active);
        const applied = await applyPmpMagnetLayoutPatches({
          spaceId,
          reason: 'setMagnetActive',
          patches: [{ kind: 'setMagnetActive', spaceId, magnetId, active }],
          fallbackLayout: nextLayout,
        });
        if (!applied.ok) {
          return applied.errorResult;
        }

        return resultOk({
          spaceId,
          magnetId,
          active,
          layout: applied.snapshot.layout,
          revision: applied.snapshot.revision,
          source: applied.snapshot.source,
        });
      }
      case 'updateMagnetAnchors': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        const magnetId = asNonEmptyString(payload?.magnetId);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }
        if (!magnetId) {
          return resultError('INVALID_PAYLOAD', 'payload.magnetId is required');
        }
        if (!Array.isArray(payload?.anchors)) {
          return resultError('INVALID_PAYLOAD', 'payload.anchors must be an array');
        }

        const anchors = sanitizeLayoutAnchors(magnetId, payload.anchors);
        const current = await readPmpMagnetLayoutSnapshot(spaceId);
        const nextLayout = buildLayoutWithUpdatedAnchors(current.layout, magnetId, anchors);
        const applied = await applyPmpMagnetLayoutPatches({
          spaceId,
          reason: 'updateMagnetAnchors',
          patches: [{ kind: 'updateMagnetAnchors', spaceId, magnetId, anchors }],
          fallbackLayout: nextLayout,
        });
        if (!applied.ok) {
          return applied.errorResult;
        }

        return resultOk({
          spaceId,
          magnetId,
          anchors,
          layout: applied.snapshot.layout,
          revision: applied.snapshot.revision,
          source: applied.snapshot.source,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported magnets.layout method: ${request.method}`
        );
    }
  };
}

function createPmpMagnetsRendererHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:host');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe': {
        const renderers = listSortedMagnetRendererDescriptors();
        const variantRendererCount = renderers.filter(
          (renderer) => listMagnetVariants(renderer.id).length > 0
        ).length;
        const variantCount = renderers.reduce(
          (count, renderer) => count + listMagnetVariants(renderer.id).length,
          0
        );

        return resultOk({
          capabilityId: HOST_PMP_MAGNETS_RENDERER_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'renderer-registry-variant-registry-system-layouts',
          methods: [
            'describe',
            'listRenderers',
            'getRenderer',
            'listVariants',
            'getSystemLayoutRules',
          ],
          rendererCount: renderers.length,
          variantRendererCount,
          variantCount,
          systemSpaces: ['space1', 'space2'],
          fallbackScope: 'required',
        });
      }
      case 'listRenderers': {
        const renderers = listSortedMagnetRendererDescriptors();
        return resultOk({
          rendererCount: renderers.length,
          renderers,
        });
      }
      case 'getRenderer': {
        const payload = asObject(request.payload);
        const rendererId = asNonEmptyString(payload?.rendererId ?? payload?.id);
        if (!rendererId) {
          return resultError('INVALID_PAYLOAD', 'payload.rendererId is required');
        }

        const renderer = getMagnetRenderer(rendererId);
        const variants = renderer
          ? listMagnetVariants(rendererId)
              .slice()
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((variant) => toMagnetVariantDescriptor(rendererId, variant))
          : [];

        return resultOk({
          rendererId,
          found: renderer !== null,
          renderer: renderer ? toMagnetRendererDescriptor(renderer) : null,
          variantCount: variants.length,
          variants,
        });
      }
      case 'listVariants': {
        const payload = asObject(request.payload);
        const rendererId = asNonEmptyString(payload?.rendererId ?? payload?.id);

        if (rendererId) {
          const variants = listMagnetVariants(rendererId)
            .slice()
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((variant) => toMagnetVariantDescriptor(rendererId, variant));

          return resultOk({
            rendererId,
            variantCount: variants.length,
            variants,
          });
        }

        const variantsByRenderer = listSortedMagnetRendererDescriptors()
          .map((renderer) => {
            const variants = listMagnetVariants(renderer.id)
              .slice()
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((variant) => toMagnetVariantDescriptor(renderer.id, variant));

            return {
              rendererId: renderer.id,
              variantCount: variants.length,
              variants,
            };
          })
          .filter((entry) => entry.variantCount > 0);

        return resultOk({
          rendererCount: variantsByRenderer.length,
          variantCount: variantsByRenderer.reduce((count, entry) => count + entry.variantCount, 0),
          variantsByRenderer,
        });
      }
      case 'getSystemLayoutRules': {
        const payload = asObject(request.payload);
        const spaceId = asNonEmptyString(payload?.spaceId);
        if (!spaceId) {
          return resultError('INVALID_PAYLOAD', 'payload.spaceId is required');
        }

        const normalizedSpaceId = spaceId.trim();
        const knownSpace =
          normalizedSpaceId === 'space1' || normalizedSpaceId === 'space2'
            ? normalizedSpaceId
            : null;
        const requiredAnchorsByMagnetId = cloneAnchorsByMagnetId(
          SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID
        );
        const defaultAnchorsByMagnetId = cloneAnchorsByMagnetId(
          getSystemAnchorsByMagnetId(normalizedSpaceId)
        );

        return resultOk({
          spaceId: normalizedSpaceId,
          resolvedSpaceId: knownSpace ?? 'required',
          usesFallbackRules: knownSpace === null,
          requiredMagnetIds: Object.keys(requiredAnchorsByMagnetId),
          defaultMagnetIds: Object.keys(defaultAnchorsByMagnetId),
          requiredAnchorsByMagnetId,
          defaultAnchorsByMagnetId,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported magnets.renderer method: ${request.method}`
        );
    }
  };
}

function createPmpMusicPlatformCatalogHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:music-platform-catalog');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MUSIC_PLATFORM_CATALOG_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'platform-facade',
          methods: ['describe', 'listConnectors'],
        });
      case 'listConnectors': {
        const connectors = await listPlatformConnectorFacadeItems();
        return resultOk({
          connectorCount: connectors.length,
          connectors,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported music-platform.catalog method: ${request.method}`
        );
    }
  };
}

function createPmpMusicPlatformWorkspaceHandler(): PluginHostCapabilityHandler {
  type WorkspaceTarget = {
    connectorId: `connector.platform.${string}`;
    instanceId?: string;
  };

  const readWorkspaceTarget = (
    payload: Record<string, unknown> | null
  ): WorkspaceTarget | PluginHostCapabilityResult => {
    const connectorId = asNonEmptyString(payload?.connectorId);
    if (!connectorId || !connectorId.startsWith('connector.platform.')) {
      return resultError('INVALID_PAYLOAD', 'payload.connectorId is required');
    }

    return {
      connectorId: connectorId as WorkspaceTarget['connectorId'],
      instanceId:
        asNonEmptyString(payload?.instanceId) ??
        resolvePlatformInstanceId({
          connectorId: connectorId as WorkspaceTarget['connectorId'],
        }) ??
        undefined,
    };
  };

  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:music-platform-workspace');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const payload = asObject(request.payload);

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'platform-workspace-facade',
          methods: [
            'describe',
            'getWorkspaceModel',
            'listPages',
            'listCollections',
            'listCollectionResources',
            'listRecommendedCollections',
            'listRecommendedResources',
            'searchResources',
            'preparePlayback',
            'listQualityState',
            'setQualityPreference',
            'resolveCoverAssetUrl',
          ],
        });
      case 'getWorkspaceModel': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const model = await getPlatformWorkspacePageModel(target);
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          model,
        });
      }
      case 'listPages': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const items = await listPlatformWorkspacePages(target);
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          items,
        });
      }
      case 'listCollections': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const items = await listPlatformWorkspaceCollections({
          ...target,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          items,
        });
      }
      case 'listCollectionResources': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const collectionId =
          asNonEmptyString(payload?.collectionId) ??
          asNonEmptyString(payload?.playlistId);
        if (!collectionId) {
          return resultError('INVALID_PAYLOAD', 'payload.collectionId is required');
        }
        const page = await listPlatformWorkspaceCollectionResources({
          ...target,
          collectionId,
          pageNum: asNonNegativeInt(payload?.pageNum) ?? undefined,
          pageSize: asNonNegativeInt(payload?.pageSize) ?? undefined,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          collectionId,
          page,
        });
      }
      case 'listRecommendedCollections': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const items = await listPlatformWorkspaceRecommendedCollections({
          ...target,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          items,
        });
      }
      case 'listRecommendedResources': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const page = await listPlatformWorkspaceRecommendedResources({
          ...target,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          page,
        });
      }
      case 'searchResources': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const query =
          asNonEmptyString(payload?.query) ?? asNonEmptyString(payload?.keyword);
        if (!query) {
          return resultError('INVALID_PAYLOAD', 'payload.query is required');
        }
        const page = await searchPlatformWorkspaceResources({
          ...target,
          keyword: query,
          pageNum: asNonNegativeInt(payload?.pageNum) ?? undefined,
          pageSize: asNonNegativeInt(payload?.pageSize) ?? undefined,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          query,
          page,
        });
      }
      case 'preparePlayback': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const sourceLocator = asNonEmptyString(payload?.sourceLocator);
        if (!sourceLocator) {
          return resultError('INVALID_PAYLOAD', 'payload.sourceLocator is required');
        }
        const prepared = await preparePlatformWorkspacePlayback({
          ...target,
          sourceLocator,
          qualityHint: asNonEmptyString(payload?.qualityHint) ?? undefined,
          resourceId: asNonEmptyString(payload?.resourceId) ?? undefined,
          webUrl: asNonEmptyString(payload?.webUrl) ?? undefined,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          prepared,
        });
      }
      case 'listQualityState': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const state = await listPlatformWorkspaceQualityState({
          ...target,
          sourceLocator: asNonEmptyString(payload?.sourceLocator) ?? undefined,
          forceRefresh: payload?.forceRefresh === true,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          state,
        });
      }
      case 'setQualityPreference': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const qualityKey =
          asNonEmptyString(payload?.qualityKey) ??
          asNonEmptyString(payload?.key) ??
          asNonEmptyString(payload?.qualityHint);
        if (!qualityKey) {
          return resultError('INVALID_PAYLOAD', 'payload.qualityKey is required');
        }
        const state = await setPlatformWorkspaceQualityPreference({
          ...target,
          qualityKey,
          sourceLocator: asNonEmptyString(payload?.sourceLocator) ?? undefined,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          state,
        });
      }
      case 'resolveCoverAssetUrl': {
        const target = readWorkspaceTarget(payload);
        if ('ok' in target) {
          return target;
        }
        const coverUrl = asNonEmptyString(payload?.coverUrl);
        if (!coverUrl) {
          return resultError('INVALID_PAYLOAD', 'payload.coverUrl is required');
        }
        const assetUrl = await resolvePlatformWorkspaceCoverAssetUrl({
          ...target,
          coverUrl,
        });
        return resultOk({
          connectorId: target.connectorId,
          instanceId: target.instanceId ?? null,
          coverUrl,
          assetUrl: assetUrl ?? null,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported music-platform.workspace method: ${request.method}`
        );
    }
  };
}

function createPmpMusicPlatformSearchHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:music-platform-search');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MUSIC_PLATFORM_SEARCH_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'platform-facade',
          methods: ['describe', 'searchTracks'],
        });
      case 'searchTracks': {
        const payload = asObject(request.payload);
        const query = asNonEmptyString(payload?.query);
        if (!query) {
          return resultError('INVALID_PAYLOAD', 'payload.query is required');
        }

        const limit = asNonNegativeInt(payload?.limit) ?? undefined;
        const connectorIds = asStringArray(payload?.connectorIds);
        const result = await searchPlatformTracks({
          query,
          limit,
          connectorIds,
        });

        return resultOk({
          query,
          connectorCount: result.connectorViews.length,
          trackCount: result.tracks.length,
          ...result,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported music-platform.search method: ${request.method}`
        );
    }
  };
}

function createPmpMusicPlatformPrepareHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:music-platform-prepare');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_MUSIC_PLATFORM_PREPARE_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'platform-facade',
          methods: ['describe', 'preparePlayback'],
          supportedConnectorIds: listPlatformConnectorDefinitions().map(
            (definition) => definition.connectorId
          ),
        });
      case 'preparePlayback': {
        const payload = asObject(request.payload);
        const sourceLocator = asNonEmptyString(payload?.sourceLocator);
        if (!sourceLocator) {
          return resultError('INVALID_PAYLOAD', 'payload.sourceLocator is required');
        }

        const prepared = await preparePlatformPlayback({
          sourceLocator,
          connectorId: asNonEmptyString(payload?.connectorId) ?? undefined,
          qualityHint: asNonEmptyString(payload?.qualityHint) ?? undefined,
          instanceId: asNonEmptyString(payload?.instanceId) ?? undefined,
        });
        if (!prepared) {
          return resultError(
            'NOT_FOUND',
            'Unable to prepare platform playback',
            {
              details: {
                sourceLocator,
                connectorId: asNonEmptyString(payload?.connectorId) ?? undefined,
                instanceId: asNonEmptyString(payload?.instanceId) ?? undefined,
              },
            }
          );
        }
        return resultOk(prepared);
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported music-platform.prepare method: ${request.method}`
        );
    }
  };
}

function createPmpConnectorAuthHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:connector-auth');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_CONNECTOR_AUTH_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'platform-connector-auth',
          methods: [
            'describe',
            'listDefinitions',
            'listAuthSnapshots',
            'getAuthSnapshot',
            'beginQrLogin',
            'pollQrLogin',
            'logout',
            'clearAuthCookies',
          ],
        });
      case 'listDefinitions':
        return resultOk({
          definitions: listPlatformConnectorDefinitions(),
        });
      case 'listAuthSnapshots': {
        const payload = asObject(request.payload);
        const forceRefresh =
          payload?.refresh === true || payload?.forceRefresh === true;
        return resultOk({
          snapshots: await listPlatformInstanceAuthSnapshots({
            refresh: forceRefresh,
          }),
        });
      }
      case 'getAuthSnapshot': {
        const payload = asObject(request.payload);
        const connectorId = asNonEmptyString(payload?.connectorId);
        const instanceId = resolvePlatformInstanceId({
          instanceId: asNonEmptyString(payload?.instanceId),
          connectorId,
        });
        const forceRefresh =
          payload?.refresh === true || payload?.forceRefresh === true;
        if (!instanceId) {
          return resultError('INVALID_PAYLOAD', 'payload.instanceId or payload.connectorId is required');
        }
        const cachedSnapshot = getPlatformInstanceAuthSnapshot(instanceId);
        const snapshot = forceRefresh
          ? (await refreshPlatformInstanceAuthSnapshot(instanceId)) ?? cachedSnapshot
          : cachedSnapshot ?? (await refreshPlatformInstanceAuthSnapshot(instanceId));
        return resultOk({
          connectorId,
          instanceId,
          snapshot,
        });
      }
      case 'beginQrLogin': {
        const payload = asObject(request.payload);
        const connectorId = asNonEmptyString(payload?.connectorId);
        const instanceId = resolvePlatformInstanceId({
          instanceId: asNonEmptyString(payload?.instanceId),
          connectorId,
        });
        if (!instanceId) {
          return resultError('INVALID_PAYLOAD', 'payload.instanceId or payload.connectorId is required');
        }
        const session = await beginPlatformInstanceQrLogin(instanceId);
        return resultOk({
          connectorId: connectorId ?? session?.connectorId,
          instanceId,
          session,
        });
      }
      case 'pollQrLogin': {
        const payload = asObject(request.payload);
        const connectorId = asNonEmptyString(payload?.connectorId);
        const instanceId = resolvePlatformInstanceId({
          instanceId: asNonEmptyString(payload?.instanceId),
          connectorId,
        });
        const sessionId = asNonEmptyString(payload?.sessionId);
        if (!instanceId) {
          return resultError('INVALID_PAYLOAD', 'payload.instanceId or payload.connectorId is required');
        }
        if (!sessionId) {
          return resultError('INVALID_PAYLOAD', 'payload.sessionId is required');
        }
        const result = await pollPlatformInstanceQrLogin(instanceId, sessionId);
        return resultOk({
          connectorId: connectorId ?? result?.connectorId,
          instanceId,
          sessionId,
          result,
        });
      }
      case 'logout': {
        const payload = asObject(request.payload);
        const connectorId = asNonEmptyString(payload?.connectorId);
        const instanceId = resolvePlatformInstanceId({
          instanceId: asNonEmptyString(payload?.instanceId),
          connectorId,
        });
        if (!instanceId) {
          return resultError('INVALID_PAYLOAD', 'payload.instanceId or payload.connectorId is required');
        }
        const snapshot = await logoutPlatformInstance(instanceId);
        return resultOk({
          connectorId,
          instanceId,
          snapshot,
        });
      }
      case 'clearAuthCookies': {
        const payload = asObject(request.payload);
        const connectorId = asNonEmptyString(payload?.connectorId);
        const instanceId = resolvePlatformInstanceId({
          instanceId: asNonEmptyString(payload?.instanceId),
          connectorId,
        });
        if (!instanceId) {
          return resultError('INVALID_PAYLOAD', 'payload.instanceId or payload.connectorId is required');
        }
        const snapshot = await clearPlatformInstanceAuthCookies(instanceId);
        return resultOk({
          connectorId,
          instanceId,
          snapshot,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported connector-auth method: ${request.method}`
        );
    }
  };
}

function createPmpAudioPlaybackHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const audioService = request.context.audioService;
    if (!audioService) {
      return resultError('NOT_AVAILABLE', 'Audio playback bridge is not available');
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_AUDIO_PLAYBACK_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-audio-service',
          methods: [
            'describe',
            'getState',
            'getPlayMode',
            'getCover',
            'play',
            'pause',
            'stop',
            'seek',
            'setVolume',
            'toggleMute',
            'playNext',
            'playPrevious',
            'playTrackAtIndex',
            'setPlayMode',
          ],
          methodPermissions: {
            getState: 'api:audio-state',
            getPlayMode: 'api:audio-state',
            getCover: 'api:audio-cover',
            play: 'api:audio-control',
            pause: 'api:audio-control',
            stop: 'api:audio-control',
            seek: 'api:audio-control',
            setVolume: 'api:audio-control',
            toggleMute: 'api:audio-control',
            playNext: 'api:audio-control',
            playPrevious: 'api:audio-control',
            playTrackAtIndex: 'api:audio-control',
            setPlayMode: 'api:audio-control',
          },
        });
      case 'getState': {
        const denied = readMethodPermissionError(request, 'api:audio-state');
        if (denied) return denied;
        return resultOk(audioService.getState());
      }
      case 'getPlayMode': {
        const denied = readMethodPermissionError(request, 'api:audio-state');
        if (denied) return denied;
        return resultOk(
          typeof audioService.getPlayMode === 'function'
            ? (audioService.getPlayMode() ?? null)
            : null
        );
      }
      case 'getCover': {
        const denied = readMethodPermissionError(request, 'api:audio-cover');
        if (denied) return denied;
        if (typeof request.context.getCover !== 'function') {
          return resultError('NOT_AVAILABLE', 'Cover bridge is not available');
        }
        return resultOk(await request.context.getCover());
      }
      case 'play': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        await audioService.play();
        return resultOk({ played: true });
      }
      case 'pause': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        await audioService.pause();
        return resultOk({ paused: true });
      }
      case 'stop': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        audioService.stop();
        return resultOk({ stopped: true });
      }
      case 'seek': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        const payload = asObject(request.payload);
        const time = asFiniteNumber(payload?.time);
        if (time === null || time < 0) {
          return resultError('INVALID_PAYLOAD', 'payload.time must be a non-negative number');
        }
        audioService.seek(time);
        return resultOk({ time });
      }
      case 'setVolume': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        const payload = asObject(request.payload);
        const volume = asFiniteNumber(payload?.volume);
        if (volume === null) {
          return resultError('INVALID_PAYLOAD', 'payload.volume must be a number');
        }
        audioService.setVolume(volume);
        return resultOk({ volume });
      }
      case 'toggleMute': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        audioService.toggleMute();
        return resultOk({ toggled: true });
      }
      case 'playNext': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        if (typeof audioService.playNext === 'function') {
          await audioService.playNext();
        }
        return resultOk({ playedNext: true });
      }
      case 'playPrevious': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        if (typeof audioService.playPrevious === 'function') {
          await audioService.playPrevious();
        }
        return resultOk({ playedPrevious: true });
      }
      case 'playTrackAtIndex': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        const payload = asObject(request.payload);
        const index = asNonNegativeInt(payload?.index);
        if (index === null) {
          return resultError('INVALID_PAYLOAD', 'payload.index must be a non-negative integer');
        }
        if (typeof audioService.playTrackAtIndex === 'function') {
          await audioService.playTrackAtIndex(index);
        }
        return resultOk({ index });
      }
      case 'setPlayMode': {
        const denied = readMethodPermissionError(request, 'api:audio-control');
        if (denied) return denied;
        const payload = asObject(request.payload);
        const mode = asNonEmptyString(payload?.mode);
        if (!mode) {
          return resultError('INVALID_PAYLOAD', 'payload.mode is required');
        }
        if (typeof audioService.setPlayMode === 'function') {
          audioService.setPlayMode(mode as never);
        }
        return resultOk({ mode });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported audio-engine.playback method: ${request.method}`
        );
    }
  };
}

function createPmpAudioAnalysisHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const denied = readMethodPermissionError(request, 'api:audio-visual');
    if (request.method !== 'describe' && denied) {
      return denied;
    }

    const audioService = request.context.audioService;
    if (!audioService) {
      return resultError('NOT_AVAILABLE', 'Audio analysis bridge is not available');
    }

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_AUDIO_ANALYSIS_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'pmp-audio-spectrum',
          methods: ['describe', 'getSpectrum', 'getSpectrumFrame'],
          streamMethods: ['openSpectrumFrameStream'],
        });
      case 'getSpectrum':
        return resultOk(audioService.getFrequencyData?.() ?? null);
      case 'getSpectrumFrame': {
        const payload = asObject(request.payload);
        const tap = payload?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
        return resultOk(audioService.getSpectrumFrame?.(tap) ?? null);
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported audio-engine.analysis method: ${request.method}`
        );
    }
  };
}

function createPmpThemeBindingsHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const theme = getStoredOrDefaultTheme();

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_THEME_BINDINGS_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'theme-binding-snapshot',
          themeId: theme.id,
          themeVersion: theme.version,
          methods: [
            'describe',
            'listBindingIds',
            'listSurfaceIds',
            'resolveBinding',
            'resolveSurface',
          ],
        });
      case 'listBindingIds': {
        const bindingIds = new Set<string>([
          ...Object.keys(theme.bindings ?? {}),
          ...Object.keys(theme.surfaces ?? {}),
        ]);

        return resultOk({
          themeId: theme.id,
          themeVersion: theme.version,
          bindingCount: bindingIds.size,
          bindingIds: Array.from(bindingIds.values()).sort((left, right) =>
            left.localeCompare(right)
          ),
        });
      }
      case 'listSurfaceIds': {
        const surfaceIds = Object.keys(theme.surfaces ?? {}).sort((left, right) =>
          left.localeCompare(right)
        );
        return resultOk({
          themeId: theme.id,
          themeVersion: theme.version,
          surfaceCount: surfaceIds.length,
          surfaceIds,
        });
      }
      case 'resolveBinding': {
        const payload = asObject(request.payload);
        const bindingId = asNonEmptyString(payload?.bindingId);
        if (!bindingId) {
          return resultError('INVALID_PAYLOAD', 'payload.bindingId is required');
        }

        const resolved = resolveThemeBinding(theme, bindingId as ThemeBindingId);
        const surfaceId = resolveThemeSurfaceTargetId(theme, bindingId as ThemeBindingId) ?? null;

        return resultOk({
          themeId: theme.id,
          themeVersion: theme.version,
          bindingId,
          source: resolved.source,
          surfaceId,
          binding: resolved.binding,
        });
      }
      case 'resolveSurface': {
        const payload = asObject(request.payload);
        const requestedId =
          asNonEmptyString(payload?.surfaceId) ?? asNonEmptyString(payload?.bindingId);
        if (!requestedId) {
          return resultError(
            'INVALID_PAYLOAD',
            'payload.surfaceId or payload.bindingId is required'
          );
        }

        const surfaceId =
          resolveThemeSurfaceTargetId(theme, requestedId as ThemeBindingId | ThemeSurfaceId) ??
          null;

        return resultOk({
          themeId: theme.id,
          themeVersion: theme.version,
          requestedId,
          surfaceId,
          exists: surfaceId ? Boolean(theme.surfaces?.[surfaceId]) : false,
          surface: surfaceId ? resolveThemeSurface(theme, surfaceId) : {},
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported theme-bindings method: ${request.method}`
        );
    }
  };
}

function createPmpLibraryFieldsHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_LIBRARY_FIELDS_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'music-library-schema',
          methods: [
            'describe',
            'listFieldCatalog',
            'listFacetCatalog',
            'listFacetEntries',
            'listTextFacetValues',
          ],
        });
      case 'listFieldCatalog': {
        const fields = await listNativeLibraryTrackFieldCatalog();
        return resultOk({
          fieldCount: fields.length,
          fields,
        });
      }
      case 'listFacetCatalog': {
        const facets = await listNativeLibraryFacetCatalog();
        return resultOk({
          facetCount: facets.length,
          facets,
        });
      }
      case 'listFacetEntries': {
        const payload = asObject(request.payload);
        const kind =
          payload?.kind === 'text-values'
            ? 'text-values'
            : payload?.kind === 'album-summaries'
              ? 'album-summaries'
              : null;
        if (!kind) {
          return resultError(
            'INVALID_PAYLOAD',
            'payload.kind must be "text-values" or "album-summaries"'
          );
        }

        const field = asNonEmptyString(payload?.field);
        const includeMissing = asBoolean(payload?.includeMissing);
        const visibleOnly = asBoolean(payload?.visibleOnly);
        const limit = asNonNegativeInt(payload?.limit);

        const query: NonNullable<Parameters<typeof listNativeLibraryFacetEntries>[0]> = {
          kind,
          ...(field ? { field } : {}),
          ...(includeMissing !== null ? { includeMissing } : {}),
          ...(visibleOnly !== null ? { visibleOnly } : {}),
          ...(limit !== null ? { limit } : {}),
        };

        const result = await listNativeLibraryFacetEntries(query);
        if (!result) {
          return resultError('NOT_AVAILABLE', 'Library facet entry query is not available', {
            retryable: true,
            details: { query },
          });
        }

        return resultOk({
          query,
          result,
        });
      }
      case 'listTextFacetValues': {
        const payload = asObject(request.payload);
        const field = asNonEmptyString(payload?.field);
        if (!field) {
          return resultError('INVALID_PAYLOAD', 'payload.field is required');
        }

        const includeMissing = asBoolean(payload?.includeMissing);
        const visibleOnly = asBoolean(payload?.visibleOnly);
        const limit = asNonNegativeInt(payload?.limit);

        const query = {
          field,
          ...(includeMissing !== null ? { includeMissing } : {}),
          ...(visibleOnly !== null ? { visibleOnly } : {}),
          ...(limit !== null ? { limit } : {}),
        };

        const values = await listNativeLibraryTextFacetValues(query);
        return resultOk({
          query,
          valueCount: values.length,
          values,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported library-fields method: ${request.method}`
        );
    }
  };
}

function createPmpKeybindingContextHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const keybindings = request.context.keybindings;
    if (!keybindings) {
      return resultError('NOT_AVAILABLE', 'Keybinding context service is not available', {
        retryable: true,
      });
    }

    const context = keybindings.getContext();
    const keys = Object.keys(context).sort((left, right) => left.localeCompare(right));

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_KEYBINDING_CONTEXT_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'keybindings-service-context',
          methods: ['describe', 'listKeys', 'getContext', 'getValue'],
          keyCount: keys.length,
          keys,
        });
      case 'listKeys':
        return resultOk({
          keyCount: keys.length,
          keys,
        });
      case 'getContext':
        return resultOk({
          keyCount: keys.length,
          context,
        });
      case 'getValue': {
        const payload = asObject(request.payload);
        const key = asNonEmptyString(payload?.key);
        if (!key) {
          return resultError('INVALID_PAYLOAD', 'payload.key is required');
        }

        return resultOk({
          key,
          exists: Object.prototype.hasOwnProperty.call(context, key),
          value: context[key],
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported keybinding-context method: ${request.method}`
        );
    }
  };
}

function createPmpI18nHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    const pluginId = request.context.pluginId;

    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId: HOST_PMP_I18N_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'shared-locale-plugin-bundles',
          methods: [
            'describe',
            'getState',
            'setLocale',
            'registerMessages',
            'clearMessages',
            'translate',
          ],
          activeLocale: getLocale(),
          fallbackLocale: FALLBACK_LOCALE,
          supportedLocales: [...SUPPORTED_LOCALES],
          registeredLocales: listPluginI18nRegisteredLocales(pluginId),
        });
      case 'getState':
        return resultOk({
          activeLocale: getLocale(),
          fallbackLocale: FALLBACK_LOCALE,
          supportedLocales: [...SUPPORTED_LOCALES],
          registeredLocales: listPluginI18nRegisteredLocales(pluginId),
        });
      case 'setLocale': {
        const payload = asObject(request.payload);
        const locale = asLocale(payload?.locale);
        if (!locale) {
          return resultError('INVALID_PAYLOAD', 'payload.locale must be a supported locale');
        }

        const previousLocale = getLocale();
        setLocale(locale);
        await broadcastDataUpdate(STORAGE_KEYS.LOCALE, locale, TAURI_EVENTS.LOCALE_UPDATED);

        return resultOk({
          locale,
          previousLocale,
          changed: previousLocale !== locale,
        });
      }
      case 'registerMessages': {
        const payload = asObject(request.payload);
        const locale = asLocale(payload?.locale);
        if (!locale) {
          return resultError('INVALID_PAYLOAD', 'payload.locale must be a supported locale');
        }

        const messages = sanitizePluginMessages(payload?.messages);
        const replace = payload?.replace === true;
        const store = getPluginI18nMessageStore(pluginId);
        const previousMessages = store.get(locale) ?? {};
        const nextMessages = replace ? messages : { ...previousMessages, ...messages };

        store.set(locale, nextMessages);

        return resultOk({
          locale,
          messageCount: Object.keys(nextMessages).length,
          registeredLocales: listPluginI18nRegisteredLocales(pluginId),
        });
      }
      case 'clearMessages': {
        const payload = asObject(request.payload);
        if (
          payload &&
          Object.prototype.hasOwnProperty.call(payload, 'locale') &&
          !asLocale(payload.locale)
        ) {
          return resultError('INVALID_PAYLOAD', 'payload.locale must be a supported locale');
        }

        const locale =
          payload && Object.prototype.hasOwnProperty.call(payload, 'locale')
            ? asLocale(payload.locale)
            : null;
        const store = pluginI18nMessageStores.get(pluginId);
        if (!store) {
          return resultOk({
            cleared: false,
            registeredLocales: [],
          });
        }

        if (locale) {
          const cleared = store.delete(locale);
          if (store.size === 0) {
            pluginI18nMessageStores.delete(pluginId);
          }
          return resultOk({
            locale,
            cleared,
            registeredLocales: listPluginI18nRegisteredLocales(pluginId),
          });
        }

        const hadAny = store.size > 0;
        pluginI18nMessageStores.delete(pluginId);
        return resultOk({
          cleared: hadAny,
          registeredLocales: [],
        });
      }
      case 'translate': {
        const payload = asObject(request.payload);
        const key = asNonEmptyString(payload?.key);
        if (!key) {
          return resultError('INVALID_PAYLOAD', 'payload.key is required');
        }

        if (
          payload &&
          Object.prototype.hasOwnProperty.call(payload, 'locale') &&
          !asLocale(payload.locale)
        ) {
          return resultError('INVALID_PAYLOAD', 'payload.locale must be a supported locale');
        }

        const locale = asLocale(payload?.locale) ?? getLocale();
        const params = asObject(payload?.params) ?? undefined;
        const resolved = resolvePluginMessageTemplate(pluginId, locale, key);

        return resultOk({
          key,
          requestedLocale: locale,
          resolvedLocale: resolved.resolvedLocale,
          found: typeof resolved.template === 'string',
          message:
            typeof resolved.template === 'string'
              ? formatPluginMessage(resolved.template, params)
              : key,
        });
      }
      default:
        return resultError('METHOD_NOT_SUPPORTED', `Unsupported i18n method: ${request.method}`);
    }
  };
}

function createPmpTelemetryHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe': {
        const snapshot = buildPmpTelemetryStatus();
        return resultOk({
          capabilityId: HOST_PMP_TELEMETRY_CAPABILITY_ID,
          stage: 'host-pack',
          implementation: 'frontend-telemetry-sink',
          methods: ['describe', 'getStatus', 'log', 'flush'],
          identityInjection: {
            pluginId: true,
            hostLabel: true,
            loggerId: true,
            trustLevel: 'unknown',
          },
          redaction: 'host-adapter',
          sink: 'frontend-telemetry-service',
          ...(snapshot ? { snapshot } : {}),
        });
      }
      case 'getStatus': {
        const snapshot = buildPmpTelemetryStatus();
        if (!snapshot) {
          return resultError('NOT_AVAILABLE', 'Telemetry service is not available', {
            retryable: true,
          });
        }

        return resultOk(snapshot);
      }
      case 'flush': {
        const service = getGlobalTelemetryService();
        if (!service) {
          return resultError('NOT_AVAILABLE', 'Telemetry service is not available', {
            retryable: true,
          });
        }

        await service.flushNow();
        return resultOk({
          flushed: true,
          ...(buildPmpTelemetryStatus() ?? {}),
        });
      }
      case 'log': {
        const service = getGlobalTelemetryService();
        if (!service) {
          return resultError('NOT_AVAILABLE', 'Telemetry service is not available', {
            retryable: true,
          });
        }

        const payload = asObject(request.payload);
        const loggerId = asNonEmptyString(payload?.loggerId);
        if (!loggerId || !TELEMETRY_IDENTIFIER_PATTERN.test(loggerId)) {
          return resultError(
            'INVALID_PAYLOAD',
            'payload.loggerId is required and must match [a-z0-9._-]'
          );
        }

        const event = asNonEmptyString(payload?.event);
        if (!event || !TELEMETRY_IDENTIFIER_PATTERN.test(event)) {
          return resultError(
            'INVALID_PAYLOAD',
            'payload.event is required and must match [a-z0-9._-]'
          );
        }

        const level = asTelemetryLevel(payload?.level) ?? 'info';
        const kind = asTelemetryKind(payload?.kind) ?? 'log';
        const component = asNonEmptyString(payload?.component);
        const runtimeId = asNonEmptyString(payload?.runtimeId);
        const fields = {
          ...(sanitizeTelemetryFields(payload?.fields) ?? {}),
          pluginId: request.context.pluginId,
          hostLabel: request.context.hostLabel,
          loggerId,
          runtimeId: runtimeId ?? 'unknown',
          trustLevel: 'unknown',
          hostCapabilityId: HOST_PMP_TELEMETRY_CAPABILITY_ID,
          pluginTelemetry: true,
        } satisfies TelemetryFields;

        service.ingest(
          TELEMETRY_PLUGIN_MODULE_ID,
          {
            level,
            event,
            kind,
            component: buildPluginTelemetryComponent(request.context.pluginId, loggerId, component),
            message: sanitizeTelemetryText(payload?.message),
            traceId: asNonEmptyString(payload?.traceId),
            spanId: asNonEmptyString(payload?.spanId),
            windowId: asNonEmptyString(payload?.windowId),
            fields,
          },
          buildPluginTelemetryComponent(request.context.pluginId, loggerId, component)
        );

        return resultOk({
          acceptedCount: 1,
          moduleId: TELEMETRY_PLUGIN_MODULE_ID,
          pluginId: request.context.pluginId,
          loggerId,
          event,
          level,
          kind,
        });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported telemetry method: ${request.method}`
        );
    }
  };
}

function createRegistryHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe': {
        return resultOk({
          id: CORE_CAPABILITY_REGISTRY_CAPABILITY_ID,
          version: CORE_CAPABILITY_REGISTRY_CAPABILITY_VERSION,
          methods: ['describe', 'list', 'get', 'has'],
          hostCapabilityPack: clonePmpHostCapabilityPackDescriptor(),
          visibleHostCapabilityFamilies: listVisiblePmpHostCapabilityFamilies(
            request.context.permissions
          ),
        });
      }
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
    id: CORE_CAPABILITY_REGISTRY_CAPABILITY_ID,
    version: CORE_CAPABILITY_REGISTRY_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'Core capability discovery and query contract',
    handler: createRegistryHandler(),
  },
  {
    id: 'foundation.capability-registry',
    version: CORE_CAPABILITY_REGISTRY_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'Capability discovery and invocation contract',
    handler: createRegistryHandler(),
  },
  {
    id: HOST_PMP_NAVIGATION_CAPABILITY_ID,
    version: HOST_PMP_NAVIGATION_CAPABILITY_VERSION,
    permission: 'api:navigation',
    description: 'PMP host navigation bridge',
    handler: createPmpNavigationHandler(),
  },
  {
    id: HOST_PMP_WINDOW_CAPABILITY_ID,
    version: HOST_PMP_WINDOW_CAPABILITY_VERSION,
    permission: 'api:window',
    description: 'PMP host window shell bridge',
    handler: createPmpWindowHandler(),
  },
  {
    id: HOST_PMP_SHELL_MENU_CAPABILITY_ID,
    version: HOST_PMP_SHELL_MENU_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP host shell menu action catalog bridge',
    handler: createPmpShellMenuHandler(),
  },
  {
    id: HOST_PMP_SHELL_CONTEXT_MENU_CAPABILITY_ID,
    version: HOST_PMP_SHELL_CONTEXT_MENU_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP host context menu surface schema bridge',
    handler: createPmpShellContextMenuHandler(),
  },
  {
    id: HOST_PMP_SHELL_TRAY_CAPABILITY_ID,
    version: HOST_PMP_SHELL_TRAY_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP host system tray bridge',
    handler: createPmpShellTrayHandler(),
  },
  {
    id: HOST_PMP_SHELL_STATUS_ITEM_CAPABILITY_ID,
    version: HOST_PMP_SHELL_STATUS_ITEM_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP host shell status item slot catalog bridge',
    handler: createPmpShellStatusItemHandler(),
  },
  {
    id: HOST_PMP_STORAGE_CONFIG_CAPABILITY_ID,
    version: HOST_PMP_STORAGE_CONFIG_CAPABILITY_VERSION,
    permission: 'storage:local',
    description: 'PMP plugin config storage bridge',
    handler: createPmpStorageConfigHandler(),
  },
  {
    id: HOST_PMP_STORAGE_DURABLE_TEXT_CAPABILITY_ID,
    version: HOST_PMP_STORAGE_DURABLE_TEXT_CAPABILITY_VERSION,
    permission: 'storage:durable-text',
    description: 'PMP plugin durable text storage bridge',
    handler: createPmpStorageDurableTextHandler(),
  },
  {
    id: HOST_PMP_STORAGE_SYNC_CAPABILITY_ID,
    version: HOST_PMP_STORAGE_SYNC_CAPABILITY_VERSION,
    permission: 'storage:local',
    description: 'PMP plugin config sync snapshot bridge',
    handler: createPmpStorageSyncHandler(),
  },
  {
    id: HOST_PMP_MAGNETS_CATALOG_CAPABILITY_ID,
    version: HOST_PMP_MAGNETS_CATALOG_CAPABILITY_VERSION,
    permission: 'api:magnets-catalog',
    description: 'PMP magnet catalog bridge for custom/plugin magnets',
    handler: createPmpMagnetsCatalogHandler(),
  },
  {
    id: HOST_PMP_MAGNETS_LAYOUT_CAPABILITY_ID,
    version: HOST_PMP_MAGNETS_LAYOUT_CAPABILITY_VERSION,
    permission: 'api:magnets-layout',
    description: 'PMP magnet layout bridge by space',
    handler: createPmpMagnetsLayoutHandler(),
  },
  {
    id: HOST_PMP_MAGNETS_RENDERER_CAPABILITY_ID,
    version: HOST_PMP_MAGNETS_RENDERER_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP magnet renderer, variant, and system layout rules bridge',
    handler: createPmpMagnetsRendererHandler(),
  },
  {
    id: HOST_PMP_AUDIO_PLAYBACK_CAPABILITY_ID,
    version: HOST_PMP_AUDIO_PLAYBACK_CAPABILITY_VERSION,
    description: 'PMP audio playback and cover bridge',
    handler: createPmpAudioPlaybackHandler(),
  },
  {
    id: HOST_PMP_AUDIO_ANALYSIS_CAPABILITY_ID,
    version: HOST_PMP_AUDIO_ANALYSIS_CAPABILITY_VERSION,
    permission: 'api:audio-visual',
    description: 'PMP audio spectrum and analysis bridge',
    handler: createPmpAudioAnalysisHandler(),
  },
  {
    id: HOST_PMP_MUSIC_PLATFORM_CATALOG_CAPABILITY_ID,
    version: HOST_PMP_MUSIC_PLATFORM_CATALOG_CAPABILITY_VERSION,
    permission: 'api:music-platform-catalog',
    description: 'PMP music platform connector catalog bridge',
    handler: createPmpMusicPlatformCatalogHandler(),
  },
  {
    id: HOST_PMP_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_ID,
    version: HOST_PMP_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_VERSION,
    permission: 'api:music-platform-workspace',
    description: 'PMP music platform workspace provider bridge',
    handler: createPmpMusicPlatformWorkspaceHandler(),
  },
  {
    id: HOST_PMP_MUSIC_PLATFORM_SEARCH_CAPABILITY_ID,
    version: HOST_PMP_MUSIC_PLATFORM_SEARCH_CAPABILITY_VERSION,
    permission: 'api:music-platform-search',
    description: 'PMP music platform track search bridge',
    handler: createPmpMusicPlatformSearchHandler(),
  },
  {
    id: HOST_PMP_MUSIC_PLATFORM_PREPARE_CAPABILITY_ID,
    version: HOST_PMP_MUSIC_PLATFORM_PREPARE_CAPABILITY_VERSION,
    permission: 'api:music-platform-prepare',
    description: 'PMP music platform playback preparation bridge',
    handler: createPmpMusicPlatformPrepareHandler(),
  },
  {
    id: HOST_PMP_CONNECTOR_AUTH_CAPABILITY_ID,
    version: HOST_PMP_CONNECTOR_AUTH_CAPABILITY_VERSION,
    permission: 'api:connector-auth',
    description: 'PMP connector auth bridge',
    handler: createPmpConnectorAuthHandler(),
  },
  {
    id: HOST_PMP_THEME_BINDINGS_CAPABILITY_ID,
    version: HOST_PMP_THEME_BINDINGS_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP theme binding and surface resolution bridge',
    handler: createPmpThemeBindingsHandler(),
  },
  {
    id: HOST_PMP_LIBRARY_FIELDS_CAPABILITY_ID,
    version: HOST_PMP_LIBRARY_FIELDS_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP music library field and facet catalog bridge',
    handler: createPmpLibraryFieldsHandler(),
  },
  {
    id: HOST_PMP_KEYBINDING_CONTEXT_CAPABILITY_ID,
    version: HOST_PMP_KEYBINDING_CONTEXT_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP keybinding context snapshot bridge',
    handler: createPmpKeybindingContextHandler(),
  },
  {
    id: HOST_PMP_I18N_CAPABILITY_ID,
    version: HOST_PMP_I18N_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP locale state and plugin bundle bridge',
    handler: createPmpI18nHandler(),
  },
  {
    id: HOST_PMP_TELEMETRY_CAPABILITY_ID,
    version: HOST_PMP_TELEMETRY_CAPABILITY_VERSION,
    permission: 'api:host',
    description: 'PMP plugin telemetry sink with host redaction',
    handler: createPmpTelemetryHandler(),
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
    id: HOST_PMP_AUDIO_INPUT_CAPABILITY_ID,
    version: HOST_PMP_AUDIO_INPUT_CAPABILITY_VERSION,
    permission: 'api:audio-input-adapter',
    experimental: true,
    description: 'PMP audio input adapter bridge',
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

export function getPmpHostCapabilityPackDescriptor(): PmpHostCapabilityPackDescriptor {
  return clonePmpHostCapabilityPackDescriptor();
}

export function listPmpHostCapabilityFamilies(): PmpHostCapabilityFamilyId[] {
  return [...PMP_HOST_CAPABILITY_FAMILIES];
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
      voiceTrainingRuntimeDefaultProviderId = nextRuntimeDefaultProviderId(
        voiceTrainingRuntimeProviders
      );
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
