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
  createPmpmCompatRuntimeSessionAdapter,
  type PmpmCompatCapabilityRevokeAckMessage,
  type PmpmCompatCapabilityRevokeDrillMessage,
} from './runtime/pmpmCompatRuntimeSessionAdapter';
import {
  bindHostRuntimeEventChannel,
  RUNTIME_EVENT_NAMES,
} from './runtime/runtimeEventChannel';
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
import { createRuntimeBridgeHostSession } from './runtime/runtimeBridgeHostSession';
import {
  completePluginSurfaceMount,
  createPluginSurfaceTelemetryContext,
  failPluginSurfaceMount,
  startPluginSurfaceMount,
  type PluginLifecycleTelemetryHandle,
} from './pluginLifecycleTelemetry';

const PMPM_SANDBOX_STARTUP_TIMEOUT_MS = 5_000;
const PMPM_SANDBOX_HEARTBEAT_INTERVAL_MS = 1_500;
const PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS = 8_000;
const DEFAULT_SETTINGS_SURFACE_HEIGHT_PX = 320;

export type PmpmSandboxSurface =
  | { kind: 'magnet' }
  | { kind: 'settings'; panelId?: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'visualizer'; visualizerId: string }
  | { kind: 'window'; windowId: string }
  | { kind: 'overlay'; surfaceId: string }
  | { kind: 'desktop-widget'; surfaceId: string };

type PmpmCompatContentSizeMessage = {
  frameId: string;
  type: 'pmpm:content-size';
  height: number;
};
type FrameMessage =
  | PmpmBridgeIncomingMessage
  | PmpmCompatCapabilityRevokeAckMessage
  | PmpmCompatContentSizeMessage;
