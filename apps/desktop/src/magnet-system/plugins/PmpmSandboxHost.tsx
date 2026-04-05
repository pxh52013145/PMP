import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import type {
  PmpmBridgeIncomingMessage,
  PmpmBridgeOutgoingMessage,
} from '@pixel-matrix/plugin-compat-pmpm';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
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
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeCapabilityRevokeDrillSnapshot,
  buildPmpmRuntimeHealthSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
  buildPmpmViewMountRequestSnapshot,
} from './pmpmRuntimeBridgeSnapshot';
import { dispatchPmpmCompatRpcRequest } from './runtime/pmpmCompatCapabilityTransport';
import { createPmpmCompatRuntimeResourceRegistry } from './runtime/pmpmCompatRuntimeResources';

const PMPM_SANDBOX_STARTUP_TIMEOUT_MS = 5_000;
const PMPM_SANDBOX_HEARTBEAT_INTERVAL_MS = 1_500;
const PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS = 8_000;

export type PmpmSandboxSurface =
  | { kind: 'magnet' }
  | { kind: 'settings'; panelId?: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'visualizer'; visualizerId: string }
  | { kind: 'window'; windowId: string };

type PmpmCompatCapabilityRevokeDrillMessage = {
  type: 'pmpm:capabilities-revoke';
  requestId: string;
  capabilityIds: string[];
  reason: string;
  dryRun?: boolean;
};

type PmpmCompatCapabilityRevokeAckMessage = {
  frameId: string;
  type: 'pmpm:capabilities-revoke-ack';
  requestId: string;
  ok: boolean;
  ignored?: boolean;
  reason?: string;
};

type FrameMessage = PmpmBridgeIncomingMessage | PmpmCompatCapabilityRevokeAckMessage;
type FramePostMessage =
  | Omit<PmpmBridgeOutgoingMessage, 'frameId'>
  | PmpmCompatCapabilityRevokeDrillMessage;

