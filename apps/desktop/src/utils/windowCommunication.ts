/**
 * 窗口间通信工具
 * 统一管理主窗口和编辑器窗口之间的数据同步
 */

import { emit, listen, UnlistenFn } from '@tauri-apps/api/event';
import { readString, writeJson } from '../modules/storage';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { isTauriRuntime } from './tauriRuntime';

const DEBUG_STORAGE_KEY = 'pixel-matrix-debug-window-comm';
const LOCAL_COMM_EVENT = 'pixel-matrix-window-comm';
const BROADCAST_CHANNEL_NAME = 'pixel-matrix-window-comm';
let debugEnabledCache: boolean | null = null;
const telemetry = getTelemetryLogger('windowing', 'windowCommunication');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * localStorage 数据 key 定义
 */
export const STORAGE_KEYS = {
  // === 配置数据（主要数据源） ===
  CONFIG: 'pixel-matrix-player-config', // 主配置文件（包含 magnet、grid、styleOverride）
  LOCALE: 'pixel-matrix-locale', // UI locale（i18n）
  KEYBINDINGS_USER_V1: 'pixel-matrix-keybindings-user-v1', // 用户自定义快捷键（array, VSCode-like rules）
  // === 运行时数据（辅助/缓存） ===
  MAGNET_SPACES: 'pixel-matrix-magnet-spaces-v1', // Magnet spaces（active space + list）
  MAGNET_SPACE_LAYOUT: 'pixel-matrix-magnet-space-layout-v1', // Per-space magnet layout (active ids + anchors)
  MAGNET_CATALOG: 'pixel-matrix-magnet-catalog-v1', // Global custom magnet catalog (templates only, no per-space layout)
  MAGNET_SPACE_PRESETS: 'pixel-matrix-magnet-space-presets-v1', // Per-space layout presets (web fallback; Tauri uses layout store)
  MAGNET_SPACE_HISTORY: 'pixel-matrix-magnet-space-history-v1', // Per-space layout history (web fallback; Tauri uses layout store)
  MAGNET_PLACEMENT_REQUEST_V1: 'pixel-matrix-magnet-placement-request-v1', // Request placing a magnet into the main matrix (v1)
  MAGNET_LIBRARY_FOCUS_REQUEST_V1: 'pixel-matrix-magnet-library-focus-request-v1', // Request focusing a magnet in the library window (v1)
  MAGNET_CHROME_OVERRIDE_MODE_V1: 'pixel-matrix-magnet-chrome-override-mode-v1', // Global magnet chrome override mode (v1)
  BACKGROUND_SETTINGS: 'pixel-matrix-background-settings', // 背景设置
  BACKGROUND_HISTORY: 'pixel-matrix-background-history', // 背景历史
  IS_MAXIMIZED: 'pixel-matrix-is-maximized', // 窗口最大化状态

  // === Pixel 渲染配置 ===
  PIXEL_SHAPE: 'pixel-matrix-pixel-shape', // Pixel 形状
  PIXEL_SIZE: 'pixel-matrix-pixel-size', // Pixel 尺寸
  PIXEL_OPACITY: 'pixel-matrix-pixel-opacity', // Pixel 透明度

  // === 窗口效果配置 ===
  BACKGROUND_EFFECT: 'pixel-matrix-background-effect', // 背景效果
  BORDER_EFFECT: 'pixel-matrix-border-effect', // 边框效果
  BACKGROUND_THEME_COLOR: 'pixel-matrix-background-theme-color', // 背景效果主题颜色
  BORDER_THEME_COLOR: 'pixel-matrix-border-theme-color', // 边框效果主题颜色

  // === Ornaments (挂件) ===
  ORNAMENTS_V1: 'pixel-matrix-ornaments-v1',
  ORNAMENTS_OVERLAY_EDITING: 'pixel-matrix-ornaments-overlay-editing',
  ORNAMENTS_SELECTED_ID: 'pixel-matrix-ornaments-selected-id',

  // === 编辑器临时数据 ===
  MAGNET_EDITOR_DATA: 'magnet-editor-data', // 编辑中的 Magnet 数据
  MAGNET_EDITOR_MODE: 'magnet-editor-mode', // 编辑模式（create/edit）
  CREATOR_WINDOW_OPEN: 'magnet-creator-window-open', // Creator 窗口是否打开
  EDITOR_STATE: 'pixel-matrix-editor-state', // 编辑器状态（包括选中信息）

  // === Native Audio ===
  NATIVE_AUDIO_OUTPUT_BACKEND: 'pixel-matrix-native-audio-output-backend', // 输出后端 ID（string | null）
  NATIVE_AUDIO_INPUT_ID: 'pixel-matrix-native-audio-input-id', // 输入/解码组件 ID（string | null）
  NATIVE_AUDIO_GAIN_DB: 'pixel-matrix-native-audio-gain-db', // Gain（number，dB）
  NATIVE_AUDIO_DSP_CHAIN: 'pixel-matrix-native-audio-dsp-chain', // DSP chain（array）
  NATIVE_AUDIO_DSP_GRAPH: 'pixel-matrix-native-audio-dsp-graph', // DSP graph（object）
  NATIVE_AUDIO_VST_ENABLED: 'pixel-matrix-native-audio-vst-enabled', // VST enabled（boolean）
  DSP_RACK_LOCATE_NODE: 'pixel-matrix-dsp-rack-locate-node-v1', // DSP Rack 定位/高亮节点（object）
  NAVIGATION_REQUEST: 'pixel-matrix-navigation-request-v1', // 跨窗口导航请求（object）
  NATIVE_AUDIO_REPLAYGAIN_SETTINGS: 'pixel-matrix-native-audio-replaygain-settings', // ReplayGain settings（object）
  NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS:
    'pixel-matrix-native-audio-runtime-control-settings', // Runtime control settings（dynamic fallback / volume debounce）
  NATIVE_AUDIO_CROSSFADE_SETTINGS: 'pixel-matrix-native-audio-crossfade-settings', // Crossfade settings（object）
  NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS: 'pixel-matrix-native-audio-streaming-buffer-settings', // Streaming buffer settings（object）
  NATIVE_AUDIO_ENGINE_POLICY: 'pixel-matrix-native-audio-engine-policy', // Engine policy settings（object）
  NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS: 'pixel-matrix-native-audio-dynamic-src-settings', // Dynamic SRC auto settings（object）
  NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE:
    'pixel-matrix-native-audio-dynamic-src-learning-profile', // Dynamic SRC learned stress profile（object）
  NATIVE_AUDIO_TUNING_AUTO_SETTINGS:
    'pixel-matrix-native-audio-tuning-auto-settings', // Auto tuning controller settings（object）

  // === VST3 ===
  VST_SCAN_SETTINGS: 'pixel-matrix-vst3-scan-settings-v1', // VST3 扫描设置（object，含 scan paths）

  // === Plugins (.pmpm) ===
  PMPM_PLUGINS: 'pixel-matrix-pmpm-plugins', // 已安装插件（manifest + entryCode）
  PMPM_DURABLE_MIGRATION_V1: 'pixel-matrix-pmpm-durable-migration-v1', // durable migration state flag (R3)
  PMPM_DURABLE_MIGRATION_V1_REPORT: 'pixel-matrix-pmpm-durable-migration-v1-report', // migration report (R3)
  PMPM_AUDIT_LOG_V1: 'pixel-matrix-pmpm-audit-log-v1', // plugin governance audit log (R5, ring buffer)
  PMPM_ALLOW_UNSIGNED_PLUGINS: 'pixel-matrix-pmpm-allow-unsigned-plugins', // signature policy (R5)
  PMPM_REQUIRE_TRUSTED_SIGNATURES: 'pixel-matrix-pmpm-require-trusted-signatures', // signature trust policy (R5)
  PMPM_TRUSTED_KEY_IDS_V1: 'pixel-matrix-pmpm-trusted-key-ids-v1', // trusted signing keys (R5)
  PMPM_SANDBOX_RUNTIME_ENABLED: 'pixel-matrix-pmpm-sandbox-runtime-enabled', // sandboxed runtime flag (R5, experimental)
  PMPM_RUNTIME_RESTART_V1: 'pixel-matrix-pmpm-runtime-restart-v1', // runtime restart request (R5)

  // === Shader Packs (.pmps) ===
  PMPS_SHADERS: 'pixel-matrix-pmps-shaders', // 已安装 shader pack（manifest + fragmentCode）
  PMPS_DURABLE_MIGRATION_V1: 'pixel-matrix-pmps-durable-migration-v1', // durable migration state flag (R3)
  PMPS_DURABLE_MIGRATION_V1_REPORT: 'pixel-matrix-pmps-durable-migration-v1-report', // migration report (R3)
  PMPS_MAGNET_SHADER_BINDINGS: 'pixel-matrix-pmps-magnet-shader-bindings', // Magnet -> shader binding
  PMPS_MAGNET_UNIFORMS: 'pixel-matrix-pmps-magnet-uniforms', // Magnet -> shader uniforms overrides
  PMPS_SHADER_FUSE: 'pixel-matrix-pmps-shader-fuse', // shader runtime error fuse

  // === Theme ===
  THEME_CONFIG: 'pixel-matrix-theme-config',

  // === Window Pin ===
  WINDOW_PIN_STATE: 'pixel-matrix-window-pin-state',
  DESKTOP_LYRICS_ENABLED: 'pixel-matrix-desktop-lyrics-enabled',
  DESKTOP_LYRICS_CLICK_THROUGH: 'pixel-matrix-desktop-lyrics-click-through',
  DESKTOP_LYRICS_FONT_SIZE: 'pixel-matrix-desktop-lyrics-font-size',
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

  // === Memory Governance ===
  MEMORY_GOVERNANCE_AUTO_ENABLED: 'pixel-matrix-memory-governance-auto-enabled', // boolean
  MEMORY_GOVERNANCE_AUDIT_V1: 'pixel-matrix-memory-governance-audit-v1', // MemoryGovernanceAuditEntry[]
  MEMORY_BASELINE_SAMPLES_V1: 'pixel-matrix-memory-baseline-samples-v1', // MemoryBaselineSample[]

  // === Background GIF Optimization ===
  BACKGROUND_GIF_IMPORT_MAX_FPS: 'pixel-matrix-background-gif-import-max-fps',
  BACKGROUND_IMPORT_SOFT_LIMIT_IMAGE_MB: 'pixel-matrix-background-import-soft-limit-image-mb', // 0 => disable warning
  BACKGROUND_IMPORT_SOFT_LIMIT_VIDEO_MB: 'pixel-matrix-background-import-soft-limit-video-mb', // 0 => disable warning

} as const;

