/**
 * 绐楀彛闂撮€氫俊宸ュ叿
 * 缁熶竴绠＄悊涓荤獥鍙ｅ拰缂栬緫鍣ㄧ獥鍙ｄ箣闂寸殑鏁版嵁鍚屾
 */

import { emit, listen, UnlistenFn } from '@tauri-apps/api/event';
import { readString, writeString } from '../modules/storage';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { isTauriRuntime } from './tauriRuntime';

const DEBUG_STORAGE_KEY = 'pixel-matrix-debug-window-comm';
const LOCAL_COMM_EVENT = 'pixel-matrix-window-comm';
const BROADCAST_CHANNEL_NAME = 'pixel-matrix-window-comm';
let debugEnabledCache: boolean | null = null;
const telemetry = getTelemetryLogger('windowing', 'windowCommunication');

export const BROADCAST_DATA_UPDATE_PAYLOAD_SOFT_LIMIT_BYTES = 64 * 1024;
export const BROADCAST_DATA_UPDATE_PAYLOAD_HARD_LIMIT_BYTES = 512 * 1024;

const BROADCAST_DATA_UPDATE_RESERVED_HEAVY_KEY_HINTS = [
  'queue',
  'playlist',
  'tracks',
  'music-library',
  'music-library-result',
  'cover-blob',
  'blob-url',
] as const;

export interface BroadcastDataUpdatePayloadBudgetSnapshot {
  bytes: number;
  softLimitBytes: number;
  hardLimitBytes: number;
  softLimitExceeded: boolean;
  hardLimitExceeded: boolean;
  reservedHeavyDomain: boolean;
  matchedReservedHint: string | null;
  shouldWarn: boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countUtf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length;
}

export function inspectBroadcastDataUpdatePayloadBudget(
  storageKey: string,
  serializedPayload: string
): BroadcastDataUpdatePayloadBudgetSnapshot {
  const bytes = countUtf8Bytes(serializedPayload);
  const normalizedKey = storageKey.toLowerCase();
  const matchedReservedHint =
    BROADCAST_DATA_UPDATE_RESERVED_HEAVY_KEY_HINTS.find((hint) => normalizedKey.includes(hint)) ?? null;
  const softLimitExceeded = bytes > BROADCAST_DATA_UPDATE_PAYLOAD_SOFT_LIMIT_BYTES;
  const hardLimitExceeded = bytes > BROADCAST_DATA_UPDATE_PAYLOAD_HARD_LIMIT_BYTES;
  const reservedHeavyDomain = matchedReservedHint !== null;

  return {
    bytes,
    softLimitBytes: BROADCAST_DATA_UPDATE_PAYLOAD_SOFT_LIMIT_BYTES,
    hardLimitBytes: BROADCAST_DATA_UPDATE_PAYLOAD_HARD_LIMIT_BYTES,
    softLimitExceeded,
    hardLimitExceeded,
    reservedHeavyDomain,
    matchedReservedHint,
    shouldWarn: softLimitExceeded || (reservedHeavyDomain && bytes > 8 * 1024),
  };
}

function isDebugEnabled(): boolean {
  if (debugEnabledCache !== null) return debugEnabledCache;
  let enabled = false;
  enabled = readString(DEBUG_STORAGE_KEY) === '1';
  debugEnabledCache = enabled;
  return enabled;
}

function debugLog(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  telemetry.debug('window-communication.debug', {
    fields: {
      args,
    },
  });
}

type WindowCommStats = {
  emitted: Record<string, number>;
  received: Record<string, number>;
  lastEmitAt: Record<string, number>;
  lastReceiveAt: Record<string, number>;
};

const windowCommStats: WindowCommStats = {
  emitted: {},
  received: {},
  lastEmitAt: {},
  lastReceiveAt: {},
};

declare global {
  // eslint-disable-next-line no-var
  var __pmpWindowCommStats: WindowCommStats | undefined;
}

function exposeStats(): void {
  if (!isDebugEnabled()) return;
  globalThis.__pmpWindowCommStats = windowCommStats;
}

function recordEmit(eventName: string): void {
  if (!isDebugEnabled()) return;
  windowCommStats.emitted[eventName] = (windowCommStats.emitted[eventName] ?? 0) + 1;
  windowCommStats.lastEmitAt[eventName] = Date.now();
  exposeStats();
}

function recordReceive(eventName: string): void {
  if (!isDebugEnabled()) return;
  windowCommStats.received[eventName] = (windowCommStats.received[eventName] ?? 0) + 1;
  windowCommStats.lastReceiveAt[eventName] = Date.now();
  exposeStats();
}

type WindowCommMessage =
  | {
      kind: 'data-update';
      key: string;
      timestamp: number;
    }
  | {
      kind: 'signal';
      eventName: string;
      timestamp: number;
    };

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  if (typeof window.BroadcastChannel === 'undefined') return null;
  if (broadcastChannel) return broadcastChannel;
  try {
    broadcastChannel = new window.BroadcastChannel(BROADCAST_CHANNEL_NAME);
    return broadcastChannel;
  } catch {
    return null;
  }
}

