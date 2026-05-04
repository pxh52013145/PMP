import type {
  DataPlaneKind,
  HostCapabilityError as SharedHostCapabilityError,
  HostCapabilityInfo as SharedHostCapabilityInfo,
  HostCapabilityInvokeContext as SharedHostCapabilityInvokeContext,
  HostCapabilityInvokeRequest as SharedHostCapabilityInvokeRequest,
  HostCapabilityResult as SharedHostCapabilityResult,
  ResourceHandleDescriptor,
} from '@pixel-matrix/plugin-platform-contracts';
import type { NavigationPageData, NavigationPageType } from '../../../contracts/navigation';
import type { PlayMode, Track } from '../../../services/audio';
import type { AudioSpectrumFrame, AudioSpectrumTap } from '../../../services/audio/types';
import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import type { PluginSurfaceSourceKind } from '../../../contracts/pluginSurfaceSource';
import type { DynamicColors } from '../../../utils/dynamicColors';
import type { ShellSurfaceManager } from '../shellSurfaceManager';

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

export type PluginHostCapabilityInfo = SharedHostCapabilityInfo;

export type PluginHostCapabilityInvokeContext = SharedHostCapabilityInvokeContext & {
  aiControl?: PluginHostAiControlBridge;
  audioInputAdapter?: PluginHostAudioInputAdapterBridge;
  audioService?: HostAudioService;
  commands?: CommandsService;
  getCover?: () => Promise<PluginCoverSnapshot | null>;
  keybindings?: KeybindingsService;
  navigation?: HostNavigation;
  configApi?: PluginConfigApi;
  shellSurfaceManager?: ShellSurfaceManager;
  sourceKind?: PluginSurfaceSourceKind;
  trayApi?: PluginHostTrayApi;
  windowApi?: PluginWindowApi;
};

export type PluginHostAiControlBridge = {
  searchTracks: (query: string, limit: number) => Promise<Track[]>;
  enqueueTracks: (
    tracks: Track[],
    options?: { replaceQueue?: boolean }
  ) => { previousQueueSize: number; nextQueueSize: number };
  playQueueIndex: (index: number) => Promise<void>;
};

export type PluginHostAudioInputAdapterBridge = {
  listInputs: () => Promise<string[]> | string[];
  selectInput?: (inputId: string | null) => Promise<unknown> | unknown;
};

export type PluginHostAudioInputAdapterProviderHealthStatus =
  | 'ready'
  | 'degraded'
  | 'offline';

export type PluginHostAudioInputAdapterProviderInfo = {
  id: string;
  name: string;
  version: string;
  protocolVersion: string;
  vendor?: string;
  description?: string;
  experimental?: boolean;
};