/**
 * Tauri 事件名称定义
 */
export const TAURI_EVENTS = {
  // Magnet 相关
  MAGNET_LIBRARY_UPDATED: 'magnet-library-updated',
  MAGNET_ACTIVATED: 'magnet-activated',
  MAGNET_DEACTIVATED: 'magnet-deactivated',
  MAGNET_SPACES_UPDATED: 'magnet-spaces-updated',
  MAGNET_LAYOUT_STORE_UPDATED: 'magnet-layout-store-updated',
  MAGNET_PLACEMENT_REQUESTED: 'magnet-placement-requested',
  MAGNET_LIBRARY_FOCUS_REQUESTED: 'magnet-library-focus-requested',
  MAGNET_CHROME_OVERRIDE_MODE_UPDATED: 'magnet-chrome-override-mode-updated',

  // 背景相关
  BACKGROUND_UPDATED: 'background-updated',
  MUSIC_LIBRARY_SYNC_STATUS_UPDATED: 'music-library-sync-status-updated',
  MUSIC_LIBRARY_SCHEMA_CHANGED: 'music-library-schema-changed',

  // Pixel 渲染相关
  PIXEL_SHAPE_UPDATED: 'pixel-shape-updated',
  PIXEL_SIZE_UPDATED: 'pixel-size-updated',
  PIXEL_OPACITY_UPDATED: 'pixel-opacity-updated',
  BACKGROUND_RENDER_POLICY_UPDATED: 'background-render-policy-updated',
  UI_QUALITY_SETTINGS_UPDATED: 'ui-quality-settings-updated',

  // 窗口效果相关
  BACKGROUND_EFFECT_UPDATED: 'background-effect-updated',
  BORDER_EFFECT_UPDATED: 'border-effect-updated',
  BACKGROUND_THEME_COLOR_UPDATED: 'background-theme-color-updated',
  BORDER_THEME_COLOR_UPDATED: 'border-theme-color-updated',

  // 编辑器相关
  EDITOR_EXIT: 'editor-exit',
  EDITOR_STYLE_APPLY: 'editor-style-apply',
  EDITOR_LAYOUT_UNDO: 'editor-layout-undo',
  EDITOR_LAYOUT_REDO: 'editor-layout-redo',
  EDITOR_STATE_UPDATED: 'editor-state-updated', // 编辑器状态更新（选中区域等）
  EDITOR_WINDOW_HIDDEN: 'editor-window-hidden', // Rust 侧拦截 close 并 hide 后的通知
  EDITOR_WINDOW_SHOWN: 'editor-window-shown', // Rust 侧 show/unminimize 后的通知
  EDITOR_LOW_PERFORMANCE_MODE_UPDATED: 'editor-low-performance-mode-updated',
  EDITOR_OVERLAY_PIXEL_HINTS_UPDATED: 'editor-overlay-pixel-hints-updated',
  CREATOR_WINDOW_OPENED: 'creator-window-opened',
  CREATOR_WINDOW_CLOSED: 'creator-window-closed',

  // 主窗口可见性
  MAIN_WINDOW_HIDDEN: 'main-window-hidden',
  MAIN_WINDOW_SHOWN: 'main-window-shown',
  MAIN_WINDOW_CLOSE_REQUESTED: 'main-window-close-requested',

  // Plugin windows / VST manager window
  PLUGIN_WINDOW_HIDDEN: 'plugin-window-hidden',
  PLUGIN_WINDOW_SHOWN: 'plugin-window-shown',
  VST_MANAGER_WINDOW_HIDDEN: 'vst-manager-window-hidden',
  VST_MANAGER_WINDOW_SHOWN: 'vst-manager-window-shown',

  // Native Audio
  NATIVE_AUDIO_OUTPUT_DEVICE_UPDATED: 'native-audio-output-device-updated',
  NATIVE_AUDIO_OUTPUT_BACKEND_UPDATED: 'native-audio-output-backend-updated',
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

  // Ornaments (挂件)
  ORNAMENTS_UPDATED: 'ornaments-updated',
  ORNAMENTS_OVERLAY_EDITING_UPDATED: 'ornaments-overlay-editing-updated',
  ORNAMENTS_SELECTED_ID_UPDATED: 'ornaments-selected-id-updated',

  // i18n
  LOCALE_UPDATED: 'locale-updated',

  // Plugins (.pmpm)
  PMPM_PLUGINS_UPDATED: 'pmpm-plugins-updated',
  PMPM_PLUGIN_CONFIG_UPDATED: 'pmpm-plugin-config-updated',

  // Shader Packs (.pmps)
  PMPS_SHADERS_UPDATED: 'pmps-shaders-updated',
  PMPS_MAGNET_SHADER_BINDINGS_UPDATED: 'pmps-magnet-shader-bindings-updated',
  PMPS_UNIFORMS_UPDATED: 'pmps-uniforms-updated',
  PMPS_SHADER_FUSE_UPDATED: 'pmps-shader-fuse-updated',
} as const;