function emitLocalMessage(message: WindowCommMessage): void {
  try {
    window.dispatchEvent(new CustomEvent<WindowCommMessage>(LOCAL_COMM_EVENT, { detail: message }));
  } catch {
    // best-effort
  }
}

function broadcastChannelMessage(message: WindowCommMessage): void {
  const channel = getBroadcastChannel();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } catch {
    // best-effort
  }
}

/**
 * localStorage 鏁版嵁 key 瀹氫箟
 */
export const STORAGE_KEYS = {
  // === 閰嶇疆鏁版嵁锛堜富瑕佹暟鎹簮锛?===
  CONFIG: 'pixel-matrix-player-config', // 涓婚厤缃枃浠讹紙鍖呭惈 magnet銆乬rid銆乻tyleOverride锛?
  LOCALE: 'pixel-matrix-locale', // UI locale锛坕18n锛?
  KEYBINDINGS_USER_V1: 'pixel-matrix-keybindings-user-v1', // 鐢ㄦ埛鑷畾涔夊揩鎹烽敭锛坅rray, VSCode-like rules锛?
  // === 杩愯鏃舵暟鎹紙杈呭姪/缂撳瓨锛?===
  MAGNET_SPACES: 'pixel-matrix-magnet-spaces-v1', // Magnet spaces锛坅ctive space + list锛?
  MAGNET_SPACE_LAYOUT: 'pixel-matrix-magnet-space-layout-v1', // Per-space magnet layout (active ids + anchors)
  MAGNET_CATALOG: 'pixel-matrix-magnet-catalog-v1', // Global custom magnet catalog (templates only, no per-space layout)
  MAGNET_SPACE_PRESETS: 'pixel-matrix-magnet-space-presets-v1', // Per-space layout presets (web fallback; Tauri uses layout store)
  MAGNET_SPACE_HISTORY: 'pixel-matrix-magnet-space-history-v1', // Per-space layout history (web fallback; Tauri uses layout store)
  MAGNET_PLACEMENT_REQUEST_V1: 'pixel-matrix-magnet-placement-request-v1', // Request placing a magnet into the main matrix (v1)
  MAGNET_LIBRARY_FOCUS_REQUEST_V1: 'pixel-matrix-magnet-library-focus-request-v1', // Request focusing a magnet in the library window (v1)
  MAGNET_CHROME_OVERRIDE_MODE_V1: 'pixel-matrix-magnet-chrome-override-mode-v1', // Global magnet chrome override mode (v1)
  MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_V1:
    'pixel-matrix-music-platform-workspace-ownership-v1', // Music platform workspace ownership migration setting
  BACKGROUND_SETTINGS: 'pixel-matrix-background-settings', // 鑳屾櫙璁剧疆
  BACKGROUND_HISTORY: 'pixel-matrix-background-history', // 鑳屾櫙鍘嗗彶
  IS_MAXIMIZED: 'pixel-matrix-is-maximized', // 绐楀彛鏈€澶у寲鐘舵€?

  // === Pixel 娓叉煋閰嶇疆 ===
  PIXEL_SHAPE: 'pixel-matrix-pixel-shape', // Pixel 褰㈢姸
  PIXEL_SIZE: 'pixel-matrix-pixel-size', // Pixel 灏哄
  PIXEL_OPACITY: 'pixel-matrix-pixel-opacity', // Pixel 閫忔槑搴?

  // === 绐楀彛鏁堟灉閰嶇疆 ===
  BACKGROUND_EFFECT: 'pixel-matrix-background-effect', // 鑳屾櫙鏁堟灉
  BORDER_EFFECT: 'pixel-matrix-border-effect', // 杈规鏁堟灉
  BACKGROUND_THEME_COLOR: 'pixel-matrix-background-theme-color', // 鑳屾櫙鏁堟灉涓婚棰滆壊
  BORDER_THEME_COLOR: 'pixel-matrix-border-theme-color', // 杈规鏁堟灉涓婚棰滆壊


  // === 缂栬緫鍣ㄤ复鏃舵暟鎹?===
  MAGNET_EDITOR_DATA: 'magnet-editor-data', // Magnet Editor payload
  MAGNET_EDITOR_MODE: 'magnet-editor-mode', // Magnet Editor mode
  MAGNET_EDITOR_HISTORY_PREFIX: 'magnet-editor-history', // Per-magnet editor history prefix
  CREATOR_WINDOW_OPEN: 'magnet-creator-window-open', // Legacy internal Magnet Editor window state
  EDITOR_STATE: 'pixel-matrix-editor-state', // 缂栬緫鍣ㄧ姸鎬侊紙鍖呮嫭閫変腑淇℃伅锛?

  // === Native Audio ===
  NATIVE_AUDIO_OUTPUT_BACKEND: 'pixel-matrix-native-audio-output-backend', // 杈撳嚭鍚庣 ID锛坰tring | null锛?
  NATIVE_AUDIO_VOLUME: 'pixel-matrix-native-audio-volume', // Volume锛坣umber, 0.0 - 1.0锛?
  NATIVE_AUDIO_MUTED: 'pixel-matrix-native-audio-muted', // Muted锛坆oolean锛?
  NATIVE_AUDIO_PLAY_MODE: 'pixel-matrix-native-audio-play-mode', // PlayMode锛坰equence/loop/single-loop/shuffle锛?
  NATIVE_AUDIO_INPUT_ID: 'pixel-matrix-native-audio-input-id', // 杈撳叆/瑙ｇ爜缁勪欢 ID锛坰tring | null锛?
  NATIVE_AUDIO_GAIN_DB: 'pixel-matrix-native-audio-gain-db', // Gain锛坣umber锛宒B锛?
  NATIVE_AUDIO_DSP_CHAIN: 'pixel-matrix-native-audio-dsp-chain', // DSP chain锛坅rray锛?
  NATIVE_AUDIO_DSP_GRAPH: 'pixel-matrix-native-audio-dsp-graph', // DSP graph锛坥bject锛?
  NATIVE_AUDIO_VST_ENABLED: 'pixel-matrix-native-audio-vst-enabled', // VST enabled锛坆oolean锛?
  DSP_RACK_LOCATE_NODE: 'pixel-matrix-dsp-rack-locate-node-v1', // DSP Rack 瀹氫綅/楂樹寒鑺傜偣锛坥bject锛?
  NAVIGATION_REQUEST: 'pixel-matrix-navigation-request-v1', // 璺ㄧ獥鍙ｅ鑸姹傦紙object锛?
  NATIVE_AUDIO_REPLAYGAIN_SETTINGS: 'pixel-matrix-native-audio-replaygain-settings', // ReplayGain settings锛坥bject锛?
  NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS:
    'pixel-matrix-native-audio-runtime-control-settings', // Runtime control settings锛坉ynamic fallback / volume debounce锛?
  NATIVE_AUDIO_CROSSFADE_SETTINGS: 'pixel-matrix-native-audio-crossfade-settings', // Crossfade settings锛坥bject锛?
  NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS: 'pixel-matrix-native-audio-streaming-buffer-settings', // Streaming buffer settings锛坥bject锛?
  NATIVE_AUDIO_ENGINE_POLICY: 'pixel-matrix-native-audio-engine-policy', // Engine policy settings锛坥bject锛?
  NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS: 'pixel-matrix-native-audio-dynamic-src-settings', // Dynamic SRC auto settings锛坥bject锛?
  NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE:
    'pixel-matrix-native-audio-dynamic-src-learning-profile', // Dynamic SRC learned stress profile锛坥bject锛?
  NATIVE_AUDIO_TUNING_AUTO_SETTINGS:
    'pixel-matrix-native-audio-tuning-auto-settings', // Auto tuning controller settings锛坥bject锛?

  // === VST3 ===
  VST_SCAN_SETTINGS: 'pixel-matrix-vst3-scan-settings-v1', // VST3 鎵弿璁剧疆锛坥bject锛屽惈 scan paths锛?

  // === Extensions ===
  EXTENSIONS_V2: 'pixel-matrix-installed-extensions-v2', // 宸插畨瑁?manifest-v2 鎵╁睍
  EXTENSIONS_V2_AUDIT_LOG_V1: 'pixel-matrix-installed-extensions-v2-audit-log-v1', // manifest-v2 governance audit log
  EXTENSIONS_V2_RUNTIME_RESTART_V1: 'pixel-matrix-installed-extensions-v2-runtime-restart-v1', // manifest-v2 runtime restart request
  EXTENSIONS_V2_DEV_SESSIONS_V1: 'pixel-matrix-installed-extensions-v2-dev-sessions-v1', // manifest-v2 development sessions
  PLUGIN_MAGNET_CREATOR_DRAFT_V1:
    'pixel-matrix-plugin-magnet-creator-draft-v1', // Host-side plugin magnet creator draft

  // === Shader Packs (.pmps) ===
  PMPS_SHADERS: 'pixel-matrix-pmps-shaders', // 宸插畨瑁?shader pack锛坢anifest + fragmentCode锛?
  PMPS_DURABLE_MIGRATION_V1: 'pixel-matrix-pmps-durable-migration-v1', // durable migration state flag (R3)
  PMPS_DURABLE_MIGRATION_V1_REPORT: 'pixel-matrix-pmps-durable-migration-v1-report', // migration report (R3)
  PMPS_MAGNET_SHADER_BINDINGS: 'pixel-matrix-pmps-magnet-shader-bindings', // Magnet -> shader binding
  PMPS_MAGNET_UNIFORMS: 'pixel-matrix-pmps-magnet-uniforms', // Magnet -> shader uniforms overrides
  PMPS_SHADER_FUSE: 'pixel-matrix-pmps-shader-fuse', // shader runtime error fuse

  // === Theme ===
  THEME_CONFIG: 'pixel-matrix-theme-config',

  // === Window Pin ===
  WINDOW_PIN_STATE: 'pixel-matrix-window-pin-state',
  WINDOW_PIN_RUNTIME_OVERRIDES: 'pixel-matrix-window-pin-runtime-overrides-v1',
  ORNAMENTS_V2: 'pixel-matrix-ornaments-v2',
  DESKTOP_LYRICS_ENABLED: 'pixel-matrix-desktop-lyrics-enabled',
  DESKTOP_LYRICS_CLICK_THROUGH: 'pixel-matrix-desktop-lyrics-click-through',
  DESKTOP_LYRICS_FONT_SIZE: 'pixel-matrix-desktop-lyrics-font-size',
  DESKTOP_LYRICS_FONT_CONFIG: 'pixel-matrix-desktop-lyrics-font-config',
  DESKTOP_LYRICS_OPACITY_PERCENT: 'pixel-matrix-desktop-lyrics-opacity-percent',
  DESKTOP_LYRICS_POSITION_PRESET: 'pixel-matrix-desktop-lyrics-position-preset',
  DESKTOP_LYRICS_POSITION_OFFSET_X: 'pixel-matrix-desktop-lyrics-position-offset-x',
  DESKTOP_LYRICS_POSITION_OFFSET_Y: 'pixel-matrix-desktop-lyrics-position-offset-y',
  DESKTOP_LYRICS_REGION_WIDTH: 'pixel-matrix-desktop-lyrics-region-width',
  DESKTOP_LYRICS_REGION_HEIGHT: 'pixel-matrix-desktop-lyrics-region-height',
  DESKTOP_LYRICS_LYRIC_OFFSET_MS: 'pixel-matrix-desktop-lyrics-lyric-offset-ms',

  // === Main Window Close Behavior ===
  MAIN_WINDOW_CLOSE_BEHAVIOR_MAGNET: 'pixel-matrix-main-window-close-behavior-magnet',
  MAIN_WINDOW_CLOSE_BEHAVIOR_SYSTEM: 'pixel-matrix-main-window-close-behavior-system',

  // === Editor Performance ===
  EDITOR_LOW_PERFORMANCE_MODE: 'pixel-matrix-editor-low-performance-mode',
  EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE: 'pixel-matrix-editor-overlay-pixel-hints-visible',

  // === Render Performance ===
  PERFORMANCE_RUNTIME_PROFILE: 'pixel-matrix-performance-runtime-profile', // 'minimal' | 'balanced' | 'boosted' | 'custom'
  BACKGROUND_RENDER_POLICY: 'pixel-matrix-background-render-policy', // 'full' | 'throttle' | 'pause'

  // === UI Quality ===
  UI_QUALITY_SETTINGS_V1: 'pixel-matrix-ui-quality-settings-v1', // QualitySettingsV1

  // === Music Library Performance ===
  MUSIC_LIBRARY_COVER_MAX_EDGE_PX: 'pixel-matrix-music-library-cover-max-edge-px', // 0 => original image
  MUSIC_LIBRARY_CLOUD_FALLBACK_AUDIT_V1: 'pixel-matrix-music-library-cloud-fallback-audit-v1', // CloudPlaybackQueueAuditEntry[]
  MUSIC_LIBRARY_TRACK_COLUMNS_V1: 'pixel-matrix-music-library-track-columns-v1', // LocalTrackColumnConfig[]
  MUSIC_LIBRARY_BASE_SCHEMA_V1: 'pixel-matrix-music-library-base-schema-v1', // MusicLibraryBaseSchema
  MUSIC_LIBRARY_FIELD_CAPABILITIES_V1:
    'pixel-matrix-music-library-field-capabilities-v1', // MusicLibraryExtensionFieldCapabilityInput[]
  PLATFORM_LOGIN_REGISTRY_V1: 'pixel-matrix-platform-login-registry-v1', // Registered platform login launcher entries
  MUSIC_PLATFORM_ACTIVE_INSTANCE_V1: 'pixel-matrix-music-platform-active-instance-v1', // Shared active music platform instance selection
  PLATFORM_RENDER_SELECTIONS_V1: 'pixel-matrix-platform-render-selections-v1', // Platform entry visibility / render selection state
  PLATFORM_IMPORTED_INSTANCES_V1: 'pixel-matrix-platform-imported-instances-v1', // Imported platform instance registrations
  PLATFORM_PACKS_V1: 'pixel-matrix-platform-packs-v1', // Installed platform packs (manifest + contract + unpacked artifacts)
  PLATFORM_PACK_DEV_BINDINGS_V1: 'pixel-matrix-platform-pack-dev-bindings-v1', // Host-managed platform pack development bindings
  PLATFORM_PACK_DEV_WATCHERS_V1: 'pixel-matrix-platform-pack-dev-watchers-v1', // Host-managed platform pack dev watcher state

  // === Memory Governance ===
  MEMORY_GOVERNANCE_AUTO_ENABLED: 'pixel-matrix-memory-governance-auto-enabled', // boolean
  MEMORY_GOVERNANCE_AUDIT_V1: 'pixel-matrix-memory-governance-audit-v1', // MemoryGovernanceAuditEntry[]
  MEMORY_BASELINE_SAMPLES_V1: 'pixel-matrix-memory-baseline-samples-v1', // MemoryBaselineSample[]
  STARTUP_MEMORY_TRACE_ENABLED: 'pixel-matrix-startup-memory-trace-enabled', // boolean-like debug flag
  STARTUP_MEMORY_TRACE_V1: 'pixel-matrix-startup-memory-trace-v1', // StartupMemoryTraceSession

  // === Background GIF Optimization ===
  BACKGROUND_GIF_IMPORT_MAX_FPS: 'pixel-matrix-background-gif-import-max-fps',
  BACKGROUND_IMPORT_SOFT_LIMIT_IMAGE_MB: 'pixel-matrix-background-import-soft-limit-image-mb', // 0 => disable warning
  BACKGROUND_IMPORT_SOFT_LIMIT_VIDEO_MB: 'pixel-matrix-background-import-soft-limit-video-mb', // 0 => disable warning

} as const;

