import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import type { PmpmPluginCrashSurface } from './pmpm';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  getPmpmPluginsRevision,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { createPluginMountApi, type PluginNavigationSnapshot } from './pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import { readVerifiedPmpmPluginEntryCode } from './pmpmRuntime';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';
import { usePmpmRuntimeRestartToken } from './usePmpmRuntimeRestartToken';

type SandboxSurface =
  | { kind: 'workbench'; workbenchId: string }
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

function resolveCrashSurface(surface: SandboxSurface['kind']): PmpmPluginCrashSurface {
  switch (surface) {
    case 'workbench':
      return 'workbench';
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
        {reason === 'crash'
          ? 'Plugin disabled (crashed)'
          : reason === 'policy'
            ? 'Plugin disabled (policy)'
            : 'Plugin disabled'}
      </div>
      {lastError && <div style={{ fontSize: 11, marginTop: 6, opacity: 0.75 }}>{lastError}</div>}
    </div>
  );
}

export function PmpmSandboxHost({
  pluginId,
  hostLabel,
  mountContext,
  ...surface
}: { pluginId: string; hostLabel: string; mountContext?: unknown } & SandboxSurface) {
  const kernel = useKernel();
  const audioService = useAudioService();
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const restartToken = usePmpmRuntimeRestartToken(pluginId);
  const frameId = useMemo(() => {
    return `${pluginId}-${restartToken}-${Math.random().toString(16).slice(2)}`;
  }, [pluginId, restartToken]);

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

  const navigation = useMemo(() => {
    return {
      navigateTo: (page: Parameters<typeof navigationService.navigateTo>[0], params?: Record<string, unknown>) =>
        navigationService.navigateTo(page, params),
      goBack: () => navigationService.goBack(),
      getSnapshot: () => navigationService.getSnapshot(),
      subscribe: (cb: (snapshot: PluginNavigationSnapshot) => void) =>
        kernel.events.on('navigation/changed', (payload) => cb(payload as PluginNavigationSnapshot)),
    };
  }, [kernel.events, navigationService]);

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
    surface.kind === 'workbench'
      ? surface.workbenchId
      : surface.kind === 'page'
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

  const initialNavigation = useMemo(() => {
    if (!permissions.has('api:navigation')) return null;
    try {
      return navigationService.getSnapshot();
    } catch {
      return null;
    }
  }, [navigationService, permissions]);

  const hostInfo = useMemo(() => {
    if (!permissions.has('api:host')) return null;
    return {
      pluginId,
      hostLabel,
      hostApiVersion: HOST_API_VERSION,
      appVersion: APP_VERSION,
      runtime: isTauriRuntime() ? 'tauri' : 'web',
    };
  }, [hostLabel, permissions, pluginId]);

  const lastPongAtRef = useRef<number>(Date.now());
  const frameReadyRef = useRef(false);
  const crashReportedRef = useRef(false);

  useEffect(() => {
    setFrameReady(false);
    setMounted(false);
    setError(null);
    lastPongAtRef.current = Date.now();
    frameReadyRef.current = false;
    crashReportedRef.current = false;
  }, [frameId]);

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
        frameReadyRef.current = true;
        lastPongAtRef.current = Date.now();
        return;
      }

      if (data.type === 'pmpm:mounted') {
        setMounted(true);
        return;
      }

      if (data.type === 'pmpm:error') {
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
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
              case 'audio.playNext':
                result = await hostApi.audio.playNext();
                break;
              case 'audio.playPrevious':
                result = await hostApi.audio.playPrevious();
                break;
              case 'audio.playTrackAtIndex':
                result = await hostApi.audio.playTrackAtIndex(args[0] as number);
                break;
              case 'audio.setPlayMode':
                result = hostApi.audio.setPlayMode(args[0] as never);
                break;
              case 'audio.getCover':
                result = await hostApi.audio.getCover();
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

    const bootTimeoutMs = 5_000;
    const bootTimer = window.setTimeout(() => {
      if (disposed) return;
      if (frameReadyRef.current) return;
      if (crashReportedRef.current) return;
      crashReportedRef.current = true;
      recordPmpmPluginCrash(pluginId, 'Plugin sandbox boot timeout', resolveCrashSurface(surface.kind));
    }, bootTimeoutMs);
    return () => {
      disposed = true;
      window.removeEventListener('message', handler);
      window.clearTimeout(bootTimer);
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
          hostInfo,
          surface: surface.kind,
          surfaceId,
          mountContext,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state') ? audioService.getState() : null,
          initialAudioSpectrum: permissions.has('api:audio-visual') ? hostApi.visualizer.getSpectrum() : null,
          initialAudioSpectrumFramePre:
            permissions.has('api:audio-visual') &&
            typeof hostApi.visualizer.getSpectrumFrame === 'function'
              ? hostApi.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
              : null,
          initialAudioSpectrumFramePost:
            permissions.has('api:audio-visual') &&
            typeof hostApi.visualizer.getSpectrumFrame === 'function'
              ? hostApi.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
              : null,
          initialNavigation,
          initialConfig,
        });
      } catch (bootError) {
        if (disposed) return;
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        recordPmpmPluginCrash(pluginId, bootError, crashSurface);
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    };

    void boot();

    const allowAudioState = permissions.has('api:audio-state');
    const allowConfig = permissions.has('storage:local');
    const allowNavigation = permissions.has('api:navigation');

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

    const unlistenLoadProgress = allowAudioState
      ? audioService.onLoadProgress((progress) => {
          postToFrame({ type: 'pmpm:event', name: 'audio.loadProgress', payload: progress });
        })
      : () => {};

    const unlistenError = allowAudioState
      ? audioService.onError((err) => {
          const message = err instanceof Error ? err.message : String(err);
          postToFrame({ type: 'pmpm:event', name: 'audio.error', payload: message });
        })
      : () => {};

    const unlistenConfig = allowConfig
      ? subscribePmpmPluginConfig(pluginId, (config) => {
          postToFrame({ type: 'pmpm:event', name: 'config.changed', payload: config });
        })
      : () => {};

    const unlistenNavigation = allowNavigation
      ? kernel.events.on('navigation/changed', (snapshot) => {
          postToFrame({ type: 'pmpm:event', name: 'navigation.changed', payload: snapshot });
        })
      : () => {};

    let spectrumHandle: number | null = null;
    if (permissions.has('api:audio-visual')) {
      spectrumHandle = window.setInterval(() => {
        try {
          const spectrumFramePost =
            typeof hostApi.visualizer.getSpectrumFrame === 'function'
              ? hostApi.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
              : null;
          const spectrumFramePre =
            typeof hostApi.visualizer.getSpectrumFrame === 'function'
              ? hostApi.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
              : null;
          postToFrame({
            type: 'pmpm:event',
            name: 'audio.spectrum',
            payload: hostApi.visualizer.getSpectrum(),
          });
          postToFrame({
            type: 'pmpm:event',
            name: 'audio.spectrumFrame.post',
            payload: spectrumFramePost,
          });
          postToFrame({
            type: 'pmpm:event',
            name: 'audio.spectrumFrame.pre',
            payload: spectrumFramePre,
          });
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
      if (crashReportedRef.current) return;
      crashReportedRef.current = true;

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
        unlistenLoadProgress();
        unlistenError();
        unlistenConfig();
        unlistenNavigation();
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
    hostInfo,
    hostLabel,
    initialConfig,
    initialNavigation,
    kernel.events,
    mountContext,
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
      key={frameId}
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
      srcDoc={buildPmpmSandboxSrcDoc(frameId)}
      data-mounted={mounted ? '1' : '0'}
    />
  );
}
