import type { HostAudioService, HostNavigation, PluginMountApi } from './pluginHostApi';
import { createPluginMountApi } from './pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import { getPmpmPluginEffectivePermissions, recordPmpmPermissionDenied, recordPmpmPluginCrash } from './pmpm';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import { readVerifiedPmpmPluginEntryCode } from './pmpmRuntime';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import { isTauriRuntime } from '../../utils/tauriRuntime';

type RpcRequest = {
  frameId: string;
  type: 'pmpm:rpc';
  id: string;
  method: string;
  args: unknown[];
};

type PermissionDeniedMessage = {
  frameId: string;
  type: 'pmpm:permission-denied';
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
};

type CommandFinishedMessage = {
  frameId: string;
  type: 'pmpm:command-finished';
  ok: boolean;
};

type FrameMessage =
  | { frameId: string; type: 'pmpm:iframe-ready' }
  | { frameId: string; type: 'pmpm:worker-ready' }
  | { frameId: string; type: 'pmpm:pong'; pingId: number }
  | { frameId: string; type: 'pmpm:error'; message: string }
  | RpcRequest
  | PermissionDeniedMessage
  | CommandFinishedMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

async function runRpc(api: PluginMountApi, request: RpcRequest): Promise<unknown> {
  const args = Array.isArray(request.args) ? request.args : [];
  switch (request.method) {
    case 'host.listCapabilities':
      return await api.host.listCapabilities();
    case 'host.invokeCapability':
      return await api.host.invokeCapability(
        String(args[0] ?? ''),
        String(args[1] ?? ''),
        args[2]
      );
    case 'audio.play':
      return await api.audio.play();
    case 'audio.pause':
      return await api.audio.pause();
    case 'audio.stop':
      return api.audio.stop();
    case 'audio.seek':
      return api.audio.seek(args[0] as number);
    case 'audio.setVolume':
      return api.audio.setVolume(args[0] as number);
    case 'audio.toggleMute':
      return api.audio.toggleMute();
    case 'audio.playNext':
      return await api.audio.playNext();
    case 'audio.playPrevious':
      return await api.audio.playPrevious();
    case 'audio.playTrackAtIndex':
      return await api.audio.playTrackAtIndex(args[0] as number);
    case 'audio.setPlayMode':
      return api.audio.setPlayMode(args[0] as never);
    case 'audio.getCover':
      return await api.audio.getCover();
    case 'navigation.navigateTo':
      return api.navigation.navigateTo(args[0] as never, args[1] as never);
    case 'navigation.goBack':
      return api.navigation.goBack();
    case 'config.set':
      return api.config.set(args[0] as never);
    case 'config.patch':
      return api.config.patch(args[0] as never);
    case 'config.reset':
      return api.config.reset();
    case 'window.open':
      return await api.window.open(args[0] as never, args[1] as never);
    case 'window.close':
      return await api.window.close(args[0] as never);
    default:
      throw new Error(`Unsupported RPC method: ${request.method}`);
  }
}