/**
 * Tauri 浜嬩欢鍚嶇О瀹氫箟
 */
export const TAURI_EVENTS = {
  // Magnet 鐩稿叧
  MAGNET_LIBRARY_UPDATED: 'magnet-library-updated',
  MAGNET_ACTIVATED: 'magnet-activated',
  MAGNET_DEACTIVATED: 'magnet-deactivated',
  MAGNET_SPACES_UPDATED: 'magnet-spaces-updated',
  MAGNET_LAYOUT_STORE_UPDATED: 'magnet-layout-store-updated',
  MAGNET_PLACEMENT_REQUESTED: 'magnet-placement-requested',
  MAGNET_LIBRARY_FOCUS_REQUESTED: 'magnet-library-focus-requested',
  MAGNET_CHROME_OVERRIDE_MODE_UPDATED: 'magnet-chrome-override-mode-updated',
  CREATOR_WINDOW_OPENED: 'creator-window-opened',
  CREATOR_WINDOW_CLOSED: 'creator-window-closed',

  // 鑳屾櫙鐩稿叧
  BACKGROUND_UPDATED: 'background-updated',
  MUSIC_LIBRARY_SYNC_STATUS_UPDATED: 'music-library-sync-status-updated',
  MUSIC_LIBRARY_SCHEMA_CHANGED: 'music-library-schema-changed',
  MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_UPDATED:
    'music-platform-workspace-ownership-updated',

  // Pixel 娓叉煋鐩稿叧
  PIXEL_SHAPE_UPDATED: 'pixel-shape-updated',
  PIXEL_SIZE_UPDATED: 'pixel-size-updated',
  PIXEL_OPACITY_UPDATED: 'pixel-opacity-updated',
  BACKGROUND_RENDER_POLICY_UPDATED: 'background-render-policy-updated',
  UI_QUALITY_SETTINGS_UPDATED: 'ui-quality-settings-updated',

  // 绐楀彛鏁堟灉鐩稿叧
  BACKGROUND_EFFECT_UPDATED: 'background-effect-updated',
  BORDER_EFFECT_UPDATED: 'border-effect-updated',
  BACKGROUND_THEME_COLOR_UPDATED: 'background-theme-color-updated',
  BORDER_THEME_COLOR_UPDATED: 'border-theme-color-updated',

  // 缂栬緫鍣ㄧ浉鍏?
  EDITOR_EXIT: 'editor-exit',
  EDITOR_STYLE_APPLY: 'editor-style-apply',
  EDITOR_LAYOUT_UNDO: 'editor-layout-undo',
  EDITOR_LAYOUT_REDO: 'editor-layout-redo',
  EDITOR_STATE_UPDATED: 'editor-state-updated', // 缂栬緫鍣ㄧ姸鎬佹洿鏂帮紙閫変腑鍖哄煙绛夛級
  EDITOR_WINDOW_HIDDEN: 'editor-window-hidden', // Rust 渚ф嫤鎴?close 骞?hide 鍚庣殑閫氱煡
  EDITOR_WINDOW_SHOWN: 'editor-window-shown', // Rust 渚?show/unminimize 鍚庣殑閫氱煡
  EDITOR_LOW_PERFORMANCE_MODE_UPDATED: 'editor-low-performance-mode-updated',
  EDITOR_OVERLAY_PIXEL_HINTS_UPDATED: 'editor-overlay-pixel-hints-updated',
  ORNAMENTS_UPDATED: 'ornaments-updated',
  ORNAMENTS_EDIT_SESSION_STARTED: 'ornaments-edit-session-started',
  ORNAMENTS_EDIT_SESSION_ENDED: 'ornaments-edit-session-ended',
  ORNAMENTS_SELECTION_CHANGED: 'ornaments-selection-changed',

  // 涓荤獥鍙ｅ彲瑙佹€?
  MAIN_WINDOW_HIDDEN: 'main-window-hidden',
  MAIN_WINDOW_SHOWN: 'main-window-shown',
  MAIN_WINDOW_CLOSE_REQUESTED: 'main-window-close-requested',
  HOST_FILE_OPENED: 'host-file-opened',

  // Plugin windows / VST manager window
  PLUGIN_WINDOW_HIDDEN: 'plugin-window-hidden',
  PLUGIN_WINDOW_SHOWN: 'plugin-window-shown',
  PLUGIN_SHELL_SURFACE_HIDDEN: 'plugin-shell-surface-hidden',
  PLUGIN_SHELL_SURFACE_SHOWN: 'plugin-shell-surface-shown',
  VST_MANAGER_WINDOW_HIDDEN: 'vst-manager-window-hidden',
  VST_MANAGER_WINDOW_SHOWN: 'vst-manager-window-shown',

  // Native Audio
  NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED: 'native-audio-output-device-updated',
  NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED: 'native-audio-output-backend-updated',
  NATIVE_AUDIO_VOLUME_UPDATED: 'native-audio-volume-updated',
  NATIVE_AUDIO_MUTED_UPDATED: 'native-audio-muted-updated',
  NATIVE_AUDIO_PLAY_MODE_UPDATED: 'native-audio-play-mode-updated',
  NATIVE_AUDIO_GAIN_DB_UPDATED: 'native-audio-gain-db-updated',
  NATIVE_AUDIO_INPUT_ID_UPDATED: 'native-audio-input-id-updated',
  NATIVE_AUDIO_DSP_CHAIN_UPDATED: 'native-audio-dsp-chain-updated',
  NATIVE_AUDIO_DSP_GRAPH_UPDATED: 'native-audio-dsp-graph-updated',
  NATIVE_AUDIO_VST_ENABLED_UPDATED: 'native-audio-vst-enabled-updated',
  NATIVE_AUDIO_REPLAYGAIN_SETTINGS_UPDATED: 'native-audio-replaygain-settings-updated',
  NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS_UPDATED: 'native-audio-runtime-control-settings-updated',
  NATIVE_AUDIO_CROSSFADE_SETTINGS_UPDATED: 'native-audio-crossfade-settings-updated',
  NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS_UPDATED: 'native-audio-streaming-buffer-settings-updated',
  NATIVE_AUDIO_ENGINE_POLICY_UPDATED: 'native-audio-engine-policy-updated',
  NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS_UPDATED: 'native-audio-dynamic-src-settings-updated',
  NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE_UPDATED:
    'native-audio-dynamic-src-learning-profile-updated',
  NATIVE_AUDIO_TUNING_AUTO_SETTINGS_UPDATED: 'native-audio-tuning-auto-settings-updated',
  DESKTOP_LYRICS_LAYOUT_CHANGED: 'desktop-lyrics-layout-changed',
  DESKTOP_LYRICS_CONTROLS_CHANGED: 'desktop-lyrics-controls-changed',
  DSP_RACK_LOCATE_NODE: 'dsp-rack-locate-node',
  NAVIGATION_REQUESTED: 'navigation-requested',

  // Theme
  THEME_UPDATED: 'theme-config-updated',

  // Window Pin
  WINDOW_PIN_STATE_UPDATED: 'window-pin-state-updated',


  // i18n
  LOCALE_UPDATED: 'locale-updated',

  // Platform Login
  PLATFORM_LOGIN_REGISTRY_UPDATED: 'platform-login-registry-updated',
  MUSIC_PLATFORM_ACTIVE_INSTANCE_UPDATED: 'music-platform-active-instance-updated',
  PLATFORM_RENDER_SELECTIONS_UPDATED: 'platform-render-selections-updated',
  PLATFORM_IMPORTED_INSTANCES_UPDATED: 'platform-imported-instances-updated',
  PLATFORM_PACKS_UPDATED: 'platform-packs-updated',
  PLATFORM_PACK_DEV_BINDINGS_UPDATED: 'platform-pack-dev-bindings-updated',
  PLATFORM_PACK_DEV_WATCHERS_UPDATED: 'platform-pack-dev-watchers-updated',

  // Extensions
  EXTENSIONS_V2_UPDATED: 'extensions-v2-updated',
  EXTENSIONS_CONFIG_UPDATED: 'extensions-config-updated',
  EXTENSIONS_V2_DEV_SESSIONS_UPDATED: 'extensions-v2-dev-sessions-updated',
  PLUGIN_MAGNET_CREATOR_DRAFT_UPDATED: 'plugin-magnet-creator-draft-updated',

  // Shader Packs (.pmps)
  PMPS_SHADERS_UPDATED: 'pmps-shaders-updated',
  PMPS_MAGNET_SHADER_BINDINGS_UPDATED: 'pmps-magnet-shader-bindings-updated',
  PMPS_UNIFORMS_UPDATED: 'pmps-uniforms-updated',
  PMPS_SHADER_FUSE_UPDATED: 'pmps-shader-fuse-updated',
} as const;

