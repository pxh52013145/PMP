import type { NavigationPageData, NavigationPageType } from '../../../contracts/navigation';
import type { PlayMode } from '../../../services/audio';
import type { AudioSpectrumFrame, AudioSpectrumTap } from '../../../services/audio/types';
import type { DynamicColors } from '../../../utils/dynamicColors';

export type PluginCoverSnapshot = {
  url: string;
  colors: DynamicColors;
};

export type PluginHostInfo = {
  pluginId: string;
  hostLabel: string;
  hostApiVersion: string;
  appVersion: string;
  runtime: 'tauri' | 'web';
};

export type PluginHostCapabilityInfo = {
  id: string;
  version: string;
  permission?: string;
  description?: string;
  experimental?: boolean;
};

export type PluginHostCapabilityInvokeContext = {
  pluginId: string;
  hostLabel: string;
  permissions: ReadonlySet<string>;
};

export type PluginHostCapabilityInvokeRequest = {
  method: string;
  payload: unknown;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostCapabilityHandler = (
  request: PluginHostCapabilityInvokeRequest
) => Promise<unknown> | unknown;

export type PluginHostCapabilityRegistration = PluginHostCapabilityInfo & {
  handler?: PluginHostCapabilityHandler;
};

export type PluginHostApi = {
  getInfo: () => PluginHostInfo | null;
  listPermissions: () => string[];
  hasPermission: (capability: string) => boolean;
  listCapabilities: () => Promise<PluginHostCapabilityInfo[]>;
  invokeCapability: (capabilityId: string, method: string, payload?: unknown) => Promise<unknown>;
};

export type PluginAudioApi = {
  getState: () => unknown;
  onStateChange: (cb: (state: unknown) => void) => () => void;
  onTimeUpdate: (cb: (time: number) => void) => () => void;
  onEnded: (cb: () => void) => () => void;
  onLoadProgress: (cb: (progress: number) => void) => () => void;
  onError: (cb: (message: string) => void) => () => void;
  getCover: () => Promise<PluginCoverSnapshot | null>;
  play: () => Promise<void>;
  pause: () => Promise<void> | void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  playTrackAtIndex: (index: number) => Promise<void>;
  getPlayMode: () => string | null;
  setPlayMode: (mode: string) => void;
};

export type PluginVisualizerApi = {
  getSpectrum: () => Uint8Array | null;
  getSpectrumFrame: (options?: { tap?: AudioSpectrumTap }) => AudioSpectrumFrame | null;
  onSpectrum: (
    cb: (bins: Uint8Array | null) => void,
    options?: { intervalMs?: number }
  ) => () => void;
  onSpectrumFrame: (
    cb: (frame: AudioSpectrumFrame | null) => void,
    options?: { tap?: AudioSpectrumTap; intervalMs?: number }
  ) => () => void;
};

export type PluginNavigationSnapshot = {
  currentPage: NavigationPageData;
  history: NavigationPageData[];
  currentIndex: number;
};

export type PluginNavigationApi = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
  getSnapshot: () => PluginNavigationSnapshot | null;
  onChange: (cb: (snapshot: PluginNavigationSnapshot) => void) => () => void;
  canGoBack: () => boolean;
};

export type PluginConfigApi = {
  get: () => Record<string, unknown>;
  set: (next: Record<string, unknown>) => void;
  patch: (next: Record<string, unknown>) => void;
  reset: () => void;
  onChange: (cb: (config: Record<string, unknown>) => void) => () => void;
};

export type PluginWindowApi = {
  open: (
    windowId: string,
    options?: {
      title?: string;
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    }
  ) => Promise<void>;
  close: (windowId: string) => Promise<void>;
};

export type PluginMountApi = {
  host: PluginHostApi;
  audio: PluginAudioApi;
  visualizer: PluginVisualizerApi;
  navigation: PluginNavigationApi;
  config: PluginConfigApi;
  window: PluginWindowApi;
};

export type HostAudioService = {
  getState: () => unknown;
  onStateChange: (cb: (state: unknown) => void) => () => void;
  onTimeUpdate: (cb: (time: number) => void) => () => void;
  onEnded: (cb: () => void) => () => void;
  onLoadProgress?: (cb: (progress: number) => void) => () => void;
  onError?: (cb: (error: unknown) => void) => () => void;
  play: () => Promise<void>;
  pause: () => Promise<void> | void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  playNext?: () => Promise<void>;
  playPrevious?: () => Promise<void>;
  playTrackAtIndex?: (index: number) => Promise<void>;
  getPlayMode?: () => PlayMode;
  setPlayMode?: (mode: PlayMode) => void;
  getFrequencyData?: () => Uint8Array | null;
  getSpectrumFrame?: (tap?: AudioSpectrumTap) => AudioSpectrumFrame | null;
};

export type HostNavigation = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
  getSnapshot?: () => PluginNavigationSnapshot;
  subscribe?: (cb: (snapshot: PluginNavigationSnapshot) => void) => () => void;
};