type FramePostMessage =
  | Omit<PmpmBridgeOutgoingMessage, 'frameId'>
  | PmpmCompatCapabilityRevokeDrillMessage;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

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
    case 'overlay':
      return 'overlay';
    case 'desktop-widget':
      return 'desktop-widget';
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
  const surfaceMountTelemetryRef = useRef<PluginLifecycleTelemetryHandle | null>(null);

  const [frameReady, setFrameReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsSurfaceHeight, setSettingsSurfaceHeight] = useState<number>(
    DEFAULT_SETTINGS_SURFACE_HEIGHT_PX
  );

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
          : surface.kind === 'overlay' || surface.kind === 'desktop-widget'
            ? surface.surfaceId
          : surface.kind === 'settings'
            ? (surface.panelId ?? null)
            : null;
  const surfaceTelemetryContext = useMemo(
    () =>
      createPluginSurfaceTelemetryContext({
        pluginId,
        sourceKind: 'pmpm',
        hostLabel,
        launcherId: 'compat.pmpm.webview-sandbox',
        surfaceKind: surface.kind,
        surfaceId,
      }),
    [hostLabel, pluginId, surface.kind, surfaceId]
  );

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
  const compatRuntimeAdapterRef = useRef<ReturnType<
    typeof createPmpmCompatRuntimeSessionAdapter
  > | null>(null);

  useEffect(() => {
    setFrameReady(false);
    setMounted(false);
    setError(null);
    setSettingsSurfaceHeight(DEFAULT_SETTINGS_SURFACE_HEIGHT_PX);
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
    surfaceMountTelemetryRef.current = startPluginSurfaceMount(surfaceTelemetryContext, {
      extraFields: {
        mountMode: 'sandbox',
        frameId,
      },
    });

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
        compatRuntimeAdapterRef.current?.handleCompatMessage(data);
        return;
      }

      if (data.type === 'pmpm:mounted') {
        setMounted(true);
        compatRuntimeAdapterRef.current?.handleCompatMessage(data);
        return;
      }

      if (data.type === 'pmpm:content-size') {
        if (surface.kind !== 'settings') return;
        const nextHeight = Math.max(
          DEFAULT_SETTINGS_SURFACE_HEIGHT_PX,
          Math.ceil(Number.isFinite(data.height) ? data.height : 0)
        );
        setSettingsSurfaceHeight((current) =>
          Math.abs(current - nextHeight) > 1 ? nextHeight : current
        );
        return;
      }

      if (data.type === 'pmpm:error') {
        compatRuntimeAdapterRef.current?.handleCompatMessage(data);
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        const message = typeof data.message === 'string' ? data.message : 'Plugin error';
        if (surfaceMountTelemetryRef.current) {
          failPluginSurfaceMount(surfaceMountTelemetryRef.current, message, {
            extraFields: {
              failureStage: 'runtime-event',
              mountMode: 'sandbox',
              frameId,
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
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
        compatRuntimeAdapterRef.current?.handleCompatMessage(data);
        return;
      }

      if (data.type === 'pmpm:permission-denied') {
        compatRuntimeAdapterRef.current?.handleCompatMessage(data);
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
      if (surfaceMountTelemetryRef.current) {
        failPluginSurfaceMount(surfaceMountTelemetryRef.current, 'Plugin sandbox boot timeout', {
          extraFields: {
            failureStage: 'boot-timeout',
            mountMode: 'sandbox',
            frameId,
          },
        });
        surfaceMountTelemetryRef.current = null;
      }
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
      surfaceMountTelemetryRef.current = null;
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
    surfaceTelemetryContext,
    surface.kind,
  ]);

  useEffect(() => {
    if (!mounted || !surfaceMountTelemetryRef.current) {
      return;
    }

    completePluginSurfaceMount(surfaceMountTelemetryRef.current, {
      extraFields: {
        mountMode: 'sandbox',
        frameId,
      },
    });
    surfaceMountTelemetryRef.current = null;
  }, [frameId, mounted]);

  useEffect(() => {
    if (!enabled) return;
    if (!frameReady) return;

    let disposed = false;
    let pingInterval: number | null = null;
    let disposeRuntimeEvents: (() => void) | null = null;
    let runtimeSession: ReturnType<typeof createRuntimeBridgeHostSession> | null = null;

    const crashSurface = resolveCrashSurface(surface.kind);

    const cleanupRuntime = async (reason: string): Promise<void> => {
      compatRuntimeAdapterRef.current = null;
      if (pingInterval !== null) {
        window.clearInterval(pingInterval);
        pingInterval = null;
      }
      try {
        disposeRuntimeEvents?.();
      } catch {
        // ignore
      }
      disposeRuntimeEvents = null;

      const currentRuntimeSession = runtimeSession;
      runtimeSession = null;
      if (currentRuntimeSession) {
        if (reason !== 'runtime-crash') {
          try {
            await currentRuntimeSession.revokeCapabilities(undefined, reason, {
              timeoutMs: Math.min(1_500, PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS),
            });
          } catch {
            // Governance telemetry is emitted by the shared runtime bridge session.
          }
        }
        await currentRuntimeSession.dispose(reason);
        return;
      }

      await runtimeResources.cleanup(reason);
    };

    const boot = async () => {
      try {
        const entryCode = await readVerifiedPmpmPluginEntryCode(pluginId);
        if (disposed) return;

        const runtimeHelloSnapshot = buildPmpmRuntimeHelloSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
          runtimeKind: 'webview',
          carrier: 'webview-frame',
          supportsViewMount: true,
        });
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
        const runtimeActivateSnapshot = buildPmpmRuntimeActivateSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
          kind: surface.kind,
          surfaceId,
          mountContext,
        });
        const runtimeHealthSnapshot = buildPmpmRuntimeHealthSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
        });
        const viewMountRequestSnapshot = buildPmpmViewMountRequestSnapshot({
          pluginId,
          runtimeInstanceId: frameId,
          kind: surface.kind,
          surfaceId,
          mountContext,
        });

        const compatRuntimeAdapter = createPmpmCompatRuntimeSessionAdapter({
          runtimeHello: runtimeHelloSnapshot,
          runtimeHealth: runtimeHealthSnapshot,
          viewMountRequest: viewMountRequestSnapshot ?? undefined,
          capabilityRevokeDrill: {
            type: 'pmpm:capabilities-revoke',
            requestId: runtimeRevokeDrillSnapshot.requestId,
            capabilityIds: [...runtimeRevokeDrillSnapshot.capabilityIds],
            reason: runtimeRevokeDrillSnapshot.reason,
            dryRun: true,
          },
          hostLabel,
          surface: surface.kind,
          surfaceId,
          permissions: Array.from(permissions),
          entryCode,
          mountContext,
          hostInfo,
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
          postCompatMessage: postToFrame,
        });

        compatRuntimeAdapterRef.current = compatRuntimeAdapter;
        compatRuntimeAdapter.primeRuntimeHello();

        runtimeSession = createRuntimeBridgeHostSession({
          pluginId,
          runtimeId: runtimeHelloSnapshot.runtimeId,
          runtimeInstanceId: frameId,
          runtimeKind: runtimeHelloSnapshot.runtimeKind,
          carrier: runtimeHelloSnapshot.carrier,
          api: hostApi,
          permissions,
          port: compatRuntimeAdapter.port,
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: runtimeActivateSnapshot,
          runtimeResources,
          startupTimeoutMs: PMPM_SANDBOX_STARTUP_TIMEOUT_MS,
          requestTimeoutMs: PMPM_SANDBOX_UNRESPONSIVE_TIMEOUT_MS,
          telemetry: {
            sourceKind: 'pmpm',
            launcherId: 'compat.pmpm.webview-sandbox',
            hostLabel,
          },
          onRuntimeEvent: (message) => {
            if (message.eventName !== RUNTIME_EVENT_NAMES.permissionDenied) {
              return;
            }
            const payload = asObject(message.payload) ?? {};
            const capability = typeof payload.capability === 'string' ? payload.capability : '';
            const action = typeof payload.action === 'string' ? payload.action : '';
            if (!capability || !action) {
              return;
            }
            recordPmpmPermissionDenied({
              pluginId,
              hostLabel,
              capability,
              action,
            });
          },
        });

        disposeRuntimeEvents = bindHostRuntimeEventChannel({
          permissions,
          audioService,
          navigation,
          emitRuntimeEvent: (eventName, payload) =>
            runtimeSession?.emitRuntimeEvent(eventName, payload) ?? Promise.resolve(),
          subscribeConfig: permissions.has('storage:local')
            ? (listener) => subscribePmpmPluginConfig(pluginId, listener)
            : undefined,
          getSpectrum: permissions.has('api:audio-visual')
            ? () => hostApi.visualizer.getSpectrum()
            : undefined,
          getSpectrumFrame:
            permissions.has('api:audio-visual') &&
            typeof hostApi.visualizer.getSpectrumFrame === 'function'
              ? (options) => hostApi.visualizer.getSpectrumFrame(options)
              : undefined,
        });

        let pingSeq = 0;
        pingInterval = window.setInterval(() => {
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
          void cleanupRuntime('runtime-unresponsive');
          recordPmpmPluginCrash(pluginId, `Plugin runtime unresponsive (${elapsed}ms)`, crashSurface);
        }, PMPM_SANDBOX_HEARTBEAT_INTERVAL_MS);

        await runtimeSession.start();
      } catch (bootError) {
        if (disposed) return;
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        if (surfaceMountTelemetryRef.current) {
          failPluginSurfaceMount(surfaceMountTelemetryRef.current, bootError, {
            extraFields: {
              failureStage: 'runtime-boot',
              mountMode: 'sandbox',
              frameId,
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
        void cleanupRuntime('runtime-crash');
        recordPmpmPluginCrash(pluginId, bootError, crashSurface);
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    };

    void boot();

    return () => {
      disposed = true;
      void cleanupRuntime('runtime-dispose');
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
    mountContext,
    navigation,
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

  const isSettingsSurface = surface.kind === 'settings';
  const frameShellStyle = isSettingsSurface
    ? {
        width: '100%',
        height: settingsSurfaceHeight,
        minHeight: settingsSurfaceHeight,
      }
    : {
        width: '100%',
        height: '100%',
      };

  return (
    <div
      style={{
        ...frameShellStyle,
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