/**
 * 鍙戦€佹暟鎹洿鏂帮紙鍙岄噸鏈哄埗锛歭ocalStorage + Tauri 浜嬩欢锛?
 */
export async function broadcastDataUpdate<T>(
  storageKey: string,
  data: T,
  tauriEvent?: string
): Promise<void> {
  try {
    // 1. 鏇存柊 localStorage
    const serializedPayload = JSON.stringify(data);
    if (serializedPayload === undefined) {
      telemetry.warn('window-communication.broadcast-data.json-empty', {
        fields: {
          storageKey,
          tauriEvent,
        },
      });
      return;
    }

    const budget = inspectBroadcastDataUpdatePayloadBudget(storageKey, serializedPayload);
    if (budget.shouldWarn) {
      telemetry.warn('window-communication.broadcast-data.payload-budget.warning', {
        fields: {
          storageKey,
          tauriEvent,
          bytes: budget.bytes,
          softLimitBytes: budget.softLimitBytes,
          hardLimitBytes: budget.hardLimitBytes,
          softLimitExceeded: budget.softLimitExceeded,
          hardLimitExceeded: budget.hardLimitExceeded,
          reservedHeavyDomain: budget.reservedHeavyDomain,
          matchedReservedHint: budget.matchedReservedHint,
        },
      });
    }

    writeString(storageKey, serializedPayload, { mode: 'sync' });
    const timestamp = Date.now();

    // Current-window notification (fast, no backend dependency)
    emitLocalMessage({ kind: 'data-update', key: storageKey, timestamp });

    // Cross-window notification (fast, no backend dependency)
    broadcastChannelMessage({ kind: 'data-update', key: storageKey, timestamp });

    // 2. 鍙戦€?Tauri 浜嬩欢锛堝鏋滄彁渚涳級
    if (tauriEvent && isTauriRuntime()) {
      recordEmit(tauriEvent);
      void emit(tauriEvent, { timestamp, key: storageKey }).catch((error) => {
        telemetry.error('window-communication.broadcast-data.tauri-emit.failed', {
          message: getErrorMessage(error),
          fields: {
            storageKey,
            tauriEvent,
          },
        });
      });
      debugLog(`Broadcasted: ${storageKey} via ${tauriEvent}`);
    } else {
      debugLog(`Saved to localStorage: ${storageKey}`);
    }
  } catch (error) {
    telemetry.error('window-communication.broadcast-data.failed', {
      message: getErrorMessage(error),
      fields: {
        storageKey,
      },
    });
    // Do not throw: most callers are UI callbacks and may not await/handle rejections.
  }
}