/**
 * 发送数据更新（双重机制：localStorage + Tauri 事件）
 */
export async function broadcastDataUpdate<T>(
  storageKey: string,
  data: T,
  tauriEvent?: string
): Promise<void> {
  try {
    // 1. 更新 localStorage
    writeJson(storageKey, data, { mode: 'sync' });
    const timestamp = Date.now();

    // Current-window notification (fast, no backend dependency)
    emitLocalMessage({ kind: 'data-update', key: storageKey, timestamp });

    // Cross-window notification (fast, no backend dependency)
    broadcastChannelMessage({ kind: 'data-update', key: storageKey, timestamp });

    // 2. 发送 Tauri 事件（如果提供）
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
 * 发送信号（只触发事件，不存储数据）
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
 * 从 localStorage 读取数据
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
 * 设置 localStorage 事件监听器
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
 * 设置 Tauri 事件监听器
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
 * 设定带 payload 的 Tauri 事件监听器
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
 * 设置双重监听器（localStorage + Tauri 事件）
 */
export async function setupDualListener(
  storageKeys: string[],
  tauriEvents: string[],
  callback: () => void
): Promise<() => void> {
  // 设置 localStorage 监听
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

  // 设置 Tauri 事件监听
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

  // 返回统一的清理函数
  return () => {
    unlistenStorage();
    window.removeEventListener(LOCAL_COMM_EVENT, handleLocalComm as EventListener);
    channel?.removeEventListener('message', handleBroadcastChannel as EventListener);
    tauriUnlisteners.forEach((unlisten) => unlisten());
  };
}

/**
 * 通用的配置重新加载函数类型
 */
export type ConfigReloadFn = () => void;

/**
 * 创建配置同步 Hook 的工具函数
 * 用于在主窗口和编辑器窗口中复用相同的同步逻辑
 */
export async function setupConfigSync(
  storageKeys: string[],
  tauriEvents: string[],
  reloadCallback: ConfigReloadFn
): Promise<() => void> {
  return setupDualListener(storageKeys, tauriEvents, reloadCallback);
}
