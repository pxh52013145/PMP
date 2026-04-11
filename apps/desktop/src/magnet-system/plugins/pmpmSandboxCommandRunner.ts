import type { HostAudioService, HostNavigation, PluginMountApi } from './pluginHostApi';
import { createPluginMountApi } from './pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  quarantinePmpmPlugin,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
} from './pmpm';
import { readVerifiedPmpmPluginEntryCode } from './pmpmRuntime';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import type { CommandsService } from '../../services/commands';
import type { KeybindingsService } from '../../services/keybindings';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeCapabilityRevokeDrillSnapshot,
  buildPmpmRuntimeHealthSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
  buildPmpmViewMountRequestSnapshot,
} from './pmpmRuntimeBridgeSnapshot';
import type {
  PmpmBridgeIncomingMessage,
  PmpmBridgeOutgoingMessage,
} from '@pixel-matrix/plugin-compat-pmpm';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { dispatchPmpmCompatRpcRequest } from './runtime/pmpmCompatCapabilityTransport';
import { createPmpmCompatRuntimeResourceRegistry } from './runtime/pmpmCompatRuntimeResources';

const PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS = 3_000;
const PMPM_SANDBOX_COMMAND_HEARTBEAT_INTERVAL_MS = 1_500;
const PMPM_SANDBOX_COMMAND_UNRESPONSIVE_TIMEOUT_MS = 8_000;

type PmpmCompatCapabilityRevokeDrillMessage = {
  type: 'pmpm:capabilities-revoke';
  requestId: string;
  capabilityIds: string[];
  reason: string;
  dryRun?: boolean;
  traceId?: string;
};

type PmpmCompatCapabilityRevokeAckMessage = {
  frameId: string;
  type: 'pmpm:capabilities-revoke-ack';
  requestId: string;
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  traceId?: string;
};

