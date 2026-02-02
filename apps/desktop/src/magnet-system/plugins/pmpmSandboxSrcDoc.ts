export function buildPmpmSandboxSrcDoc(frameId: string): string {
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
      let mountContext = null;
      let commandArgs = undefined;

      let permissions = new Set();
      let pluginId = '';
      let hostLabel = '';
      let hostInfo = null;
      let audioState = null;
      let audioSpectrum = null;
      let configValue = {};
      let navigationSnapshot = null;

      const audioStateListeners = new Set();
      const audioTimeListeners = new Set();
      const audioEndedListeners = new Set();
      const audioLoadProgressListeners = new Set();
      const audioErrorListeners = new Set();
      const configListeners = new Set();
      const spectrumListeners = new Set();
      const navigationListeners = new Set();

      const post = (msg) => parent.postMessage({ frameId: FRAME_ID, ...msg }, '*');
      const warnDenied = (capability, action) => {
        try {
          post({ type: 'pmpm:permission-denied', pluginId, hostLabel, capability, action });
        } catch {}
      };

      const hasPermission = (capability) => {
        if (permissions.has(capability)) return true;
        if (capability.startsWith('net:') && (permissions.has('net:*') || permissions.has('net:all'))) return true;
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

      // Best-effort network gating for sandboxed plugins (deny-by-default).
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
        const rawXhrOpen = globalThis.XMLHttpRequest?.prototype?.open;
        if (typeof rawXhrOpen === 'function') {
          globalThis.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (!hasPermission('net:fetch')) {
              const target = describeNetTarget(url);
              denyNetwork(
                'net:fetch',
                target
                  ? 'XMLHttpRequest.open(' +
                      String(method || '').slice(0, 16) +
                      ', ' +
                      target.slice(0, 200) +
                      ')'
                  : 'XMLHttpRequest.open(...)'
              );
            }
            return rawXhrOpen.call(this, method, url, ...rest);
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

      try {
        const rawBeacon = globalThis.navigator?.sendBeacon;
        if (typeof rawBeacon === 'function') {
          globalThis.navigator.sendBeacon = (url, data) => {
            if (!hasPermission('net:fetch')) {
              const target = describeNetTarget(url);
              warnDenied(
                'net:fetch',
                target ? 'navigator.sendBeacon(' + target.slice(0, 200) + ')' : 'navigator.sendBeacon(...)'
              );
              return false;
            }
            return rawBeacon.call(globalThis.navigator, url, data);
          };
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
              return Boolean(navigationSnapshot && typeof navigationSnapshot.currentIndex === 'number' && navigationSnapshot.currentIndex > 0);
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

      const runSurface = async (surface, surfaceId, args) => {
        if (!runtime) throw new Error('runtime not loaded');
        if (!ROOT) throw new Error('root missing');

        if (surface === 'command') {
          const runCommand = runtime.runCommand;
          if (typeof runCommand !== 'function') {
            throw new Error('Plugin entry must export "runCommand(api, commandId, args?)"');
          }
          if (!surfaceId) throw new Error('commandId missing');
          const result = runCommand(api, surfaceId, args);
          if (result && typeof result.then === 'function') {
            await result;
          }
          return;
        }

        let mount = null;
        if (surface === 'workbench') {
          mount = runtime.mountWorkbench;
          if (typeof mount !== 'function') {
            throw new Error('Plugin entry must export "mountWorkbench(container, api, workbenchId)"');
          }
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        if (surface === 'magnet') {
          mount = runtime.mount;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mount(container, api)"');
          cleanup = mount(ROOT, api, mountContext);
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
          hostInfo = data.hostInfo && typeof data.hostInfo === 'object' ? data.hostInfo : null;
          mountedKind = String(data.surface || '');
          mountedId = data.surfaceId == null ? null : String(data.surfaceId);
          mountContext = data.mountContext ?? null;
          commandArgs = data.commandArgs;
          permissions = new Set(Array.isArray(data.permissions) ? data.permissions.filter((p) => typeof p === 'string') : []);
          audioState = data.initialAudioState ?? null;
          audioSpectrum = data.initialAudioSpectrum ?? null;
          configValue = data.initialConfig && typeof data.initialConfig === 'object' ? data.initialConfig : {};
          navigationSnapshot = data.initialNavigation && typeof data.initialNavigation === 'object' ? data.initialNavigation : null;

          try {
            const entryCode = String(data.entryCode || '');
            if (!entryCode) throw new Error('entryCode missing');
            const url = URL.createObjectURL(new Blob([entryCode], { type: 'text/javascript' }));
            try {
              const mod = await import(url);
              runtime = {
                mount: pickExport(mod, 'mount'),
                unmount: pickExport(mod, 'unmount'),
                mountWorkbench: pickExport(mod, 'mountWorkbench'),
                unmountWorkbench: pickExport(mod, 'unmountWorkbench'),
                mountSettings: pickExport(mod, 'mountSettings'),
                unmountSettings: pickExport(mod, 'unmountSettings'),
                mountPage: pickExport(mod, 'mountPage'),
                unmountPage: pickExport(mod, 'unmountPage'),
                mountVisualizer: pickExport(mod, 'mountVisualizer'),
                unmountVisualizer: pickExport(mod, 'unmountVisualizer'),
                mountWindow: pickExport(mod, 'mountWindow'),
                unmountWindow: pickExport(mod, 'unmountWindow'),
                runCommand: pickExport(mod, 'runCommand'),
              };
            } finally {
              URL.revokeObjectURL(url);
            }

            await runSurface(mountedKind, mountedId, commandArgs);
            if (mountedKind === 'command') {
              post({ type: 'pmpm:command-finished', ok: true });
              dispose();
              post({ type: 'pmpm:disposed' });
              return;
            }

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