function resolveCrashSurface(surface: PmpmSandboxSurface['kind']): PmpmPluginCrashSurface {
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
}: { pluginId: string; hostLabel: string; mountContext?: unknown } & PmpmSandboxSurface) {
  const kernel = useKernel();
  const audioService = useAudioService();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const keybindings = kernel.services.getOptional(KEYBINDINGS_SERVICE_TOKEN);
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
      navigateTo: (
        page: Parameters<typeof navigationService.navigateTo>[0],
        params?: Record<string, unknown>
      ) => navigationService.navigateTo(page, params),
      goBack: () => navigationService.goBack(),
      getSnapshot: () => navigationService.getSnapshot(),
      subscribe: (cb: (snapshot: PluginNavigationSnapshot) => void) =>
        kernel.events.on('navigation/changed', (payload) =>
          cb(payload as PluginNavigationSnapshot)
        ),
    };
  }, [kernel.events, navigationService]);

  const hostApi = useMemo(() => {
    return createPluginMountApi({
      pluginId,
      hostLabel,
      permissions,
      audioService,
      commands,
      navigation,
      keybindings,
    });
  }, [audioService, commands, hostLabel, keybindings, navigation, permissions, pluginId]);
  const runtimeResources = useMemo(() => {
    void frameId;
    return createPmpmCompatRuntimeResourceRegistry();
  }, [frameId]);

  const surfaceId =
    surface.kind === 'page'
      ? surface.pageId
      : surface.kind === 'visualizer'
        ? surface.visualizerId
        : surface.kind === 'window'
          ? surface.windowId
          : surface.kind === 'settings'
            ? (surface.panelId ?? null)
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
    return <T extends FramePostMessage>(message: T) => {
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
        void runtimeResources.cleanup('runtime-crash');
        recordPmpmPluginCrash(pluginId, message, resolveCrashSurface(surface.kind));
        setError(message);
        return;
      }

      if (data.type === 'pmpm:pong') {
        lastPongAtRef.current = Date.now();
        return;
      }

      if (data.type === 'pmpm:capabilities-revoke-ack') {
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
          const response = await dispatchPmpmCompatRpcRequest(hostApi, permissions, data, {
            runtimeResources,
            emitProtocolMessage: (message) =>
              postToFrame({ type: 'pmpm:event', name: 'protocol.message', payload: message }),
          });
          postToFrame(response);
        })();
        return;
      }
    };

    window.addEventListener('message', handler);

    const bootTimeoutMs = PMPM_SANDBOX_STARTUP_TIMEOUT_MS;
    const bootTimer = window.setTimeout(() => {
      if (disposed) return;
      if (frameReadyRef.current) return;
      if (crashReportedRef.current) return;
      crashReportedRef.current = true;
      setError('Plugin sandbox boot timeout');
      void runtimeResources.cleanup('runtime-crash');
      recordPmpmPluginCrash(
        pluginId,
        'Plugin sandbox boot timeout',
        resolveCrashSurface(surface.kind)
      );
    }, bootTimeoutMs);
    return () => {
      disposed = true;
      window.removeEventListener('message', handler);
      window.clearTimeout(bootTimer);
    };
  }, [
    enabled,
    frameId,
    hostApi,
    hostLabel,
    permissions,
    pluginId,
    postToFrame,
    runtimeResources,
    surface.kind,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!frameReady) return;

    let disposed = false;

    const crashSurface = resolveCrashSurface(surface.kind);

    const boot = async () => {
      try {
        const entryCode = await readVerifiedPmpmPluginEntryCode(pluginId);
        if (disposed) return;

        const runtimeInitSnapshot = buildPmpmRuntimeInitSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
          permissions,
          manifestPermissions: plugin?.manifest.permissions,
          deniedPermissions: plugin?.deniedPermissions,
          startupTimeoutMs: PMPM_SANDBOX_STARTUP_TIMEOUT_MS,
          heartbeatIntervalMs: PMPM_SANDBOX_HEARTBEAT_INTERVAL_MS,
          unresponsiveTimeoutMs: PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS,
        });

        const optionalCapabilityIds = runtimeInitSnapshot.grantedCapabilities
          .filter((capability) => capability.mode === 'optional')
          .map((capability) => capability.capabilityId);

        const runtimeRevokeDrillSnapshot = buildPmpmRuntimeCapabilityRevokeDrillSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
          capabilityIds: optionalCapabilityIds,
          reason: 'compat-drill:no-op',
        });

        postToFrame({
          type: 'pmpm:init',
          pluginId,
          hostLabel,
          runtimeHello: buildPmpmRuntimeHelloSnapshot({
            pluginId,
            runtimeInstanceId: frameId,
            runtimeKind: 'webview',
            carrier: 'webview-frame',
            supportsViewMount: true,
          }),
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: buildPmpmRuntimeActivateSnapshot({
            pluginId,
            runtimeInstanceId: frameId,
            kind: surface.kind,
            surfaceId,
            mountContext,
          }),
          runtimeHealth: buildPmpmRuntimeHealthSnapshot({
            pluginId,
            runtimeInstanceId: frameId,
          }),
          viewMountRequest: buildPmpmViewMountRequestSnapshot({
            pluginId,
            runtimeInstanceId: frameId,
            kind: surface.kind,
            surfaceId,
            mountContext,
          }),
          hostInfo,
          surface: surface.kind,
          surfaceId,
          mountContext,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state') ? audioService.getState() : null,
          initialAudioSpectrum: permissions.has('api:audio-visual')
            ? hostApi.visualizer.getSpectrum()
            : null,
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

        postToFrame({
          type: 'pmpm:capabilities-revoke',
          requestId: runtimeRevokeDrillSnapshot.requestId,
          capabilityIds: [...runtimeRevokeDrillSnapshot.capabilityIds],
          reason: runtimeRevokeDrillSnapshot.reason,
          dryRun: true,
        });
      } catch (bootError) {
        if (disposed) return;
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        void runtimeResources.cleanup('runtime-crash');
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
      const timeoutMs = PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS;
      if (elapsed < timeoutMs) return;
      if (crashReportedRef.current) return;
      crashReportedRef.current = true;
      setError(`Plugin runtime unresponsive (${elapsed}ms)`);

      recordPmpmAuditEvent({
        type: 'runtime-unresponsive',
        pluginId,
        surface: crashSurface,
        timeoutMs,
      });
      void runtimeResources.cleanup('runtime-unresponsive');
      recordPmpmPluginCrash(pluginId, `Plugin runtime unresponsive (${elapsed}ms)`, crashSurface);
    }, PMPM_SANDBOX_HEARTBEAT_INTERVAL_MS);

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
      void runtimeResources.cleanup('runtime-dispose');
      postToFrame({ type: 'pmpm:dispose' });
    };
  }, [
    audioService,
    enabled,
    frameReady,
    frameId,
    hostApi,
    hostInfo,
    hostLabel,
    initialConfig,
    initialNavigation,
    kernel.events,
    mountContext,
    permissions,
    plugin,
    pluginId,
    postToFrame,
    runtimeResources,
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
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 'inherit',
        overflow: 'hidden',
        background: 'rgba(10, 14, 22, 0.28)',
      }}
    >
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
      {!mounted ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            padding: 10,
            color: 'rgba(255,255,255,0.72)',
            fontSize: 11,
            textAlign: 'center',
            pointerEvents: 'none',
            background: 'linear-gradient(180deg, rgba(8,12,18,0.18), rgba(8,12,18,0.3))',
          }}
        >
          <div style={{ fontWeight: 600 }}>Loading Plugin</div>
          <div style={{ opacity: 0.78 }}>{plugin.manifest.metadata.name ?? pluginId}</div>
        </div>
      ) : null}
    </div>
  );
}