/**
 * 鍙戦€佷俊鍙凤紙鍙Е鍙戜簨浠讹紝涓嶅瓨鍌ㄦ暟鎹級
 */
export async function broadcastSignal(tauriEvent: string): Promise<void> {
  const timestamp = Date.now();
  emitLocalMessage({ kind: 'signal', eventName: tauriEvent, timestamp });
  broadcastChannelMessage({ kind: 'signal', eventName: tauriEvent, timestamp });

  if (!isTauriRuntime()) return;
  try {
    recordEmit(tauriEvent);
    void emit(tauriEvent, { timestamp }).catch((error) => {
      telemetry.error('window-communication.broadcast-signal.tauri-emit.failed', {
        message: getErrorMessage(error),
        fields: {
          tauriEvent,
        },
      });
    });
    debugLog(`Signal broadcasted: ${tauriEvent}`);
  } catch (error) {
    telemetry.error('window-communication.broadcast-signal.failed', {
      message: getErrorMessage(error),
      fields: {
        tauriEvent,
      },
    });
    // Do not throw: signals are best-effort and typically not critical to render paths.
  }
}

/**
 * 浠?localStorage 璇诲彇鏁版嵁
 */
export function readData<T>(storageKey: string): T | null {
  try {
    const data = readString(storageKey);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    telemetry.error('window-communication.read.failed', {
      message: getErrorMessage(error),
      fields: {
        storageKey,
      },
    });
    return null;
  }
}