type FrameMessage = PmpmBridgeIncomingMessage | PmpmCompatCapabilityRevokeAckMessage;
type FramePostMessage =
  | Omit<PmpmBridgeOutgoingMessage, 'frameId'>
  | PmpmCompatCapabilityRevokeDrillMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function buildPmpmSandboxCommandWorkerScript(frameId: string): string {
  const idLiteral = JSON.stringify(frameId);

  return `const FRAME_ID = ${idLiteral};
const pending = new Map();
let rpcSeq = 0;
const CAPABILITY_PROTOCOL_VERSION = '1.0';
let runtime = null;
let permissions = new Set();
let pluginId = '';
let hostLabel = '';
let hostInfo = null;
let runtimeHelloSnapshot = null;
let runtimeInitSnapshot = null;
let runtimeActivateSnapshot = null;
let runtimeHealthSnapshot = null;
let viewMountRequestSnapshot = null;
let runtimeRevokeSnapshot = null;
let runtimeRevokeAckSnapshot = null;
let audioState = null;
let audioSpectrum = null;
let audioSpectrumFramePre = null;
let audioSpectrumFramePost = null;
let configValue = {};
let navigationSnapshot = null;

const audioStateListeners = new Set();
const audioTimeListeners = new Set();
const audioEndedListeners = new Set();
const audioLoadProgressListeners = new Set();
const audioErrorListeners = new Set();
const configListeners = new Set();
const spectrumListeners = new Set();
const spectrumFrameListeners = new Set();
const navigationListeners = new Set();
const hostStreams = new Map();

const post = (msg) => postMessage({ frameId: FRAME_ID, ...msg });
const warnDenied = (capability, action) => {
  try {
    post({ type: 'pmpm:permission-denied', pluginId, hostLabel, capability, action });
  } catch {}
};

const hasPermission = (capability) => {
  if (permissions.has(capability)) return true;
  if (capability.startsWith('net:') && (permissions.has('net:*') || permissions.has('net:all'))) return true;
  for (const granted of permissions) {
    if (typeof granted === 'string' && granted.endsWith('*')) {
      const prefix = granted.slice(0, -1);
      if (prefix && capability.startsWith(prefix)) return true;
    }
  }
  return false;
};

const describeNetTarget = (value) => {
  try {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.url === 'string') return value.url;
  } catch {}
  return '';
};

const denyNetwork = (capability, action) => {
  warnDenied(capability, action);
  throw new Error('Permission denied: ' + capability);
};

// Best-effort network gating for sandboxed plugin commands (deny-by-default).
try {
  const rawFetch = globalThis.fetch;
  if (typeof rawFetch === 'function') {
    globalThis.fetch = (input, init) => {
      if (!hasPermission('net:fetch')) {
        const target = describeNetTarget(input);
        warnDenied('net:fetch', target ? 'fetch(' + target.slice(0, 200) + ')' : 'fetch(...)');
        return Promise.reject(new Error('Permission denied: net:fetch'));
      }
      return rawFetch(input, init);
    };
  }
} catch {}

try {
  const RawWebSocket = globalThis.WebSocket;
  if (typeof RawWebSocket === 'function') {
    const WebSocketProxy = function (url, protocols) {
      if (!hasPermission('net:websocket')) {
        const target = describeNetTarget(url);
        denyNetwork('net:websocket', target ? 'WebSocket(' + target.slice(0, 200) + ')' : 'WebSocket(...)');
      }
      return new RawWebSocket(url, protocols);
    };
    WebSocketProxy.prototype = RawWebSocket.prototype;
    globalThis.WebSocket = WebSocketProxy;
  }
} catch {}

try {
  const RawEventSource = globalThis.EventSource;
  if (typeof RawEventSource === 'function') {
    const EventSourceProxy = function (url, options) {
      if (!hasPermission('net:eventsource')) {
        const target = describeNetTarget(url);
        denyNetwork(
          'net:eventsource',
          target ? 'EventSource(' + target.slice(0, 200) + ')' : 'EventSource(...)'
        );
      }
      return new RawEventSource(url, options);
    };
    EventSourceProxy.prototype = RawEventSource.prototype;
    globalThis.EventSource = EventSourceProxy;
  }
} catch {}

const sendRpc = (method, args = []) => {
  const id = String(++rpcSeq);
  post({ type: 'pmpm:rpc', id, method, args });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
};

const rpcCall = (method, args = []) => sendRpc(method, args);

const capabilityCall = (capabilityId, method, payload, options) => {
  return sendRpc('capability.invoke.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'capability.invoke.request',
      requestId: 'compat:' + String(rpcSeq + 1),
      capabilityId,
      method,
      payload,
    },
  ]).then((response) => {
    const envelope = response && typeof response === 'object' ? response : null;
    if (!envelope || envelope.op !== 'capability.invoke.response') {
      if (options && options.suppressErrors) {
        return options.fallbackValue;
      }
      throw new Error('Invalid capability response');
    }
    if (envelope.ok) {
      return envelope.data;
    }
    if (options && options.suppressErrors) {
      return options.fallbackValue;
    }
    const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
    throw new Error(error && typeof error.message === 'string' ? error.message : 'Capability call failed');
  });
};

const openSessionCall = (capabilityId, method, payload) => {
  return sendRpc('session.open.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'session.open.request',
      requestId: 'session-open:' + String(rpcSeq + 1),
      capabilityId,
      method,
      payload,
    },
  ]).then((response) => {
    const envelope = response && typeof response === 'object' ? response : null;
    if (!envelope || envelope.op !== 'session.open.response') {
      throw new Error('Invalid session.open response');
    }
    if (!envelope.ok) {
      const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
      throw new Error(error && typeof error.message === 'string' ? error.message : 'Session open failed');
    }
    return {
      sessionId: envelope.sessionId,
      providerSessionId: envelope.providerSessionId,
      metadata: envelope.metadata,
    };
  });
};

const closeSessionCall = (capabilityId, sessionId, reason) => {
  return sendRpc('session.close.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'session.close.request',
      requestId: 'session-close:' + String(rpcSeq + 1),
      capabilityId,
      sessionId,
      reason,
    },
  ]).then((response) => {
    const envelope = response && typeof response === 'object' ? response : null;
    if (!envelope || envelope.op !== 'session.close.response') {
      throw new Error('Invalid session.close response');
    }
    if (!envelope.ok) {
      const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
      throw new Error(error && typeof error.message === 'string' ? error.message : 'Session close failed');
    }
  });
};

const cancelCall = (request) => {
  return sendRpc('cancel.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'cancel.request',
      requestId: 'cancel:' + String(rpcSeq + 1),
      ...request,
    },
  ]).then(() => undefined);
};

const disposeCall = (request) => {
  return sendRpc('dispose.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'dispose.request',
      requestId: 'dispose:' + String(rpcSeq + 1),
      ...request,
    },
  ]).then(() => undefined);
};

const ensureHostStreamState = (streamId, defaults) => {
  const id = typeof streamId === 'string' ? streamId : '';
  if (!id) {
    throw new Error('Invalid stream id');
  }
  let state = hostStreams.get(id);
  if (!state) {
    state = {
      streamId: id,
      mode: defaults && defaults.mode ? defaults.mode : 'push',
      transport: defaults && defaults.transport ? defaults.transport : 'inline-json',
      ended: false,
      endEnvelope: null,
      dataListeners: new Set(),
      endListeners: new Set(),
    };
    hostStreams.set(id, state);
  }
  return state;
};

const finalizeHostStream = (streamId, reason, envelope) => {
  const state = hostStreams.get(streamId);
  if (!state || state.ended) return;
  state.ended = true;
  state.endEnvelope = envelope || { streamId, reason };
  for (const cb of Array.from(state.endListeners)) {
    try { cb(reason, state.endEnvelope); } catch {}
  }
  hostStreams.delete(streamId);
};

const openStreamCall = (capabilityId, method, payload) => {
  return sendRpc('stream.open.request', [
    {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      op: 'stream.open.request',
      requestId: 'stream-open:' + String(rpcSeq + 1),
      capabilityId,
      method,
      payload,
    },
  ]).then((response) => {
    const envelope = response && typeof response === 'object' ? response : null;
    if (!envelope || envelope.op !== 'stream.open.response') {
      throw new Error('Invalid stream.open response');
    }
    if (!envelope.ok) {
      const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
      throw new Error(error && typeof error.message === 'string' ? error.message : 'Stream open failed');
    }

    const state = ensureHostStreamState(envelope.streamId, {
      mode: envelope.mode,
      transport: envelope.transport,
    });

    return {
      streamId: state.streamId,
      mode: state.mode,
      transport: state.transport,
      onData: (cb) => {
        if (typeof cb !== 'function') return () => {};
        if (state.ended) return () => {};
        state.dataListeners.add(cb);
        return () => state.dataListeners.delete(cb);
      },
      onEnd: (cb) => {
        if (typeof cb !== 'function') return () => {};
        if (state.ended) {
          try { cb(state.endEnvelope && state.endEnvelope.reason, state.endEnvelope || undefined); } catch {}
          return () => {};
        }
        state.endListeners.add(cb);
        return () => state.endListeners.delete(cb);
      },
      cancel: (reason) => {
        if (state.ended) return Promise.resolve();
        return cancelCall({ streamId: state.streamId, reason });
      },
      dispose: (reason) => {
        if (state.ended) return Promise.resolve();
        return disposeCall({ streamId: state.streamId, reason });
      },
    };
  });
};

const api = {
  host: {
    getInfo: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getInfo()');
        return null;
      }
      return hostInfo;
    },
    listPermissions: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.listPermissions()');
        return [];
      }
      return Array.from(permissions);
    },
    hasPermission: (capability) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.hasPermission(capability)');
        return false;
      }
      return hasPermission(String(capability || ''));
    },
    getRuntimeHelloSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeHelloSnapshot()');
        return null;
      }
      return runtimeHelloSnapshot;
    },
    getRuntimeInitSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeInitSnapshot()');
        return null;
      }
      return runtimeInitSnapshot;
    },
    getRuntimeActivateSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeActivateSnapshot()');
        return null;
      }
      return runtimeActivateSnapshot;
    },
    getRuntimeHealthSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeHealthSnapshot()');
        return null;
      }
      return runtimeHealthSnapshot;
    },
    getViewMountRequestSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getViewMountRequestSnapshot()');
        return null;
      }
      return viewMountRequestSnapshot;
    },
    getRuntimeRevokeSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeRevokeSnapshot()');
        return null;
      }
      return runtimeRevokeSnapshot;
    },
    getRuntimeRevokeAckSnapshot: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.getRuntimeRevokeAckSnapshot()');
        return null;
      }
      return runtimeRevokeAckSnapshot;
    },
    listCapabilities: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.listCapabilities()');
        return Promise.resolve([]);
      }
      return capabilityCall('core.capability-registry', 'list', undefined, {
        suppressErrors: true,
        fallbackValue: [],
      });
    },
    invokeCapability: (capabilityId, method, payload) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.invokeCapability(capabilityId, method, payload)');
        return Promise.resolve(null);
      }
      return rpcCall('host.invokeCapability', [capabilityId, method, payload]);
    },
    openSession: (capabilityId, method, payload) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.openSession(capabilityId, method, payload)');
        return Promise.resolve(null);
      }
      return openSessionCall(capabilityId, method, payload);
    },
    closeSession: (capabilityId, sessionId, reason) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.closeSession(capabilityId, sessionId, reason)');
        return Promise.resolve();
      }
      return closeSessionCall(capabilityId, sessionId, reason);
    },
    openStream: (capabilityId, method, payload) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.openStream(capabilityId, method, payload)');
        return Promise.resolve(null);
      }
      return openStreamCall(capabilityId, method, payload);
    },
  },
  audio: {
    getState: () => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.getState()');
        return null;
      }
      return audioState;
    },
    onStateChange: (cb) => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.onStateChange(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      audioStateListeners.add(cb);
      return () => audioStateListeners.delete(cb);
    },
    onTimeUpdate: (cb) => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.onTimeUpdate(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      audioTimeListeners.add(cb);
      return () => audioTimeListeners.delete(cb);
    },
    onEnded: (cb) => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.onEnded(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      audioEndedListeners.add(cb);
      return () => audioEndedListeners.delete(cb);
    },
    onLoadProgress: (cb) => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.onLoadProgress(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      audioLoadProgressListeners.add(cb);
      return () => audioLoadProgressListeners.delete(cb);
    },
    onError: (cb) => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.onError(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      audioErrorListeners.add(cb);
      return () => audioErrorListeners.delete(cb);
    },
    play: () =>
      capabilityCall('host.pmp.audio-engine.playback', 'play', undefined, {
        suppressErrors: true,
      }),
    pause: () =>
      capabilityCall('host.pmp.audio-engine.playback', 'pause', undefined, {
        suppressErrors: true,
      }),
    stop: () =>
      void capabilityCall('host.pmp.audio-engine.playback', 'stop', undefined, {
        suppressErrors: true,
      }),
    seek: (time) =>
      void capabilityCall('host.pmp.audio-engine.playback', 'seek', { time }, {
        suppressErrors: true,
      }),
    setVolume: (volume) =>
      void capabilityCall('host.pmp.audio-engine.playback', 'setVolume', { volume }, {
        suppressErrors: true,
      }),
    toggleMute: () =>
      void capabilityCall('host.pmp.audio-engine.playback', 'toggleMute', undefined, {
        suppressErrors: true,
      }),
    playNext: () =>
      capabilityCall('host.pmp.audio-engine.playback', 'playNext', undefined, {
        suppressErrors: true,
      }),
    playPrevious: () =>
      capabilityCall('host.pmp.audio-engine.playback', 'playPrevious', undefined, {
        suppressErrors: true,
      }),
    playTrackAtIndex: (index) =>
      capabilityCall('host.pmp.audio-engine.playback', 'playTrackAtIndex', { index }, {
        suppressErrors: true,
      }),
    getPlayMode: () => {
      if (!permissions.has('api:audio-state')) {
        warnDenied('api:audio-state', 'audio.getPlayMode()');
        return null;
      }
      try {
        const mode = audioState && typeof audioState === 'object' ? audioState.playMode : null;
        return typeof mode === 'string' ? mode : null;
      } catch {
        return null;
      }
    },
    setPlayMode: (mode) =>
      void capabilityCall('host.pmp.audio-engine.playback', 'setPlayMode', { mode }, {
        suppressErrors: true,
      }),
    getCover: () =>
      capabilityCall('host.pmp.audio-engine.playback', 'getCover', undefined, {
        suppressErrors: true,
        fallbackValue: null,
      }),
  },
  visualizer: {
    getSpectrum: () => {
      if (!permissions.has('api:audio-visual')) {
        warnDenied('api:audio-visual', 'visualizer.getSpectrum()');
        return null;
      }
      return audioSpectrum;
    },
    getSpectrumFrame: (options) => {
      if (!permissions.has('api:audio-visual')) {
        warnDenied('api:audio-visual', 'visualizer.getSpectrumFrame(options)');
        return null;
      }
      const tap = options && options.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
      return tap === 'pre-dsp' ? audioSpectrumFramePre : audioSpectrumFramePost;
    },
    onSpectrum: (cb) => {
      if (!permissions.has('api:audio-visual')) {
        warnDenied('api:audio-visual', 'visualizer.onSpectrum(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      spectrumListeners.add(cb);
      return () => spectrumListeners.delete(cb);
    },
    onSpectrumFrame: (cb, options) => {
      if (!permissions.has('api:audio-visual')) {
        warnDenied('api:audio-visual', 'visualizer.onSpectrumFrame(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      const tap = options && options.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp';
      const wrapped = (frame) => {
        try {
          if (!frame) return;
          if (tap === 'pre-dsp' && frame.tap === 'pre-dsp') cb(frame);
          if (tap === 'post-dsp' && frame.tap === 'post-dsp') cb(frame);
        } catch {}
      };
      spectrumFrameListeners.add(wrapped);
      return () => spectrumFrameListeners.delete(wrapped);
    },
  },
  navigation: {
    navigateTo: (page, params) =>
      void capabilityCall('host.pmp.navigation', 'navigateTo', { page, params }, {
        suppressErrors: true,
      }),
    goBack: () =>
      void capabilityCall('host.pmp.navigation', 'goBack', undefined, {
        suppressErrors: true,
      }),
    getSnapshot: () => {
      if (!permissions.has('api:navigation')) {
        warnDenied('api:navigation', 'navigation.getSnapshot()');
        return null;
      }
      return navigationSnapshot;
    },
    onChange: (cb) => {
      if (!permissions.has('api:navigation')) {
        warnDenied('api:navigation', 'navigation.onChange(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      navigationListeners.add(cb);
      return () => navigationListeners.delete(cb);
    },
    canGoBack: () => {
      if (!permissions.has('api:navigation')) {
        warnDenied('api:navigation', 'navigation.canGoBack()');
        return false;
      }
      try {
        return Boolean(
          navigationSnapshot &&
            typeof navigationSnapshot.currentIndex === 'number' &&
            navigationSnapshot.currentIndex > 0
        );
      } catch {
        return false;
      }
    },
  },
  config: {
    get: () => {
      if (!permissions.has('storage:local')) {
        warnDenied('storage:local', 'config.get()');
        return {};
      }
      return configValue;
    },
    onChange: (cb) => {
      if (!permissions.has('storage:local')) {
        warnDenied('storage:local', 'config.onChange(cb)');
        return () => {};
      }
      if (typeof cb !== 'function') return () => {};
      configListeners.add(cb);
      return () => configListeners.delete(cb);
    },
    set: (next) =>
      void capabilityCall('host.pmp.storage.config', 'set', { value: next }, {
        suppressErrors: true,
      }),
    patch: (next) =>
      void capabilityCall('host.pmp.storage.config', 'patch', { value: next }, {
        suppressErrors: true,
      }),
    reset: () =>
      void capabilityCall('host.pmp.storage.config', 'reset', undefined, {
        suppressErrors: true,
      }),
  },
  window: {
    open: (windowId, options) =>
      capabilityCall('host.pmp.shell.window', 'open', { windowId, options }, {
        suppressErrors: true,
      }),
    close: (windowId) =>
      capabilityCall('host.pmp.shell.window', 'close', { windowId }, {
        suppressErrors: true,
      }),
  },
};

const pickExport = (mod, name) => {
  if (mod && typeof mod[name] === 'function') return mod[name];
  const def = mod && mod.default && typeof mod.default === 'object' ? mod.default : null;
  if (def && typeof def[name] === 'function') return def[name];
  return null;
};

const runCommandSurface = async (commandId, args) => {
  if (!runtime) throw new Error('runtime not loaded');
  const runCommand = runtime.runCommand;
  if (typeof runCommand !== 'function') {
    throw new Error('Plugin entry must export "runCommand(api, commandId, args?)"');
  }
  if (!commandId) throw new Error('commandId missing');
  const result = runCommand(api, commandId, args);
  if (result && typeof result.then === 'function') {
    await result;
  }
};

addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || data.frameId !== FRAME_ID) return;

  if (data.type === 'pmpm:init') {
    pluginId = String(data.pluginId || '');
    hostLabel = String(data.hostLabel || '');
    hostInfo = data.hostInfo && typeof data.hostInfo === 'object' ? data.hostInfo : null;
    runtimeHelloSnapshot =
      data.runtimeHello && typeof data.runtimeHello === 'object' ? data.runtimeHello : null;
    runtimeInitSnapshot = data.runtimeInit && typeof data.runtimeInit === 'object' ? data.runtimeInit : null;
    runtimeActivateSnapshot =
      data.runtimeActivate && typeof data.runtimeActivate === 'object'
        ? data.runtimeActivate
        : null;
    runtimeHealthSnapshot =
      data.runtimeHealth && typeof data.runtimeHealth === 'object'
        ? data.runtimeHealth
        : null;
    viewMountRequestSnapshot =
      data.viewMountRequest && typeof data.viewMountRequest === 'object'
        ? data.viewMountRequest
        : null;
    const commandId = String(data.surfaceId || '');
    const commandArgs = data.commandArgs;
    permissions = new Set(Array.isArray(data.permissions) ? data.permissions.filter((p) => typeof p === 'string') : []);
    audioState = data.initialAudioState ?? null;
    audioSpectrum = data.initialAudioSpectrum ?? null;
    audioSpectrumFramePre = data.initialAudioSpectrumFramePre ?? null;
    audioSpectrumFramePost = data.initialAudioSpectrumFramePost ?? null;
    configValue = data.initialConfig && typeof data.initialConfig === 'object' ? data.initialConfig : {};
    navigationSnapshot = data.initialNavigation && typeof data.initialNavigation === 'object' ? data.initialNavigation : null;

    try {
      const entryCode = String(data.entryCode || '');
      if (!entryCode) throw new Error('entryCode missing');
      const url = URL.createObjectURL(new Blob([entryCode], { type: 'text/javascript' }));
      try {
        const mod = await import(url);
        runtime = { runCommand: pickExport(mod, 'runCommand') };
      } finally {
        URL.revokeObjectURL(url);
      }

      await runCommandSurface(commandId, commandArgs);
      post({ type: 'pmpm:command-finished', ok: true });
      close();
    } catch (err) {
      post({ type: 'pmpm:error', message: err instanceof Error ? (err.stack || err.message) : String(err) });
      close();
    }
    return;
  }

  if (data.type === 'pmpm:ping') {
    post({ type: 'pmpm:pong', pingId: Number(data.pingId || 0) });
    return;
  }

  if (data.type === 'pmpm:capabilities-revoke') {
    const requestId = typeof data.requestId === 'string' ? data.requestId : 'runtime-capability-revoke:unknown';
    const capabilityIds = Array.isArray(data.capabilityIds)
      ? data.capabilityIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];
    const reason =
      typeof data.reason === 'string' && data.reason.length > 0
        ? data.reason
        : 'compat-drill:no-op';

    runtimeRevokeSnapshot = {
      bridgeVersion:
        runtimeInitSnapshot && typeof runtimeInitSnapshot.bridgeVersion === 'string'
          ? runtimeInitSnapshot.bridgeVersion
          : 'compat.pmpm.bridge.v1',
      op: 'runtime.capabilities.revoke',
      pluginId,
      runtimeId:
        runtimeInitSnapshot && typeof runtimeInitSnapshot.runtimeId === 'string'
          ? runtimeInitSnapshot.runtimeId
          : 'compat.pmpm.main',
      runtimeInstanceId:
        runtimeInitSnapshot && typeof runtimeInitSnapshot.runtimeInstanceId === 'string'
          ? runtimeInitSnapshot.runtimeInstanceId
          : FRAME_ID,
      requestId,
      traceId: typeof data.traceId === 'string' ? data.traceId : undefined,
      capabilityIds,
      reason,
      dryRun: Boolean(data.dryRun),
    };

    runtimeRevokeAckSnapshot = {
      op: 'runtime.capabilities.revoke.ack',
      requestId,
      traceId: runtimeRevokeSnapshot.traceId,
      ok: true,
      ignored: true,
      reason,
    };

    post({
      type: 'pmpm:capabilities-revoke-ack',
      requestId,
      traceId: runtimeRevokeSnapshot.traceId,
      ok: true,
      ignored: true,
      reason,
    });
    return;
  }

  if (data.type === 'pmpm:event') {
    if (data.name === 'protocol.message') {
      const envelope = data.payload && typeof data.payload === 'object' ? data.payload : null;
      const streamId = envelope && typeof envelope.streamId === 'string' ? envelope.streamId : '';
      if (!envelope || !streamId) return;

      if (envelope.op === 'stream.data') {
        const state = hostStreams.get(streamId);
        if (!state || state.ended) return;
        for (const cb of Array.from(state.dataListeners)) {
          try { cb(envelope.payload, envelope); } catch {}
        }
        return;
      }

      if (envelope.op === 'stream.end') {
        finalizeHostStream(streamId, envelope.reason, envelope);
        return;
      }

      return;
    }
    if (data.name === 'audio.state') {
      audioState = data.payload ?? null;
      for (const cb of Array.from(audioStateListeners)) {
        try { cb(audioState); } catch {}
      }
      return;
    }
    if (data.name === 'audio.loadProgress') {
      const progress = typeof data.payload === 'number' ? data.payload : 0;
      for (const cb of Array.from(audioLoadProgressListeners)) {
        try { cb(progress); } catch {}
      }
      return;
    }
    if (data.name === 'audio.error') {
      const message = typeof data.payload === 'string' ? data.payload : String(data.payload || '');
      for (const cb of Array.from(audioErrorListeners)) {
        try { cb(message); } catch {}
      }
      return;
    }
    if (data.name === 'audio.time') {
      const time = typeof data.payload === 'number' ? data.payload : 0;
      for (const cb of Array.from(audioTimeListeners)) {
        try { cb(time); } catch {}
      }
      return;
    }
    if (data.name === 'audio.ended') {
      for (const cb of Array.from(audioEndedListeners)) {
        try { cb(); } catch {}
      }
      return;
    }
    if (data.name === 'config.changed') {
      configValue = data.payload && typeof data.payload === 'object' ? data.payload : {};
      for (const cb of Array.from(configListeners)) {
        try { cb(configValue); } catch {}
      }
      return;
    }
    if (data.name === 'audio.spectrum') {
      audioSpectrum = data.payload ?? null;
      for (const cb of Array.from(spectrumListeners)) {
        try { cb(audioSpectrum); } catch {}
      }
      return;
    }
    if (data.name === 'audio.spectrumFrame.pre') {
      audioSpectrumFramePre = data.payload ?? null;
      for (const cb of Array.from(spectrumFrameListeners)) {
        try { cb(audioSpectrumFramePre); } catch {}
      }
      return;
    }
    if (data.name === 'audio.spectrumFrame.post') {
      audioSpectrumFramePost = data.payload ?? null;
      for (const cb of Array.from(spectrumFrameListeners)) {
        try { cb(audioSpectrumFramePost); } catch {}
      }
      return;
    }
    if (data.name === 'navigation.changed') {
      navigationSnapshot = data.payload && typeof data.payload === 'object' ? data.payload : null;
      for (const cb of Array.from(navigationListeners)) {
        try { cb(navigationSnapshot); } catch {}
      }
      return;
    }
    return;
  }

  if (data.type === 'pmpm:rpc-result') {
    const id = String(data.id || '');
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (data.ok) {
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(String(data.error || 'RPC failed')));
    }
    return;
  }
});

addEventListener('error', (event) => {
  const err = event && (event.error || event.message);
  post({ type: 'pmpm:error', message: err && err.stack ? err.stack : String(err || 'error') });
});

addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  post({ type: 'pmpm:error', message: reason && reason.stack ? reason.stack : String(reason || 'unhandledrejection') });
});

post({ type: 'pmpm:worker-ready' });
`;
}

