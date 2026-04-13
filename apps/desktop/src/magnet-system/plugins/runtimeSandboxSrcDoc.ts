export function buildRuntimeSandboxSrcDoc(frameId: string): string {
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
      const CAPABILITY_PROTOCOL_VERSION = '1.0';
      let runtime = null;
      let cleanup = null;
      let mountedKind = null;
      let mountedId = null;
      let mountContext = null;
      let commandArgs = undefined;
      let contentSizeObserver = null;
      let contentMutationObserver = null;
      let contentMeasureFrame = 0;
      let contentMeasureTimeoutA = 0;
      let contentMeasureTimeoutB = 0;
      let lastReportedContentHeight = 0;

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

      const post = (msg) => parent.postMessage({ frameId: FRAME_ID, ...msg }, '*');
      const handleWindowResize = () => {
        queueContentSizeReport();
      };
      const warnDenied = (capability, action) => {
        try {
          post({ type: 'sandbox:permission-denied', pluginId, hostLabel, capability, action });
        } catch {}
      };
      const stopContentSizeObservers = () => {
        if (contentMeasureFrame) {
          cancelAnimationFrame(contentMeasureFrame);
          contentMeasureFrame = 0;
        }
        if (contentMeasureTimeoutA) {
          clearTimeout(contentMeasureTimeoutA);
          contentMeasureTimeoutA = 0;
        }
        if (contentMeasureTimeoutB) {
          clearTimeout(contentMeasureTimeoutB);
          contentMeasureTimeoutB = 0;
        }
        if (contentSizeObserver) {
          try {
            contentSizeObserver.disconnect();
          } catch {}
          contentSizeObserver = null;
        }
        if (contentMutationObserver) {
          try {
            contentMutationObserver.disconnect();
          } catch {}
          contentMutationObserver = null;
        }
        window.removeEventListener('resize', handleWindowResize);
      };
      const reportContentSize = () => {
        contentMeasureFrame = 0;
        if (mountedKind !== 'settings' || !ROOT) return;
        const rootRect = ROOT.getBoundingClientRect();
        const nextHeight = Math.max(
          Math.ceil(rootRect.height),
          Math.ceil(ROOT.scrollHeight || 0),
          Math.ceil(document.body ? document.body.scrollHeight || 0 : 0),
          Math.ceil(document.documentElement ? document.documentElement.scrollHeight || 0 : 0)
        );
        if (nextHeight <= 0 || nextHeight === lastReportedContentHeight) return;
        lastReportedContentHeight = nextHeight;
        post({ type: 'sandbox:content-size', height: nextHeight });
      };
      const queueContentSizeReport = () => {
        if (mountedKind !== 'settings') return;
        if (contentMeasureFrame) return;
        contentMeasureFrame = requestAnimationFrame(reportContentSize);
      };
      const startContentSizeObservers = () => {
        stopContentSizeObservers();
        if (mountedKind !== 'settings' || !ROOT) return;
        lastReportedContentHeight = 0;
        queueContentSizeReport();
        if (typeof ResizeObserver === 'function') {
          contentSizeObserver = new ResizeObserver(() => {
            queueContentSizeReport();
          });
          try {
            contentSizeObserver.observe(ROOT);
            if (document.body) contentSizeObserver.observe(document.body);
            if (document.documentElement) contentSizeObserver.observe(document.documentElement);
          } catch {}
        }
        if (typeof MutationObserver === 'function') {
          contentMutationObserver = new MutationObserver(() => {
            queueContentSizeReport();
          });
          try {
            contentMutationObserver.observe(ROOT, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: true,
            });
          } catch {}
        }
        window.addEventListener('resize', handleWindowResize);
        contentMeasureTimeoutA = setTimeout(() => {
          queueContentSizeReport();
        }, 32);
        contentMeasureTimeoutB = setTimeout(() => {
          queueContentSizeReport();
        }, 180);
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

      const sendRpc = (method, args = []) => {
        const id = String(++rpcSeq);
        post({ type: 'sandbox:rpc', id, method, args });
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
            requestId: 'sandbox:' + String(rpcSeq + 1),
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

        if (surface === 'overlay') {
          mount = runtime.mountOverlay;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountOverlay(container, api, surfaceId)"');
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        if (surface === 'desktop-widget') {
          mount = runtime.mountDesktopWidget;
          if (typeof mount !== 'function') throw new Error('Plugin entry must export "mountDesktopWidget(container, api, surfaceId)"');
          cleanup = mount(ROOT, api, surfaceId);
          return;
        }

        throw new Error('Unsupported surface');
      };

      const dispose = () => {
        stopContentSizeObservers();
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

        if (data.type === 'sandbox:init') {
          pluginId = String(data.pluginId || '');
          hostLabel = String(data.hostLabel || '');
          hostInfo = data.hostInfo && typeof data.hostInfo === 'object' ? data.hostInfo : null;
          runtimeHelloSnapshot =
            data.runtimeHello && typeof data.runtimeHello === 'object' ? data.runtimeHello : null;
          runtimeInitSnapshot =
            data.runtimeInit && typeof data.runtimeInit === 'object' ? data.runtimeInit : null;
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
          mountedKind = String(data.surface || '');
          mountedId = data.surfaceId == null ? null : String(data.surfaceId);
          mountContext = data.mountContext ?? null;
          commandArgs = data.commandArgs;
          permissions = new Set(Array.isArray(data.permissions) ? data.permissions.filter((p) => typeof p === 'string') : []);
          audioState = data.initialAudioState ?? null;
          audioSpectrum = data.initialAudioSpectrum ?? null;
          audioSpectrumFramePre = data.initialAudioSpectrumFramePre ?? null;
          audioSpectrumFramePost = data.initialAudioSpectrumFramePost ?? null;
          configValue = data.initialConfig && typeof data.initialConfig === 'object' ? data.initialConfig : {};
          navigationSnapshot = data.initialNavigation && typeof data.initialNavigation === 'object' ? data.initialNavigation : null;

          try {
            const entryCode = typeof data.entryCode === 'string' ? data.entryCode : '';
            const entryUrl = typeof data.entryUrl === 'string' ? data.entryUrl : '';
            if (!entryCode && !entryUrl) throw new Error('entryCode/entryUrl missing');
            const url = entryCode
              ? URL.createObjectURL(new Blob([entryCode], { type: 'text/javascript' }))
              : entryUrl;
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
                mountOverlay: pickExport(mod, 'mountOverlay'),
                unmountOverlay: pickExport(mod, 'unmountOverlay'),
                mountDesktopWidget: pickExport(mod, 'mountDesktopWidget'),
                unmountDesktopWidget: pickExport(mod, 'unmountDesktopWidget'),
                runCommand: pickExport(mod, 'runCommand'),
              };
            } finally {
              if (entryCode) {
                URL.revokeObjectURL(url);
              }
            }

            await runSurface(mountedKind, mountedId, commandArgs);
            startContentSizeObservers();
            if (mountedKind === 'command') {
              post({ type: 'sandbox:command-finished', ok: true });
              dispose();
              post({ type: 'sandbox:disposed' });
              return;
            }

            post({ type: 'sandbox:mounted' });
          } catch (err) {
            post({
              type: 'sandbox:error',
              message: err instanceof Error ? (err.stack || err.message) : String(err),
            });
          }
          return;
        }

        if (data.type === 'sandbox:dispose') {
          dispose();
          post({ type: 'sandbox:disposed' });
          return;
        }

        if (data.type === 'sandbox:ping') {
          post({ type: 'sandbox:pong', pingId: Number(data.pingId || 0) });
          return;
        }

        if (data.type === 'sandbox:capabilities-revoke') {
          const requestId =
            typeof data.requestId === 'string' ? data.requestId : 'runtime-capability-revoke:unknown';
          const capabilityIds = Array.isArray(data.capabilityIds)
            ? data.capabilityIds.filter((id) => typeof id === 'string' && id.length > 0)
            : [];
          const reason =
            typeof data.reason === 'string' && data.reason.length > 0
              ? data.reason
              : 'sandbox-drill:no-op';

          runtimeRevokeSnapshot = {
            bridgeVersion:
              runtimeInitSnapshot && typeof runtimeInitSnapshot.bridgeVersion === 'string'
                ? runtimeInitSnapshot.bridgeVersion
                : 'pxp.runtime.bridge.v1',
            op: 'runtime.capabilities.revoke',
            pluginId,
            runtimeId:
              runtimeInitSnapshot && typeof runtimeInitSnapshot.runtimeId === 'string'
                ? runtimeInitSnapshot.runtimeId
                : 'pxp.runtime.main',
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
            type: 'sandbox:capabilities-revoke-ack',
            requestId,
            traceId: runtimeRevokeSnapshot.traceId,
            ok: true,
            ignored: true,
            reason,
          });
          return;
        }

        if (data.type === 'sandbox:event') {
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

        if (data.type === 'sandbox:rpc-result') {
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
        post({ type: 'sandbox:error', message: event?.error?.stack || event?.message || 'error' });
      });
      window.addEventListener('unhandledrejection', (event) => {
        post({
          type: 'sandbox:error',
          message: event?.reason?.stack || String(event?.reason || 'unhandledrejection'),
        });
      });

      post({ type: 'sandbox:iframe-ready' });
    </script>
  </body>
</html>`;
}