export type PluginHostAudioInputAdapterProviderProbeRequest = {
  sourcePath: string;
  preferredInputId?: string | null;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostAudioInputAdapterProviderProbeResult = {
  supported: boolean;
  score?: number;
  inputId?: string;
  reason?: string;
  details?: unknown;
};

export type PluginHostAudioInputAdapterProviderOpenSessionRequest = {
  sourcePath: string;
  preferredInputId?: string | null;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostAudioInputAdapterProviderOpenSessionResult = {
  providerSessionId?: string;
  selectedInputId?: string;
  metadata?: unknown;
};

export type PluginHostAudioInputAdapterProviderCloseSessionRequest = {
  sessionId: string;
  providerSessionId?: string;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostAudioInputAdapterProviderHealth = {
  status: PluginHostAudioInputAdapterProviderHealthStatus;
  message?: string;
};

export type PluginHostAudioInputAdapterProviderRegistration = {
  info: PluginHostAudioInputAdapterProviderInfo;
  probe?: (
    request: PluginHostAudioInputAdapterProviderProbeRequest
  ) => Promise<PluginHostAudioInputAdapterProviderProbeResult> | PluginHostAudioInputAdapterProviderProbeResult;
  openSession: (
    request: PluginHostAudioInputAdapterProviderOpenSessionRequest
  ) => Promise<PluginHostAudioInputAdapterProviderOpenSessionResult> | PluginHostAudioInputAdapterProviderOpenSessionResult;
  closeSession?: (
    request: PluginHostAudioInputAdapterProviderCloseSessionRequest
  ) => Promise<void> | void;
  health?: () => Promise<PluginHostAudioInputAdapterProviderHealth> | PluginHostAudioInputAdapterProviderHealth;
};

export type PluginHostAudioInputAdapterGovernanceOptions = {
  thirdPartyEnabled?: boolean;
  allowedProviderIds?: string[] | null;
  timeoutMs?: number;
  maxOpenSessionsPerPlugin?: number;
  quarantineThreshold?: number;
  quarantineMs?: number;
};

export type PluginHostRuntimeProviderHealthStatus = 'ready' | 'degraded' | 'offline';

export type PluginHostRuntimeProviderInfo = {
  id: string;
  name: string;
  version: string;
  vendor?: string;
  description?: string;
  capabilities: string[];
  experimental?: boolean;
};

export type PluginHostRuntimeProviderInvokeRequest = {
  task: string;
  input: unknown;
  options: Record<string, unknown>;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostRuntimeProviderHealth = {
  status: PluginHostRuntimeProviderHealthStatus;
  message?: string;
};

export type PluginHostRuntimeProviderRegistration = {
  info: PluginHostRuntimeProviderInfo;
  invoke: (request: PluginHostRuntimeProviderInvokeRequest) => Promise<unknown> | unknown;
  health?: () => Promise<PluginHostRuntimeProviderHealth> | PluginHostRuntimeProviderHealth;
};

export type PluginHostDesktopPetProviderInfo = PluginHostRuntimeProviderInfo;
export type PluginHostDesktopPetProviderInvokeRequest = PluginHostRuntimeProviderInvokeRequest;
export type PluginHostDesktopPetProviderHealth = PluginHostRuntimeProviderHealth;
export type PluginHostDesktopPetProviderRegistration = PluginHostRuntimeProviderRegistration;

export type PluginHostVoiceTrainingProviderInfo = PluginHostRuntimeProviderInfo;
export type PluginHostVoiceTrainingProviderInvokeRequest = PluginHostRuntimeProviderInvokeRequest;
export type PluginHostVoiceTrainingProviderHealth = PluginHostRuntimeProviderHealth;
export type PluginHostVoiceTrainingProviderRegistration = PluginHostRuntimeProviderRegistration;

export type PluginHostCapabilityInvokeRequest = Omit<SharedHostCapabilityInvokeRequest, 'context'> & {
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostCapabilityError = SharedHostCapabilityError;

export type PluginHostAiAdapterProviderHealthStatus = 'ready' | 'degraded' | 'offline';

export type PluginHostAiAdapterProviderCapability =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'image-generation'
  | 'audio-transcription'
  | 'audio-synthesis'
  | 'tool-calling'
  | 'streaming';

export type PluginHostAiAdapterProviderInfo = {
  id: string;
  name: string;
  version: string;
  vendor?: string;
  description?: string;
  defaultModel?: string;
  capabilities: PluginHostAiAdapterProviderCapability[];
  experimental?: boolean;
};

export type PluginHostAiAdapterInvokePayload = {
  providerId?: string;
  task: string;
  input?: unknown;
  options?: Record<string, unknown>;
};

export type PluginHostAiAdapterProviderInvokeRequest = {
  task: string;
  input: unknown;
  options: Record<string, unknown>;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostAiAdapterProviderHealth = {
  status: PluginHostAiAdapterProviderHealthStatus;
  message?: string;
};

export type PluginHostAiAdapterProviderRegistration = {
  info: PluginHostAiAdapterProviderInfo;
  invoke: (
    request: PluginHostAiAdapterProviderInvokeRequest
  ) => Promise<unknown> | unknown;
  health?: () => Promise<PluginHostAiAdapterProviderHealth> | PluginHostAiAdapterProviderHealth;
};

export type PluginHostCapabilityResult<T = unknown> = SharedHostCapabilityResult<T>;

export type PluginHostCapabilityHandler = (
  request: PluginHostCapabilityInvokeRequest
) => Promise<unknown> | unknown;

export type PluginHostCapabilityRegistration = PluginHostCapabilityInfo & {
  handler?: PluginHostCapabilityHandler;
};

export type PluginHostSessionOpenResult = {
  sessionId: string;
  providerSessionId?: string;
  metadata?: unknown;
};

export type PluginHostStreamDataEnvelope = {
  protocolVersion?: string;
  requestId?: string;
  capabilityId?: string;
  handleId?: string;
  pluginId?: string;
  runtimeId?: string;
  sessionId?: string;
  streamId: string;
  traceId?: string;
  sequence: number;
  payload?: unknown;
  handles?: ResourceHandleDescriptor[];
};

export type PluginHostStreamEndEnvelope = {
  protocolVersion?: string;
  requestId?: string;
  capabilityId?: string;
  handleId?: string;
  pluginId?: string;
  runtimeId?: string;
  sessionId?: string;
  streamId: string;
  traceId?: string;
  reason?: string;
};

export type PluginHostStreamHandle = {
  streamId: string;
  mode: 'push' | 'pull';
  transport: DataPlaneKind;
  onData: (cb: (payload: unknown, envelope: PluginHostStreamDataEnvelope) => void) => () => void;
  onEnd: (cb: (reason?: string, envelope?: PluginHostStreamEndEnvelope) => void) => () => void;
  cancel: (reason?: string) => Promise<void>;
  dispose: (reason?: string) => Promise<void>;
};

export type PluginHostApi = {
  getInfo: () => PluginHostInfo | null;
  listPermissions: () => string[];
  hasPermission: (capability: string) => boolean;
  listCapabilities: () => Promise<PluginHostCapabilityInfo[]>;
  invokeCapability: (capabilityId: string, method: string, payload?: unknown) => Promise<unknown>;
  openStream: (
    capabilityId: string,
    method: string,
    payload?: unknown
  ) => Promise<PluginHostStreamHandle | null>;
  openSession: (
    capabilityId: string,
    method: string,
    payload?: unknown
  ) => Promise<PluginHostSessionOpenResult | null>;
  closeSession: (capabilityId: string, sessionId: string, reason?: string) => Promise<void>;
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

export type PluginHostTrayApi = {
  supported: boolean;
  getMainWindowVisible: () => Promise<boolean | null> | boolean | null;
  activateItem: (itemId: string) => Promise<void>;
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
  addToQueue?: (track: Track) => void;
  addMultipleToQueue?: (tracks: Track[]) => void;
  clearQueue?: () => void;
  getQueue?: () => Track[];
  getPlayMode?: () => PlayMode;
  setPlayMode?: (mode: PlayMode) => void;
  getFrequencyData?: () => Uint8Array | null;
  getSpectrumFrame?: (tap?: AudioSpectrumTap) => AudioSpectrumFrame | null;
  listAudioInputs?: () => Promise<string[]> | string[];
  selectAudioInput?: (inputId: string | null) => Promise<unknown> | unknown;
};

export type HostNavigation = {
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
  getSnapshot?: () => PluginNavigationSnapshot;
  subscribe?: (cb: (snapshot: PluginNavigationSnapshot) => void) => () => void;
};