async function runPmpmSandboxedCommandInWorker(options: {
  pluginId: string;
  commandId: string;
  args?: unknown;
  hostLabel: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs: number;
}): Promise<void> {
  if (typeof Worker === 'undefined') {
    throw new Error('Worker is not supported');
  }

  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const plugin = getInstalledPmpmPlugin(options.pluginId);
  const api: PluginMountApi = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel: options.hostLabel,
    permissions,
    audioService: options.audioService,
    commands: options.commands,
    navigation: options.navigation,
    keybindings: options.keybindings,
  });
  const runtimeResources = createPmpmCompatRuntimeResourceRegistry();

  const entryCode = await readVerifiedPmpmPluginEntryCode(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  const frameId = `${options.pluginId}-worker-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workerUrl = URL.createObjectURL(
    new Blob([buildPmpmSandboxCommandWorkerScript(frameId)], { type: 'text/javascript' })
  );

  const worker = new Worker(workerUrl, {
    type: 'module',
    name: `pmpm:${options.pluginId}:command`,
  });

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let startedAt = Date.now();
    let lastPongAt = Date.now();
    let pingSeq = 0;

    let unlistenConfig: null | (() => void) = null;
    let pingTimer: number | null = null;
    let totalTimer: number | null = null;
    let bootTimer: number | null = null;

    const postToWorker = <T extends FramePostMessage>(message: T) => {
      try {
        worker.postMessage({ frameId, ...message });
      } catch {
        // ignore
      }
    };

    const cleanup = (reason: string) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerError);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (totalTimer !== null) window.clearTimeout(totalTimer);
      if (bootTimer !== null) window.clearTimeout(bootTimer);
      pingTimer = null;
      totalTimer = null;
      bootTimer = null;
      try {
        unlistenConfig?.();
      } catch {
        // ignore
      }
      unlistenConfig = null;
      void runtimeResources.cleanup(reason);
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      try {
        URL.revokeObjectURL(workerUrl);
      } catch {
        // ignore
      }
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup('runtime-command-finished');
      resolve();
    };

    const finishError = (error: unknown, reason = 'runtime-crash') => {
      if (settled) return;
      settled = true;
      cleanup(reason);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const crashAsUnresponsive = (message: string, timeoutMsForAudit: number) => {
      quarantinePmpmPlugin(options.pluginId, {
        surface: 'command',
        message,
        timeoutMs: timeoutMsForAudit,
      });
      finishError(new Error(message), 'runtime-unresponsive');
    };

    const onWorkerError = (event: ErrorEvent) => {
      if (settled) return;
      const message = event?.error?.stack || event?.message || 'Plugin worker error';
      recordPmpmPluginCrash(options.pluginId, message, 'command');
      finishError(new Error(message), 'runtime-crash');
    };

    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (!isRecord(event.data)) return;
      if (event.data.frameId !== frameId) return;

      const data = event.data as FrameMessage;

      if (data.type === 'pmpm:worker-ready') {
        if (bootTimer !== null) window.clearTimeout(bootTimer);
        bootTimer = null;

        startedAt = Date.now();
        lastPongAt = Date.now();

        if (permissions.has('storage:local')) {
          unlistenConfig = subscribePmpmPluginConfig(options.pluginId, (config) => {
            postToWorker({ type: 'pmpm:event', name: 'config.changed', payload: config });
          });
        }

        const pingTimeoutMs = PMPM_SANDBOX_COMMAND_UNRESPONSIVE_TIMEOUT_MS;
        pingTimer = window.setInterval(() => {
          if (settled) return;
          pingSeq += 1;
          postToWorker({ type: 'pmpm:ping', pingId: pingSeq });

          const elapsedSincePong = Date.now() - lastPongAt;
          if (elapsedSincePong < pingTimeoutMs) return;
          crashAsUnresponsive(`Plugin runtime unresponsive (${elapsedSincePong}ms)`, pingTimeoutMs);
        }, PMPM_SANDBOX_COMMAND_HEARTBEAT_INTERVAL_MS);

        totalTimer = window.setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          crashAsUnresponsive(`Plugin command timeout (${elapsed}ms)`, options.timeoutMs);
        }, options.timeoutMs);

        const runtimeInitSnapshot = buildPmpmRuntimeInitSnapshot({
          pluginId: options.pluginId,
          runtimeInstanceId: frameId,
          permissions,
          manifestPermissions: plugin?.manifest.permissions,
          deniedPermissions: plugin?.deniedPermissions,
          startupTimeoutMs: PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS,
          heartbeatIntervalMs: PMPM_SANDBOX_COMMAND_HEARTBEAT_INTERVAL_MS,
          unresponsiveTimeoutMs: PMPM_SANDBOX_COMMAND_UNRESPONSIVE_TIMEOUT_MS,
        });

        const optionalCapabilityIds = runtimeInitSnapshot.grantedCapabilities
          .filter((capability) => capability.mode === 'optional')
          .map((capability) => capability.capabilityId);

        const runtimeRevokeDrillSnapshot = buildPmpmRuntimeCapabilityRevokeDrillSnapshot({
          pluginId: options.pluginId,
          runtimeInstanceId: frameId,
          capabilityIds: optionalCapabilityIds,
          reason: 'compat-drill:no-op',
        });

        postToWorker({
          type: 'pmpm:init',
          pluginId: options.pluginId,
          hostLabel: options.hostLabel,
          runtimeHello: buildPmpmRuntimeHelloSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
            runtimeKind: 'extension-host',
            carrier: 'dedicated-worker',
            supportsViewMount: false,
          }),
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: buildPmpmRuntimeActivateSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
            kind: 'command',
            surfaceId: options.commandId,
            commandArgs: options.args,
          }),
          runtimeHealth: buildPmpmRuntimeHealthSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
          }),
          viewMountRequest:
            buildPmpmViewMountRequestSnapshot({
              pluginId: options.pluginId,
              runtimeInstanceId: frameId,
              kind: 'command',
              surfaceId: options.commandId,
              commandArgs: options.args,
            }) ?? undefined,
          hostInfo: permissions.has('api:host')
            ? {
                pluginId: options.pluginId,
                hostLabel: options.hostLabel,
                hostApiVersion: HOST_API_VERSION,
                appVersion: APP_VERSION,
                runtime: isTauriRuntime() ? 'tauri' : 'web',
              }
            : null,
          surface: 'command',
          surfaceId: options.commandId,
          commandArgs: options.args,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state')
            ? options.audioService.getState()
            : null,
          initialAudioSpectrum: permissions.has('api:audio-visual')
            ? api.visualizer.getSpectrum()
            : null,
          initialAudioSpectrumFramePre:
            permissions.has('api:audio-visual') &&
            typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
              : null,
          initialAudioSpectrumFramePost:
            permissions.has('api:audio-visual') &&
            typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
              : null,
          initialNavigation:
            permissions.has('api:navigation') &&
            typeof options.navigation.getSnapshot === 'function'
              ? options.navigation.getSnapshot()
              : null,
          initialConfig,
        });

        postToWorker({
          type: 'pmpm:capabilities-revoke',
          requestId: runtimeRevokeDrillSnapshot.requestId,
          capabilityIds: [...runtimeRevokeDrillSnapshot.capabilityIds],
          reason: runtimeRevokeDrillSnapshot.reason,
          dryRun: true,
        });
        return;
      }

      if (data.type === 'pmpm:pong') {
        lastPongAt = Date.now();
        return;
      }

      if (data.type === 'pmpm:permission-denied') {
        recordPmpmPermissionDenied({
          pluginId: options.pluginId,
          hostLabel: options.hostLabel,
          capability: data.capability,
          action: data.action,
        });
        return;
      }

      if (data.type === 'pmpm:capabilities-revoke-ack') {
        return;
      }

      if (data.type === 'pmpm:error') {
        recordPmpmPluginCrash(options.pluginId, data.message, 'command');
        finishError(new Error(data.message), 'runtime-crash');
        return;
      }

      if (data.type === 'pmpm:command-finished') {
        finishOk();
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const response = await dispatchPmpmCompatRpcRequest(api, permissions, data, {
            runtimeResources,
            emitProtocolMessage: (message) =>
              postToWorker({ type: 'pmpm:event', name: 'protocol.message', payload: message }),
          });
          postToWorker(response);
        })();
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onWorkerError);

    bootTimer = window.setTimeout(() => {
      if (settled) return;
      quarantinePmpmPlugin(options.pluginId, {
        surface: 'command',
        message: 'Plugin worker boot timeout',
        timeoutMs: PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS,
      });
      finishError(new Error('Plugin worker boot timeout'), 'runtime-crash');
    }, PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS);
  });
}

export async function runPmpmSandboxedCommand(options: {
  pluginId: string;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs?: number;
}): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Sandboxed command requires a browser runtime');
  }

  const hostLabel = options.hostLabel ?? 'PluginCommandSandbox';
  const timeoutMs = Number(options.timeoutMs ?? 20_000);

  try {
    await runPmpmSandboxedCommandInWorker({
      pluginId: options.pluginId,
      commandId: options.commandId,
      args: options.args,
      hostLabel,
      audioService: options.audioService,
      commands: options.commands,
      navigation: options.navigation,
      keybindings: options.keybindings,
      timeoutMs,
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldFallback =
      message.includes('Worker is not supported') ||
      message.includes('Plugin worker boot timeout') ||
      message.includes('window is not defined') ||
      message.includes('document is not defined') ||
      message.includes('navigator is not defined');
    if (!shouldFallback) {
      throw error;
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Sandboxed command requires a browser DOM runtime');
  }

  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const plugin = getInstalledPmpmPlugin(options.pluginId);
  const api: PluginMountApi = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel,
    permissions,
    audioService: options.audioService,
    commands: options.commands,
    navigation: options.navigation,
    keybindings: options.keybindings,
  });
  const runtimeResources = createPmpmCompatRuntimeResourceRegistry();

  const entryCode = await readVerifiedPmpmPluginEntryCode(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  const frameId = `${options.pluginId}-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.title = `pmpm:${options.pluginId}:command`;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.srcdoc = buildPmpmSandboxSrcDoc(frameId);
  document.body.appendChild(iframe);

  const postToFrame = <T extends FramePostMessage>(message: T) => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ frameId, ...message }, '*');
    } catch {
      // ignore
    }
  };

  const pingTimeoutMs = PMPM_SANDBOX_COMMAND_UNRESPONSIVE_TIMEOUT_MS;

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let startedAt = Date.now();
    let lastPongAt = Date.now();
    let pingSeq = 0;

    let unlistenConfig: null | (() => void) = null;
    let pingTimer: number | null = null;
    let totalTimer: number | null = null;
    let bootTimer: number | null = null;

    const cleanup = (reason: string) => {
      window.removeEventListener('message', onMessage);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (totalTimer !== null) window.clearTimeout(totalTimer);
      if (bootTimer !== null) window.clearTimeout(bootTimer);
      pingTimer = null;
      totalTimer = null;
      bootTimer = null;
      try {
        unlistenConfig?.();
      } catch {
        // ignore
      }
      unlistenConfig = null;
      void runtimeResources.cleanup(reason);
      try {
        iframe.remove();
      } catch {
        // ignore
      }
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup('runtime-command-finished');
      resolve();
    };

    const finishError = (error: unknown, reason = 'runtime-crash') => {
      if (settled) return;
      settled = true;
      cleanup(reason);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const crashAsUnresponsive = (message: string, timeoutMsForAudit: number) => {
      quarantinePmpmPlugin(options.pluginId, {
        surface: 'command',
        message,
        timeoutMs: timeoutMsForAudit,
      });
      finishError(new Error(message), 'runtime-unresponsive');
    };

    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (event.source !== iframe.contentWindow) return;
      if (!isRecord(event.data)) return;
      if (event.data.frameId !== frameId) return;

      const data = event.data as FrameMessage;

      if (data.type === 'pmpm:iframe-ready') {
        if (bootTimer !== null) window.clearTimeout(bootTimer);
        bootTimer = null;

        startedAt = Date.now();
        lastPongAt = Date.now();

        if (permissions.has('storage:local')) {
          unlistenConfig = subscribePmpmPluginConfig(options.pluginId, (config) => {
            postToFrame({ type: 'pmpm:event', name: 'config.changed', payload: config });
          });
        }

        pingTimer = window.setInterval(() => {
          if (settled) return;
          pingSeq += 1;
          postToFrame({ type: 'pmpm:ping', pingId: pingSeq });

          const elapsedSincePong = Date.now() - lastPongAt;
          if (elapsedSincePong < pingTimeoutMs) return;
          crashAsUnresponsive(`Plugin runtime unresponsive (${elapsedSincePong}ms)`, pingTimeoutMs);
        }, PMPM_SANDBOX_COMMAND_HEARTBEAT_INTERVAL_MS);

        totalTimer = window.setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          crashAsUnresponsive(`Plugin command timeout (${elapsed}ms)`, timeoutMs);
        }, timeoutMs);

        const runtimeInitSnapshot = buildPmpmRuntimeInitSnapshot({
          pluginId: options.pluginId,
          runtimeInstanceId: frameId,
          permissions,
          manifestPermissions: plugin?.manifest.permissions,
          deniedPermissions: plugin?.deniedPermissions,
          startupTimeoutMs: PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS,
          heartbeatIntervalMs: PMPM_SANDBOX_COMMAND_HEARTBEAT_INTERVAL_MS,
          unresponsiveTimeoutMs: PMPM_SANDBOX_COMMAND_UNRESPONSIVE_TIMEOUT_MS,
        });

        const optionalCapabilityIds = runtimeInitSnapshot.grantedCapabilities
          .filter((capability) => capability.mode === 'optional')
          .map((capability) => capability.capabilityId);

        const runtimeRevokeDrillSnapshot = buildPmpmRuntimeCapabilityRevokeDrillSnapshot({
          pluginId: options.pluginId,
          runtimeInstanceId: frameId,
          capabilityIds: optionalCapabilityIds,
          reason: 'compat-drill:no-op',
        });

        postToFrame({
          type: 'pmpm:init',
          pluginId: options.pluginId,
          hostLabel,
          runtimeHello: buildPmpmRuntimeHelloSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
            runtimeKind: 'webview',
            carrier: 'webview-frame',
            supportsViewMount: false,
          }),
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: buildPmpmRuntimeActivateSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
            kind: 'command',
            surfaceId: options.commandId,
            commandArgs: options.args,
          }),
          runtimeHealth: buildPmpmRuntimeHealthSnapshot({
            pluginId: options.pluginId,
            runtimeInstanceId: frameId,
          }),
          viewMountRequest:
            buildPmpmViewMountRequestSnapshot({
              pluginId: options.pluginId,
              runtimeInstanceId: frameId,
              kind: 'command',
              surfaceId: options.commandId,
              commandArgs: options.args,
            }) ?? undefined,
          hostInfo: permissions.has('api:host')
            ? {
                pluginId: options.pluginId,
                hostLabel,
                hostApiVersion: HOST_API_VERSION,
                appVersion: APP_VERSION,
                runtime: isTauriRuntime() ? 'tauri' : 'web',
              }
            : null,
          surface: 'command',
          surfaceId: options.commandId,
          commandArgs: options.args,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state')
            ? options.audioService.getState()
            : null,
          initialAudioSpectrum: permissions.has('api:audio-visual')
            ? api.visualizer.getSpectrum()
            : null,
          initialAudioSpectrumFramePre:
            permissions.has('api:audio-visual') &&
            typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
              : null,
          initialAudioSpectrumFramePost:
            permissions.has('api:audio-visual') &&
            typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
              : null,
          initialNavigation:
            permissions.has('api:navigation') &&
            typeof options.navigation.getSnapshot === 'function'
              ? options.navigation.getSnapshot()
              : null,
          initialConfig,
        });

        postToFrame({
          type: 'pmpm:capabilities-revoke',
          requestId: runtimeRevokeDrillSnapshot.requestId,
          capabilityIds: [...runtimeRevokeDrillSnapshot.capabilityIds],
          reason: runtimeRevokeDrillSnapshot.reason,
          dryRun: true,
        });
        return;
      }

      if (data.type === 'pmpm:pong') {
        lastPongAt = Date.now();
        return;
      }

      if (data.type === 'pmpm:permission-denied') {
        recordPmpmPermissionDenied({
          pluginId: options.pluginId,
          hostLabel,
          capability: data.capability,
          action: data.action,
        });
        return;
      }

      if (data.type === 'pmpm:capabilities-revoke-ack') {
        return;
      }

      if (data.type === 'pmpm:error') {
        recordPmpmPluginCrash(options.pluginId, data.message, 'command');
        finishError(new Error(data.message), 'runtime-crash');
        return;
      }

      if (data.type === 'pmpm:command-finished') {
        finishOk();
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const response = await dispatchPmpmCompatRpcRequest(api, permissions, data, {
            runtimeResources,
            emitProtocolMessage: (message) =>
              postToFrame({ type: 'pmpm:event', name: 'protocol.message', payload: message }),
          });
          postToFrame(response);
        })();
      }
    };

    window.addEventListener('message', onMessage);

    bootTimer = window.setTimeout(() => {
      if (settled) return;
      quarantinePmpmPlugin(options.pluginId, {
        surface: 'command',
        message: 'Plugin sandbox boot timeout',
        timeoutMs: PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS,
      });
      finishError(new Error('Plugin sandbox boot timeout'), 'runtime-crash');
    }, PMPM_SANDBOX_COMMAND_STARTUP_TIMEOUT_MS);
  });
}