/**
 * 璁剧疆 localStorage 浜嬩欢鐩戝惉鍣?
 */
export function setupStorageListener(
  keys: string[],
  callback: (key: string, newValue: unknown) => void
): () => void {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    if (!e.key || !keys.includes(e.key)) return;

    if (e.newValue === null) {
      callback(e.key, null);
      return;
    }

    try {
      callback(e.key, JSON.parse(e.newValue));
    } catch {
      callback(e.key, e.newValue);
    }
  };

  window.addEventListener('storage', handleStorageChange);
  return () => window.removeEventListener('storage', handleStorageChange);
}

/**
 * 璁剧疆 Tauri 浜嬩欢鐩戝惉鍣?
 */
export async function setupTauriListener(
  eventName: string,
  callback: () => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  try {
    const unlisten = await listen(eventName, () => {
      debugLog(`Tauri event received: ${eventName}`);
      recordReceive(eventName);
      callback();
    });
    return unlisten;
  } catch (error) {
    telemetry.error('window-communication.listener.setup.failed', {
      message: getErrorMessage(error),
      fields: {
        eventName,
        payload: false,
      },
    });
    return () => {};
  }
}

/**
 * 璁惧畾甯?payload 鐨?Tauri 浜嬩欢鐩戝惉鍣?
 */