function buildPmpmSandboxCommandWorkerScript(frameId: string): string {
  const idLiteral = JSON.stringify(frameId);

  return `const FRAME_ID = ${idLiteral};
const pending = new Map();
let rpcSeq = 0;
let runtime = null;
let permissions = new Set();
let pluginId = '';
let hostLabel = '';
let hostInfo = null;
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

const rpcCall = (method, args = []) => {
  const id = String(++rpcSeq);
  post({ type: 'pmpm:rpc', id, method, args });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
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
    listCapabilities: () => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.listCapabilities()');
        return Promise.resolve([]);
      }
      return rpcCall('host.listCapabilities');
    },
    invokeCapability: (capabilityId, method, payload) => {
      if (!permissions.has('api:host')) {
        warnDenied('api:host', 'host.invokeCapability(capabilityId, method, payload)');
        return Promise.resolve(null);
      }
      return rpcCall('host.invokeCapability', [capabilityId, method, payload]);
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
    play: () => rpcCall('audio.play'),
    pause: () => rpcCall('audio.pause'),
    stop: () => void rpcCall('audio.stop'),
    seek: (time) => void rpcCall('audio.seek', [time]),
    setVolume: (volume) => void rpcCall('audio.setVolume', [volume]),
    toggleMute: () => void rpcCall('audio.toggleMute'),
    playNext: () => rpcCall('audio.playNext'),
    playPrevious: () => rpcCall('audio.playPrevious'),
    playTrackAtIndex: (index) => rpcCall('audio.playTrackAtIndex', [index]),
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
    setPlayMode: (mode) => void rpcCall('audio.setPlayMode', [mode]),
    getCover: () => rpcCall('audio.getCover'),
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
    navigateTo: (page, params) => void rpcCall('navigation.navigateTo', [page, params]),
    goBack: () => void rpcCall('navigation.goBack'),
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
    set: (next) => void rpcCall('config.set', [next]),
    patch: (next) => void rpcCall('config.patch', [next]),
    reset: () => void rpcCall('config.reset'),
  },
  window: {
    open: (windowId, options) => rpcCall('window.open', [windowId, options]),
    close: (windowId) => rpcCall('window.close', [windowId]),
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

  if (data.type === 'pmpm:event') {
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
  navigation: HostNavigation;
  timeoutMs: number;
}): Promise<void> {
  if (typeof Worker === 'undefined') {
    throw new Error('Worker is not supported');
  }

  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const api: PluginMountApi = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel: options.hostLabel,
    permissions,
    audioService: options.audioService,
    navigation: options.navigation,
  });

  const entryCode = await readVerifiedPmpmPluginEntryCode(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  const frameId = `${options.pluginId}-worker-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workerUrl = URL.createObjectURL(
    new Blob([buildPmpmSandboxCommandWorkerScript(frameId)], { type: 'text/javascript' })
  );

  const worker = new Worker(workerUrl, { type: 'module', name: `pmpm:${options.pluginId}:command` });

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let startedAt = Date.now();
    let lastPongAt = Date.now();
    let pingSeq = 0;

    let unlistenConfig: null | (() => void) = null;
    let pingTimer: number | null = null;
    let totalTimer: number | null = null;
    let bootTimer: number | null = null;

    const postToWorker = (message: Record<string, unknown>) => {
      try {
        worker.postMessage({ frameId, ...message });
      } catch {
        // ignore
      }
    };

    const cleanup = () => {
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
      cleanup();
      resolve();
    };

    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const crashAsUnresponsive = (message: string, timeoutMsForAudit: number) => {
      try {
        recordPmpmAuditEvent({
          type: 'runtime-unresponsive',
          pluginId: options.pluginId,
          surface: 'command',
          timeoutMs: timeoutMsForAudit,
        });
      } catch {
        // ignore
      }
      recordPmpmPluginCrash(options.pluginId, message, 'command');
      finishError(new Error(message));
    };

    const onWorkerError = (event: ErrorEvent) => {
      if (settled) return;
      const message = event?.error?.stack || event?.message || 'Plugin worker error';
      recordPmpmPluginCrash(options.pluginId, message, 'command');
      finishError(new Error(message));
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

        const pingTimeoutMs = 8_000;
        pingTimer = window.setInterval(() => {
          if (settled) return;
          pingSeq += 1;
          postToWorker({ type: 'pmpm:ping', pingId: pingSeq });

          const elapsedSincePong = Date.now() - lastPongAt;
          if (elapsedSincePong < pingTimeoutMs) return;
          crashAsUnresponsive(`Plugin runtime unresponsive (${elapsedSincePong}ms)`, pingTimeoutMs);
        }, 1500);

        totalTimer = window.setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          crashAsUnresponsive(`Plugin command timeout (${elapsed}ms)`, options.timeoutMs);
        }, options.timeoutMs);

        postToWorker({
          type: 'pmpm:init',
          pluginId: options.pluginId,
          hostLabel: options.hostLabel,
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
          initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
          initialAudioSpectrum: permissions.has('api:audio-visual') ? api.visualizer.getSpectrum() : null,
          initialAudioSpectrumFramePre:
            permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
              : null,
          initialAudioSpectrumFramePost:
            permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
              ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
              : null,
          initialNavigation:
            permissions.has('api:navigation') && typeof options.navigation.getSnapshot === 'function'
              ? options.navigation.getSnapshot()
              : null,
          initialConfig,
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

      if (data.type === 'pmpm:error') {
        recordPmpmPluginCrash(options.pluginId, data.message, 'command');
        finishError(new Error(data.message));
        return;
      }

      if (data.type === 'pmpm:command-finished') {
        finishOk();
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const request = data as RpcRequest;
          try {
            const result = await runRpc(api, request);
            postToWorker({ type: 'pmpm:rpc-result', id: request.id, ok: true, result });
          } catch (rpcError) {
            postToWorker({
              type: 'pmpm:rpc-result',
              id: request.id,
              ok: false,
              error: rpcError instanceof Error ? rpcError.message : String(rpcError),
            });
          }
        })();
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onWorkerError);

    bootTimer = window.setTimeout(() => {
      if (settled) return;
      recordPmpmPluginCrash(options.pluginId, 'Plugin worker boot timeout', 'command');
      finishError(new Error('Plugin worker boot timeout'));
    }, 3000);
  });
}

