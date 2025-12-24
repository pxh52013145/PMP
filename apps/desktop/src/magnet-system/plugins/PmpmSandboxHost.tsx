import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { PmpmPluginCrashSurface } from './pmpm';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  getPmpmPluginsRevision,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { createPluginMountApi } from './pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import { readVerifiedPmpmPluginEntryCode } from './pmpmRuntime';

type SandboxSurface =
  | { kind: 'magnet' }
  | { kind: 'settings'; panelId?: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'visualizer'; visualizerId: string }
  | { kind: 'window'; windowId: string };

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

type FrameMessage =
  | { frameId: string; type: 'pmpm:iframe-ready' }
  | { frameId: string; type: 'pmpm:mounted' }
  | { frameId: string; type: 'pmpm:disposed' }
  | { frameId: string; type: 'pmpm:pong'; pingId: number }
  | { frameId: string; type: 'pmpm:error'; message: string }
  | RpcRequest
  | PermissionDeniedMessage;

function buildSandboxSrcDoc(frameId: string): string {
  const idLiteral = JSON.stringify(frameId);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      const FRAME_ID = ${idLiteral};
      const ROOT = document.getElementById('root');
      const pending = new Map();
      let rpcSeq = 0;
      let runtime = null;
      let cleanup = null;
      let mountedKind = null;
      let mountedId = null;

      let permissions = new Set();
      let pluginId = '';
      let hostLabel = '';
      let audioState = null;
      let audioSpectrum = null;
      let configValue = {};

      const audioStateListeners = new Set();
      const audioTimeListeners = new Set();
      const audioEndedListeners = new Set();
      const configListeners = new Set();
      const spectrumListeners = new Set();

      const post = (msg) => parent.postMessage({ frameId: FRAME_ID, ...msg }, '*');
      const warnDenied = (capability, action) => {
        try {
          post({ type: 'pmpm:permission-denied', pluginId, hostLabel, capability, action });
        } catch {}
      };

      const rpcCall = (method, args = []) => {
        const id = String(++rpcSeq);
        post({ type: 'pmpm:rpc', id, method, args });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
      };

      const api = {
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
          play: () => rpcCall('audio.play'),
          pause: () => rpcCall('audio.pause'),
          stop: () => void rpcCall('audio.stop'),
          seek: (time) => void rpcCall('audio.seek', [time]),
          setVolume: (volume) => void rpcCall('audio.setVolume', [volume]),
          toggleMute: () => void rpcCall('audio.toggleMute'),
        },
        visualizer: {
          getSpectrum: () => {
            if (!permissions.has('api:audio-visual')) {
              warnDenied('api:audio-visual', 'visualizer.getSpectrum()');
              return null;
            }
            return audioSpectrum;
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
        },
        navigation: {
          navigateTo: (page, params) => void rpcCall('navigation.navigateTo', [page, params]),
          goBack: () => void rpcCall('navigation.goBack'),
        },
        config: {
          get: () => {
            if (!permissions.has('storage:local')) {
              warnDenied('storage:local', 'config.get()');
              return {};
            }
            return configValue ?? {};
          },
          set: (next) => void rpcCall('config.set', [next]),
          patch: (next) => void rpcCall('config.patch', [next]),
          reset: () => void rpcCall('config.reset'),
          onChange: (cb) => {
            if (!permissions.has('storage:local')) {
              warnDenied('storage:local', 'config.onChange(cb)');
              return () => {};
            }
            if (typeof cb !== 'function') return () => {};
            configListeners.add(cb);
            return () => configListeners.delete(cb);
          },
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

      const runMount = (surface, surfaceId) => {
        if (!runtime) throw new Error('runtime not loaded');
        if (!ROOT) throw new Error('root missing');

        let mount = null;
        if (surface === 'magnet') {
          mount = runtime.mount;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mount(container, api)"');
          cleanup = mount(ROOT, api);
          return;
        }

        if (surface === 'settings') {
          mount = runtime.mountSettings;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountSettings(container, api, panelId?)"');
          cleanup = mount(ROOT, api, surfaceId || undefined);
          return;
        }

        if (surface === 'page') {
          mount = runtime.mountPage;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountPage(container, api, pageId)"');
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        if (surface === 'visualizer') {
          mount = runtime.mountVisualizer;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountVisualizer(container, api, visualizerId)"');
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        if (surface === 'window') {
          mount = runtime.mountWindow;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountWindow(container, api, windowId)"');
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        throw new Error('Unsupported surface');
      };

      const dispose = () => {
        try {
          if (typeof cleanup === 'function') {
            cleanup();
          }
        } catch {}
        cleanup = null;
        try {
          if (ROOT) ROOT.innerHTML = '';
        } catch {}
      };

      window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data || data.frameId !== FRAME_ID) return;

        if (data.type === 'pmpm:init') {
          pluginId = String(data.pluginId || '');
          hostLabel = String(data.hostLabel || '');
          mountedKind = String(data.surface || '');
          mountedId = data.surfaceId == null ? null : String(data.surfaceId);
          permissions = new Set(Array.isArray(data.permissions) ? data.permissions.filter((p) => typeof p === 'string') : []);
          audioState = data.initialAudioState ?? null;
          audioSpectrum = data.initialAudioSpectrum ?? null;
          configValue = data.initialConfig && typeof data.initialConfig === 'object' ? data.initialConfig : {};

          try {
            const entryCode = String(data.entryCode || '');
            if (!entryCode) throw new Error('entryCode missing');
            const url = URL.createObjectURL(new Blob([entryCode], { type: 'text/javascript' }));
            try {
              const mod = await import(url);
              runtime = {
                mount: pickExport(mod, 'mount'),
                unmount: pickExport(mod, 'unmount'),
                mountSettings: pickExport(mod, 'mountSettings'),
                unmountSettings: pickExport(mod, 'unmountSettings'),
                mountPage: pickExport(mod, 'mountPage'),
                unmountPage: pickExport(mod, 'unmountPage'),
                mountVisualizer: pickExport(mod, 'mountVisualizer'),
                unmountVisualizer: pickExport(mod, 'unmountVisualizer'),
                mountWindow: pickExport(mod, 'mountWindow'),
                unmountWindow: pickExport(mod, 'unmountWindow'),
              };
            } finally {
              URL.revokeObjectURL(url);
            }

            runMount(mountedKind, mountedId);
            post({ type: 'pmpm:mounted' });
          } catch (err) {
            post({ type: 'pmpm:error', message: err instanceof Error ? (err.stack || err.message) : String(err) });
          }
          return;
        }

        if (data.type === 'pmpm:dispose') {
          dispose();
          post({ type: 'pmpm:disposed' });
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
        }
      });

      window.addEventListener('error', (event) => {
        post({ type: 'pmpm:error', message: event?.error?.stack || event?.message || 'error' });
      });
      window.addEventListener('unhandledrejection', (event) => {
        post({ type: 'pmpm:error', message: event?.reason?.stack || String(event?.reason || 'unhandledrejection') });
      });

      post({ type: 'pmpm:iframe-ready' });
    </script>
  </body>
</html>`;
}

function resolveCrashSurface(surface: SandboxSurface['kind']): PmpmPluginCrashSurface {
  switch (surface) {
    case 'magnet':
      return 'magnet';
    case 'settings':
      return 'settings';
    case 'page':
      return 'page';
    case 'visualizer':
      return 'visualizer';
    case 'window':
      return 'window';
  }
}

function DisabledPluginNotice({ pluginId }: { pluginId: string }) {
  const plugin = getInstalledPmpmPlugin(pluginId);
  const name = plugin?.manifest.metadata.name ?? pluginId;
  const reason = plugin?.disabledReason;
  const lastError = plugin?.lastError;

  return (
    <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
      <div style={{ fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
        {reason === 'crash' ? 'Plugin disabled (crashed)' : 'Plugin disabled'}
      </div>
      {lastError && <div style={{ fontSize: 11, marginTop: 6, opacity: 0.75 }}>{lastError}</div>}
    </div>
  );
}

export function PmpmSandboxHost({
  pluginId,
  hostLabel,
  ...surface
}: { pluginId: string; hostLabel: string } & SandboxSurface) {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameIdRef = useRef(`${pluginId}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const frameId = frameIdRef.current;

  const [frameReady, setFrameReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const plugin = useMemo(() => {
    void pluginStoreRevision;
    return getInstalledPmpmPlugin(pluginId);
  }, [pluginId, pluginStoreRevision]);

  const enabled = plugin ? (plugin.enabled ?? true) : false;

  const permissions = useMemo(() => {
    void pluginStoreRevision;
    return getPmpmPluginEffectivePermissions(pluginId);
  }, [pluginId, pluginStoreRevision]);

  const hostApi = useMemo(() => {
    return createPluginMountApi({
      pluginId,
      hostLabel,
      permissions,
      audioService,
      navigation,
    });
  }, [audioService, hostLabel, navigation, permissions, pluginId]);

  const surfaceId =
    surface.kind === 'page'
      ? surface.pageId
      : surface.kind === 'visualizer'
        ? surface.visualizerId
        : surface.kind === 'window'
          ? surface.windowId
          : surface.kind === 'settings'
            ? surface.panelId ?? null
            : null;

  const initialConfig = useMemo(() => {
    if (!permissions.has('storage:local')) return {};
    return readPmpmPluginConfig(pluginId);
  }, [permissions, pluginId]);
  const lastPongAtRef = useRef<number>(Date.now());

  const postToFrame = useMemo(() => {
    return (message: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage({ frameId, ...message }, '*');
      } catch {
        // ignore
      }
    };
  }, [frameId]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    setMounted(false);
    setError(null);

    const handler = (event: MessageEvent) => {
      if (disposed) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as FrameMessage;
      if (!data || typeof data !== 'object') return;
      if ((data as { frameId?: unknown }).frameId !== frameId) return;

      if (data.type === 'pmpm:iframe-ready') {
        setFrameReady(true);
        lastPongAtRef.current = Date.now();
        return;
      }

      if (data.type === 'pmpm:mounted') {
        setMounted(true);
        return;
      }

      if (data.type === 'pmpm:error') {
        const message = typeof data.message === 'string' ? data.message : 'Plugin error';
        recordPmpmPluginCrash(pluginId, message, resolveCrashSurface(surface.kind));
        setError(message);
        return;
      }

      if (data.type === 'pmpm:pong') {
        lastPongAtRef.current = Date.now();
        return;
      }

      if (data.type === 'pmpm:permission-denied') {
        recordPmpmPermissionDenied({
          pluginId,
          hostLabel,
          capability: data.capability,
          action: data.action,
        });
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const request = data as RpcRequest;
          const respond = (payload: { ok: boolean; result?: unknown; error?: string }) => {
            postToFrame({
              type: 'pmpm:rpc-result',
              id: request.id,
              ...payload,
            });
          };

          try {
            const args = Array.isArray(request.args) ? request.args : [];
            let result: unknown;
            switch (request.method) {
              case 'audio.play':
                result = await hostApi.audio.play();
                break;
              case 'audio.pause':
                result = await hostApi.audio.pause();
                break;
              case 'audio.stop':
                result = hostApi.audio.stop();
                break;
              case 'audio.seek':
                result = hostApi.audio.seek(args[0] as number);
                break;
              case 'audio.setVolume':
                result = hostApi.audio.setVolume(args[0] as number);
                break;
              case 'audio.toggleMute':
                result = hostApi.audio.toggleMute();
                break;
              case 'navigation.navigateTo':
                result = hostApi.navigation.navigateTo(args[0] as never, args[1] as never);
                break;
              case 'navigation.goBack':
                result = hostApi.navigation.goBack();
                break;
              case 'config.set':
                result = hostApi.config.set(args[0] as never);
                break;
              case 'config.patch':
                result = hostApi.config.patch(args[0] as never);
                break;
              case 'config.reset':
                result = hostApi.config.reset();
                break;
              case 'window.open':
                result = await hostApi.window.open(args[0] as never, args[1] as never);
                break;
              case 'window.close':
                result = await hostApi.window.close(args[0] as never);
                break;
              default:
                throw new Error(`Unsupported RPC method: ${request.method}`);
            }
            respond({ ok: true, result });
          } catch (rpcError) {
            respond({
              ok: false,
              error: rpcError instanceof Error ? rpcError.message : String(rpcError),
            });
          }
        })();
        return;
      }
    };

    window.addEventListener('message', handler);
    return () => {
      disposed = true;
      window.removeEventListener('message', handler);
    };
  }, [enabled, frameId, hostApi, hostLabel, pluginId, postToFrame, surface.kind]);

  useEffect(() => {
    if (!enabled) return;
    if (!frameReady) return;

    let disposed = false;

    const crashSurface = resolveCrashSurface(surface.kind);

    const boot = async () => {
      try {
        const entryCode = await readVerifiedPmpmPluginEntryCode(pluginId);
        if (disposed) return;

        postToFrame({
          type: 'pmpm:init',
          pluginId,
          hostLabel,
          surface: surface.kind,
          surfaceId,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state') ? audioService.getState() : null,
          initialConfig,
        });
      } catch (bootError) {
        if (disposed) return;
        recordPmpmPluginCrash(pluginId, bootError, crashSurface);
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    };

    void boot();

    const allowAudioState = permissions.has('api:audio-state');
    const allowConfig = permissions.has('storage:local');

    const unlistenState = allowAudioState
      ? audioService.onStateChange((state) => {
          postToFrame({ type: 'pmpm:event', name: 'audio.state', payload: state });
        })
      : () => {};
    const unlistenTime = allowAudioState
      ? audioService.onTimeUpdate((time) => {
          postToFrame({ type: 'pmpm:event', name: 'audio.time', payload: time });
        })
      : () => {};
    const unlistenEnded = allowAudioState
      ? audioService.onEnded(() => {
          postToFrame({ type: 'pmpm:event', name: 'audio.ended', payload: null });
        })
      : () => {};

    const unlistenConfig = allowConfig
      ? subscribePmpmPluginConfig(pluginId, (config) => {
          postToFrame({ type: 'pmpm:event', name: 'config.changed', payload: config });
        })
      : () => {};

    let spectrumHandle: number | null = null;
    if (permissions.has('api:audio-visual')) {
      spectrumHandle = window.setInterval(() => {
        try {
          postToFrame({ type: 'pmpm:event', name: 'audio.spectrum', payload: hostApi.visualizer.getSpectrum() });
        } catch {
          // ignore
        }
      }, 33);
    }

    let pingSeq = 0;
    const pingInterval = window.setInterval(() => {
      pingSeq += 1;
      postToFrame({ type: 'pmpm:ping', pingId: pingSeq });

      const elapsed = Date.now() - lastPongAtRef.current;
      const timeoutMs = 8_000;
      if (elapsed < timeoutMs) return;

      recordPmpmAuditEvent({
        type: 'runtime-unresponsive',
        pluginId,
        surface: crashSurface,
        timeoutMs,
      });
      recordPmpmPluginCrash(pluginId, `Plugin runtime unresponsive (${elapsed}ms)`, crashSurface);
    }, 1500);

    return () => {
      disposed = true;
      try {
        unlistenState();
        unlistenTime();
        unlistenEnded();
        unlistenConfig();
      } catch {
        // ignore
      }
      if (spectrumHandle !== null) window.clearInterval(spectrumHandle);
      window.clearInterval(pingInterval);
      postToFrame({ type: 'pmpm:dispose' });
    };
  }, [
    audioService,
    enabled,
    frameReady,
    hostApi,
    hostLabel,
    initialConfig,
    permissions,
    pluginId,
    postToFrame,
    surface.kind,
    surfaceId,
  ]);

  if (!plugin) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Not Installed</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{pluginId}</div>
      </div>
    );
  }

  if (!enabled) {
    return <DisabledPluginNotice pluginId={pluginId} />;
  }

  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Error</div>
        <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{error}</div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title={`pmpm:${pluginId}`}
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
        background: 'transparent',
      }}
      srcDoc={buildSandboxSrcDoc(frameId)}
      data-mounted={mounted ? '1' : '0'}
    />
  );
}