export async function setupTauriListenerWithPayload<T>(
  eventName: string,
  callback: (payload: T) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  try {
    const unlisten = await listen<T>(eventName, (event) => {
      debugLog(`Tauri event received: ${eventName}`);
      recordReceive(eventName);
      callback(event.payload);
    });
    return unlisten;
  } catch (error) {
    telemetry.error('window-communication.listener.setup.failed', {
      message: getErrorMessage(error),
      fields: {
        eventName,
        payload: true,
      },
    });
    return () => {};
  }
}

/**
 * 璁剧疆鍙岄噸鐩戝惉鍣紙localStorage + Tauri 浜嬩欢锛?
 */
export async function setupDualListener(
  storageKeys: string[],
  tauriEvents: string[],
  callback: () => void
): Promise<() => void> {
  // 璁剧疆 localStorage 鐩戝惉
  let scheduled = false;
  const run = () => {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(() => {
      scheduled = false;
      try {
        callback();
      } catch (error) {
        telemetry.error('window-communication.callback.failed', {
          message: getErrorMessage(error),
        });
      }
    });
  };

  const unlistenStorage = setupStorageListener(storageKeys, () => {
    debugLog('Storage event triggered, calling callback');
    run();
  });

  // 璁剧疆 Tauri 浜嬩欢鐩戝惉
  const handleLocalComm = (event: Event) => {
    const detail = (event as CustomEvent<WindowCommMessage>).detail;
    if (!detail) return;

    if (detail.kind === 'data-update') {
      if (!storageKeys.includes(detail.key)) return;
      debugLog(`Local comm received: ${detail.key}`);
      run();
      return;
    }

    if (detail.kind === 'signal') {
      if (!tauriEvents.includes(detail.eventName)) return;
      debugLog(`Local comm received: ${detail.eventName}`);
      run();
    }
  };
  window.addEventListener(LOCAL_COMM_EVENT, handleLocalComm as EventListener);

  const channel = getBroadcastChannel();
  const handleBroadcastChannel = (event: MessageEvent) => {
    const detail = event.data as WindowCommMessage | null | undefined;
    if (!detail) return;

    if (detail.kind === 'data-update') {
      if (!storageKeys.includes(detail.key)) return;
      debugLog(`BroadcastChannel received: ${detail.key}`);
      run();
      return;
    }

    if (detail.kind === 'signal') {
      if (!tauriEvents.includes(detail.eventName)) return;
      debugLog(`BroadcastChannel received: ${detail.eventName}`);
      run();
    }
  };
  channel?.addEventListener('message', handleBroadcastChannel as EventListener);

  const tauriUnlisteners: UnlistenFn[] = [];
  for (const eventName of tauriEvents) {
    try {
      const unlisten = await setupTauriListener(eventName, run);
      tauriUnlisteners.push(unlisten);
    } catch (error) {
      telemetry.error('window-communication.listener.group-setup.failed', {
        message: getErrorMessage(error),
        fields: {
          eventName,
        },
      });
    }
  }

  // 杩斿洖缁熶竴鐨勬竻鐞嗗嚱鏁?
  return () => {
    unlistenStorage();
    window.removeEventListener(LOCAL_COMM_EVENT, handleLocalComm as EventListener);
    channel?.removeEventListener('message', handleBroadcastChannel as EventListener);
    tauriUnlisteners.forEach((unlisten) => unlisten());
  };
}

/**
 * 閫氱敤鐨勯厤缃噸鏂板姞杞藉嚱鏁扮被鍨?
 */
export type ConfigReloadFn = () => void;

/**
 * 鍒涘缓閰嶇疆鍚屾 Hook 鐨勫伐鍏峰嚱鏁?
 * 鐢ㄤ簬鍦ㄤ富绐楀彛鍜岀紪杈戝櫒绐楀彛涓鐢ㄧ浉鍚岀殑鍚屾閫昏緫
 */
export async function setupConfigSync(
  storageKeys: string[],
  tauriEvents: string[],
  reloadCallback: ConfigReloadFn
): Promise<() => void> {
  return setupDualListener(storageKeys, tauriEvents, reloadCallback);
}