export async function runPmpmSandboxedCommand(options: {
  pluginId: string;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  navigation: HostNavigation;
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
      navigation: options.navigation,
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
  const api: PluginMountApi = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel,
    permissions,
    audioService: options.audioService,
    navigation: options.navigation,
  });

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

  const postToFrame = (message: Record<string, unknown>) => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ frameId, ...message }, '*');
    } catch {
      // ignore
    }
  };

  const pingTimeoutMs = 8_000;

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let startedAt = Date.now();
    let lastPongAt = Date.now();
    let pingSeq = 0;

    let unlistenConfig: null | (() => void) = null;
    let pingTimer: number | null = null;
    let totalTimer: number | null = null;
    let bootTimer: number | null = null;

    const cleanup = () => {
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
      try {
        iframe.remove();
      } catch {
        // ignore
      }
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const crashAsUnresponsive = (message: string, timeoutMsForAudit: number) => {
      try {
        recordPmpmAuditEvent({
          type: 'runtime-unresponsive',
          pluginId: options.pluginId,
          surface: 'command',
          timeoutMs: timeoutMsForAudit,
        });
      } catch {
        // ignore
      }
      recordPmpmPluginCrash(options.pluginId, message, 'command');
      finishError(new Error(message));
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
          crashAsUnresponsive(
            `Plugin runtime unresponsive (${elapsedSincePong}ms)`,
            pingTimeoutMs
          );
        }, 1500);

        totalTimer = window.setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          crashAsUnresponsive(`Plugin command timeout (${elapsed}ms)`, timeoutMs);
        }, timeoutMs);

    postToFrame({
      type: 'pmpm:init',
      pluginId: options.pluginId,
      hostLabel,
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
      initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
      initialAudioSpectrum: permissions.has('api:audio-visual') ? api.visualizer.getSpectrum() : null,
      initialAudioSpectrumFramePre:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
          : null,
      initialAudioSpectrumFramePost:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
          : null,
      initialNavigation:
        permissions.has('api:navigation') && typeof options.navigation.getSnapshot === 'function'
          ? options.navigation.getSnapshot()
          : null,
      initialConfig,
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

      if (data.type === 'pmpm:error') {
        recordPmpmPluginCrash(options.pluginId, data.message, 'command');
        finishError(new Error(data.message));
        return;
      }

      if (data.type === 'pmpm:command-finished') {
        finishOk();
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const request = data as RpcRequest;
          const respond = (payload: { ok: boolean; result?: unknown; error?: string }) => {
            postToFrame({ type: 'pmpm:rpc-result', id: request.id, ...payload });
          };

          try {
            const result = await runRpc(api, request);
            respond({ ok: true, result });
          } catch (rpcError) {
            respond({
              ok: false,
              error: rpcError instanceof Error ? rpcError.message : String(rpcError),
            });
          }
        })();
      }
    };

    window.addEventListener('message', onMessage);

    bootTimer = window.setTimeout(() => {
      if (settled) return;
      recordPmpmPluginCrash(options.pluginId, 'Plugin sandbox boot timeout', 'command');
      finishError(new Error('Plugin sandbox boot timeout'));
    }, 3000);
  });
}
