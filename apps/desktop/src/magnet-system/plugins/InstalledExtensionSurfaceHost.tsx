import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  PmpmBridgeIncomingMessage,
  PmpmBridgeOutgoingMessage,
} from '@pixel-matrix/plugin-compat-pmpm';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeHealthSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
  buildPmpmViewMountRequestSnapshot,
} from './pmpmRuntimeBridgeSnapshot';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';
import {
  dispatchPmpmCompatRpcRequest,
} from './runtime/pmpmCompatCapabilityTransport';
import {
  createPmpmCompatRuntimeResourceRegistry,
} from './runtime/pmpmCompatRuntimeResources';
import {
  createPmpmCompatRuntimeSessionAdapter,
  type PmpmCompatCapabilityRevokeAckMessage,
} from './runtime/pmpmCompatRuntimeSessionAdapter';
import { createRuntimeBridgeHostSession } from './runtime/runtimeBridgeHostSession';
import {
  bindHostRuntimeEventChannel,
  RUNTIME_EVENT_NAMES,
} from './runtime/runtimeEventChannel';
import {
  createInstalledExtensionEntryUrl,
} from './runtime/installedExtensionRuntimeAssets';
import {
  INSTALLED_EXTENSION_VIEW_LAUNCHERS,
} from './runtime/installedExtensionHostLaunchers';
import {
  createPluginMountApi,
  type PluginNavigationSnapshot,
} from './pluginHostApi';
import {
  quarantineInstalledExtension,
  getInstalledExtensionRecord,
  getInstalledExtensionsRevision,
  listInstalledExtensionCompatPermissions,
  recordInstalledExtensionCrash,
  subscribeInstalledExtensions,
} from './extensions';
import { recordInstalledExtensionPermissionDenied } from './extensionsGovernance';
import {
  buildInstalledExtensionActivationViewId,
} from './activationEvents';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import { useInstalledExtensionRuntimeRestartToken } from './useInstalledExtensionRuntimeRestartToken';
import { useMagnetSkin } from '../../themes/useMagnetSkin';
import {
  readInstalledExtensionPmpHostContributions,
} from './installedExtensionHostPmp';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';
import {
  completePluginSurfaceMount,
  createPluginRuntimeResolveTelemetryContext,
  createPluginSurfaceTelemetryContext,
  failPluginSurfaceMount,
  reportPluginRuntimeResolve,
  startPluginSurfaceMount,
  type PluginLifecycleTelemetryHandle,
} from './pluginLifecycleTelemetry';

const STARTUP_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 1_500;
const UNRESPONSIVE_TIMEOUT_MS = 8_000;
const DEFAULT_SETTINGS_SURFACE_HEIGHT_PX = 320;

type InstalledExtensionSurface =
  | { kind: 'magnet'; mountContext?: unknown }
  | { kind: 'settings'; panelId?: string; mountContext?: unknown }
  | { kind: 'page'; pageId: string; mountContext?: unknown }
  | { kind: 'visualizer'; visualizerId: string; mountContext?: unknown }
  | { kind: 'window'; windowId: string; mountContext?: unknown }
  | { kind: 'overlay'; surfaceId: string; mountContext?: unknown }
  | { kind: 'desktop-widget'; surfaceId: string; mountContext?: unknown };

type FrameMessage = PmpmBridgeIncomingMessage | PmpmCompatCapabilityRevokeAckMessage;
type PmpmCompatContentSizeMessage = {
  frameId: string;
  type: 'pmpm:content-size';
  height: number;
};
type FramePostMessage =
  | Omit<PmpmBridgeOutgoingMessage, 'frameId'>
  | { type: 'pmpm:capabilities-revoke'; requestId: string; capabilityIds: string[]; reason: string; dryRun?: boolean };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function renderStateNotice(title: string, detail: string) {
  return (
    <div style={{ width: '100%', height: '100%', padding: 12, color: 'rgba(255,255,255,0.75)' }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>{detail}</div>
    </div>
  );
}

function buildSurfaceId(surface: InstalledExtensionSurface): string | null {
  switch (surface.kind) {
    case 'page':
      return surface.pageId;
    case 'visualizer':
      return surface.visualizerId;
    case 'window':
      return surface.windowId;
    case 'overlay':
    case 'desktop-widget':
      return surface.surfaceId;
    case 'settings':
      return surface.panelId ?? null;
    case 'magnet':
      return null;
  }
}

function buildSurfaceActivationViewId(
  pluginId: string,
  surface: InstalledExtensionSurface
): string {
  return buildInstalledExtensionActivationViewId({
    pluginId,
    surfaceKind: surface.kind,
    surfaceId: buildSurfaceId(surface),
  });
}

function InstalledExtensionSurfaceHost({
  pluginId,
  hostLabel,
  surface,
}: {
  pluginId: string;
  hostLabel: string;
  surface: InstalledExtensionSurface;
}) {
  const kernel = useKernel();
  const audioService = useAudioService();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const keybindings = kernel.services.getOptional(KEYBINDINGS_SERVICE_TOKEN);
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const runtimeManager = kernel.services.get(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN);
  const restartToken = useInstalledExtensionRuntimeRestartToken(pluginId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const surfaceMountTelemetryRef = useRef<PluginLifecycleTelemetryHandle | null>(null);
  const reportedRuntimeResolveKeyRef = useRef<string | null>(null);
  const reportedMountFailureKeyRef = useRef<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsSurfaceHeight, setSettingsSurfaceHeight] = useState<number>(
    DEFAULT_SETTINGS_SURFACE_HEIGHT_PX
  );
  const frameId = useMemo(() => {
    return `extv2-${pluginId}-${restartToken}-${Math.random().toString(16).slice(2)}`;
  }, [pluginId, restartToken]);

  const extensionStoreRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const record = useMemo(() => {
    void extensionStoreRevision;
    return getInstalledExtensionRecord(pluginId);
  }, [extensionStoreRevision, pluginId]);
  const enabled = record ? (record.enabled ?? true) : false;

  const permissions = useMemo(() => {
    if (!record || !enabled) return new Set<string>();
    return new Set(listInstalledExtensionCompatPermissions(record));
  }, [enabled, record]);

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

  const api = useMemo(() => {
    return createPluginMountApi({
      pluginId,
      hostLabel,
      sourceKind: 'extv2',
      permissions,
      audioService,
      commands,
      navigation,
      keybindings,
      onHostCapabilityActivity: (activity) => {
        void runtimeManager.activateForCapability({
          capabilityId: activity.capabilityId,
          method: activity.method,
          requestKind: activity.requestKind,
          sourcePluginId: activity.sourcePluginId,
          sourceKind: activity.sourceKind === 'extv2' ? 'extv2' : 'pmpm',
          hostLabel: activity.hostLabel,
        });
      },
    });
  }, [
    audioService,
    commands,
    hostLabel,
    keybindings,
    navigation,
    permissions,
    pluginId,
    runtimeManager,
  ]);

  const runtimeResolution = useMemo(() => {
    if (!record) return null;
    return runtimeManager.resolveRuntime(record, {
      surfaceKind: surface.kind,
      supportedLauncherIds: [...INSTALLED_EXTENSION_VIEW_LAUNCHERS],
    });
  }, [record, runtimeManager, surface.kind]);

  const runtimeResolutionError =
    record && enabled
      ? runtimeResolution?.status === 'resolved'
        ? null
        : runtimeResolution?.issues[0] ?? 'No compatible runtime launcher is available'
      : null;

  const runtimeResources = useMemo(() => {
    void frameId;
    return createPmpmCompatRuntimeResourceRegistry();
  }, [frameId]);

  const surfaceId = buildSurfaceId(surface);
  const surfaceTelemetryContext = useMemo(
    () =>
      createPluginSurfaceTelemetryContext({
        pluginId,
        sourceKind: 'extv2',
        hostLabel,
        launcherId: runtimeResolution?.status === 'resolved' ? runtimeResolution.launcher.id : null,
        surfaceKind: surface.kind,
        surfaceId,
      }),
    [hostLabel, pluginId, runtimeResolution, surface.kind, surfaceId]
  );
  const runtimeResolveTelemetryContext = useMemo(
    () =>
      createPluginRuntimeResolveTelemetryContext({
        pluginId,
        sourceKind: 'extv2',
        hostLabel,
        surfaceKind: surface.kind,
        surfaceId,
        cause: 'view',
      }),
    [hostLabel, pluginId, surface.kind, surfaceId]
  );
  const runtimeResolveTelemetryKey = useMemo(() => {
    if (!record || !enabled) return null;
    const resolutionStatus = runtimeResolution?.status ?? 'missing-record';
    const runtimeId =
      runtimeResolution?.status === 'resolved'
        ? runtimeResolution.runtime.runtimeId
        : runtimeResolution?.runtime?.runtimeId ?? '';
    const launcherId =
      runtimeResolution?.status === 'resolved' ? runtimeResolution.launcher.id : '';

    return [
      pluginId,
      surface.kind,
      surfaceId ?? '',
      resolutionStatus,
      runtimeId,
      launcherId,
      runtimeResolution?.issues.join('|') ?? '',
    ].join('::');
  }, [enabled, pluginId, record, runtimeResolution, surface.kind, surfaceId]);
  const activationViewId = useMemo(
    () => buildSurfaceActivationViewId(pluginId, surface),
    [pluginId, surface]
  );
  const initialConfig = useMemo(() => {
    if (!permissions.has('storage:local')) return {};
    return readPmpmPluginConfig(pluginId, 'extv2');
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
  const activationError = useMemo(() => {
    if (!record || !enabled) return null;
    return runtimeManager.readActivationError(record, {
      cause: 'view',
      viewId: activationViewId,
    });
  }, [activationViewId, enabled, record, runtimeManager]);

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

  useEffect(() => {
    if (!record || !enabled || !runtimeResolveTelemetryKey) {
      reportedRuntimeResolveKeyRef.current = null;
      return;
    }

    if (reportedRuntimeResolveKeyRef.current === runtimeResolveTelemetryKey) {
      return;
    }

    reportedRuntimeResolveKeyRef.current = runtimeResolveTelemetryKey;
    reportPluginRuntimeResolve({
      context: runtimeResolveTelemetryContext,
      resolution: runtimeResolution,
      extraFields: {
        hostId: 'pmp',
        supportedLauncherIds: [...INSTALLED_EXTENSION_VIEW_LAUNCHERS],
        preferCommandWorker: false,
      },
    });
  }, [
    enabled,
    record,
    runtimeResolveTelemetryContext,
    runtimeResolveTelemetryKey,
    runtimeResolution,
  ]);

  useEffect(() => {
    const failure = activationError ?? runtimeResolutionError;
    if (!enabled || !failure) {
      reportedMountFailureKeyRef.current = null;
      return;
    }

    const failureKey = `${pluginId}:${surface.kind}:${surfaceId ?? ''}:${failure}`;
    if (reportedMountFailureKeyRef.current === failureKey) {
      return;
    }

    reportedMountFailureKeyRef.current = failureKey;
    failPluginSurfaceMount(surfaceTelemetryContext, failure, {
      extraFields: {
        failureStage: activationError ? 'activation-check' : 'runtime-resolution',
        mountMode: 'host-frame',
        frameId,
      },
    });
  }, [
    activationError,
    enabled,
    frameId,
    pluginId,
    runtimeResolutionError,
    surface.kind,
    surfaceId,
    surfaceTelemetryContext,
  ]);

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
    if (activationError) return;
    if (!runtimeResolution || runtimeResolution.status !== 'resolved') return;

    let disposed = false;
    setMounted(false);
    setError(null);
    surfaceMountTelemetryRef.current = startPluginSurfaceMount(surfaceTelemetryContext, {
      extraFields: {
        mountMode: 'host-frame',
        frameId,
      },
    });

    const handler = (event: MessageEvent) => {
      if (disposed) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as FrameMessage | PmpmCompatContentSizeMessage;
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
        const message = typeof data.message === 'string' ? data.message : 'Extension error';
        if (surfaceMountTelemetryRef.current) {
          failPluginSurfaceMount(surfaceMountTelemetryRef.current, message, {
            extraFields: {
              failureStage: 'runtime-event',
              mountMode: 'host-frame',
              frameId,
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
        void runtimeResources.cleanup('runtime-crash');
        recordInstalledExtensionCrash(pluginId, message, surface.kind);
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
          const response = await dispatchPmpmCompatRpcRequest(api, permissions, data, {
            runtimeResources,
            emitProtocolMessage: (message) =>
              postToFrame({ type: 'pmpm:event', name: 'protocol.message', payload: message }),
          });
          postToFrame(response);
        })();
      }
    };

    window.addEventListener('message', handler);

    const bootTimer = window.setTimeout(() => {
      if (disposed || frameReadyRef.current || crashReportedRef.current) return;
      crashReportedRef.current = true;
      if (surfaceMountTelemetryRef.current) {
        failPluginSurfaceMount(surfaceMountTelemetryRef.current, 'Extension webview boot timeout', {
          extraFields: {
            failureStage: 'boot-timeout',
            mountMode: 'host-frame',
            frameId,
          },
        });
        surfaceMountTelemetryRef.current = null;
      }
      setError('Extension webview boot timeout');
      void runtimeResources.cleanup('runtime-crash');
      quarantineInstalledExtension(pluginId, {
        surface: surface.kind,
        message: 'Extension webview boot timeout',
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
    }, STARTUP_TIMEOUT_MS);

    return () => {
      disposed = true;
      surfaceMountTelemetryRef.current = null;
      window.removeEventListener('message', handler);
      window.clearTimeout(bootTimer);
    };
  }, [
    activationError,
    api,
    enabled,
    frameId,
    permissions,
    pluginId,
    postToFrame,
    runtimeResources,
    runtimeResolution,
    surface.kind,
    surfaceTelemetryContext,
  ]);

  useEffect(() => {
    if (!mounted || !surfaceMountTelemetryRef.current) {
      return;
    }

    completePluginSurfaceMount(surfaceMountTelemetryRef.current, {
      extraFields: {
        mountMode: 'host-frame',
        frameId,
      },
    });
    surfaceMountTelemetryRef.current = null;
  }, [frameId, mounted]);

  useEffect(() => {
    if (!enabled) return;
    if (activationError) return;
    if (!frameReady) return;
    if (!record) return;
    if (!runtimeResolution || runtimeResolution.status !== 'resolved') return;

    let disposed = false;
    let pingInterval: number | null = null;
    let disposeRuntimeEvents: (() => void) | null = null;
    let runtimeSession: ReturnType<typeof createRuntimeBridgeHostSession> | null = null;

    const cleanupRuntime = async (reason: string) => {
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
              timeoutMs: Math.min(1_500, UNRESPONSIVE_TIMEOUT_MS),
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
        const runtimeHelloSnapshot = buildPmpmRuntimeHelloSnapshot({
          pluginId,
          runtimeId: runtimeResolution.runtime.runtimeId,
          runtimeInstanceId: frameId,
          runtimeKind: 'webview',
          carrier: 'webview-frame',
          supportsViewMount: true,
        });
        const runtimeInitSnapshot = buildPmpmRuntimeInitSnapshot({
          pluginId,
          runtimeId: runtimeResolution.runtime.runtimeId,
          runtimeInstanceId: frameId,
          permissions,
          manifestPermissions: Array.from(permissions),
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          unresponsiveTimeoutMs: UNRESPONSIVE_TIMEOUT_MS,
        });
        const runtimeActivateSnapshot = buildPmpmRuntimeActivateSnapshot({
          pluginId,
          runtimeId: runtimeResolution.runtime.runtimeId,
          runtimeInstanceId: frameId,
          kind: surface.kind,
          surfaceId,
          mountContext: surface.mountContext,
        });
        const runtimeHealthSnapshot = buildPmpmRuntimeHealthSnapshot({
          pluginId,
          runtimeId: runtimeResolution.runtime.runtimeId,
          runtimeInstanceId: frameId,
        });
        const viewMountRequestSnapshot = buildPmpmViewMountRequestSnapshot({
          pluginId,
          runtimeId: runtimeResolution.runtime.runtimeId,
          runtimeInstanceId: frameId,
          kind: surface.kind,
          surfaceId,
          mountContext: surface.mountContext,
        });
        const entryUrl = await createInstalledExtensionEntryUrl(runtimeResolution.artifact.path);
        if (disposed) return;

        const compatRuntimeAdapter = createPmpmCompatRuntimeSessionAdapter({
          runtimeHello: runtimeHelloSnapshot,
          runtimeHealth: runtimeHealthSnapshot,
          viewMountRequest: viewMountRequestSnapshot ?? undefined,
          hostLabel,
          surface: surface.kind,
          surfaceId,
          permissions: Array.from(permissions),
          entryCode: '',
          entryUrl,
          mountContext: surface.mountContext,
          hostInfo,
          initialAudioState: permissions.has('api:audio-state') ? audioService.getState() : null,
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
          api,
          permissions,
          port: compatRuntimeAdapter.port,
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: runtimeActivateSnapshot,
          runtimeResources,
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          requestTimeoutMs: UNRESPONSIVE_TIMEOUT_MS,
          telemetry: {
            sourceKind: 'extv2',
            launcherId: runtimeResolution.launcher.id,
            hostLabel,
          },
          onRuntimeEvent: (message) => {
            if (message.eventName !== RUNTIME_EVENT_NAMES.permissionDenied) {
              return;
            }
            const payload = asObject(message.payload) ?? {};
            const capability = typeof payload.capability === 'string' ? payload.capability : '';
            const action = typeof payload.action === 'string' ? payload.action : '';
            if (!capability || !action) return;
            recordInstalledExtensionPermissionDenied({
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
            ? (listener) => subscribePmpmPluginConfig(pluginId, listener, 'extv2')
            : undefined,
          getSpectrum: permissions.has('api:audio-visual')
            ? () => api.visualizer.getSpectrum()
            : undefined,
          getSpectrumFrame:
            permissions.has('api:audio-visual') &&
            typeof api.visualizer.getSpectrumFrame === 'function'
              ? (options) => api.visualizer.getSpectrumFrame(options)
              : undefined,
        });

        pingInterval = window.setInterval(() => {
          postToFrame({ type: 'pmpm:ping', pingId: Date.now() });

          const elapsed = Date.now() - lastPongAtRef.current;
          if (elapsed < UNRESPONSIVE_TIMEOUT_MS || crashReportedRef.current) return;
          crashReportedRef.current = true;
          setError(`Extension runtime unresponsive (${elapsed}ms)`);
          quarantineInstalledExtension(pluginId, {
            surface: surface.kind,
            message: `Extension runtime unresponsive (${elapsed}ms)`,
            timeoutMs: UNRESPONSIVE_TIMEOUT_MS,
          });
          void cleanupRuntime('runtime-unresponsive');
        }, HEARTBEAT_INTERVAL_MS);

        await runtimeSession.start();
      } catch (bootError) {
        if (disposed || crashReportedRef.current) return;
        crashReportedRef.current = true;
        if (surfaceMountTelemetryRef.current) {
          failPluginSurfaceMount(surfaceMountTelemetryRef.current, bootError, {
            extraFields: {
              failureStage: 'runtime-boot',
              mountMode: 'host-frame',
              frameId,
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
        const message = bootError instanceof Error ? bootError.message : String(bootError);
        void cleanupRuntime('runtime-crash');
        if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('unresponsive')) {
          quarantineInstalledExtension(pluginId, {
            surface: surface.kind,
            message,
          });
        } else {
          recordInstalledExtensionCrash(pluginId, bootError, surface.kind);
        }
        setError(message);
      }
    };

    void boot();

    return () => {
      disposed = true;
      void cleanupRuntime('runtime-dispose');
      postToFrame({ type: 'pmpm:dispose' });
    };
  }, [
    activationError,
    api,
    audioService,
    enabled,
    frameId,
    frameReady,
    hostInfo,
    hostLabel,
    initialConfig,
    initialNavigation,
    navigation,
    permissions,
    pluginId,
    postToFrame,
    record,
    runtimeResolution,
    runtimeResources,
    surface.kind,
    surface.mountContext,
    surfaceId,
  ]);

  if (!record) {
    return renderStateNotice('Extension Not Installed', pluginId);
  }

  if (!enabled) {
    return renderStateNotice('Extension Disabled', pluginId);
  }

  if (activationError ?? runtimeResolutionError ?? error) {
    return renderStateNotice(
      'Extension Surface Error',
      activationError ?? runtimeResolutionError ?? error ?? ''
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
    <div style={frameShellStyle}>
      <iframe
        ref={iframeRef}
        title={`${hostLabel}:${pluginId}`}
        sandbox="allow-scripts allow-same-origin"
        srcDoc={buildPmpmSandboxSrcDoc(frameId)}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          display: mounted || frameReady ? 'block' : 'block',
        }}
      />
    </div>
  );
}

export function InstalledExtensionSettingsHost({
  pluginId,
  panelId,
}: {
  pluginId: string;
  panelId?: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionSettingsHost"
      surface={{ kind: 'settings', panelId }}
    />
  );
}

export function InstalledExtensionPageHost({
  pluginId,
  pageId,
}: {
  pluginId: string;
  pageId: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionPageHost"
      surface={{ kind: 'page', pageId }}
    />
  );
}

export function InstalledExtensionVisualizerHost({
  pluginId,
  visualizerId,
}: {
  pluginId: string;
  visualizerId: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionVisualizerHost"
      surface={{ kind: 'visualizer', visualizerId }}
    />
  );
}

export function InstalledExtensionWindowHost({
  pluginId,
  windowId,
}: {
  pluginId: string;
  windowId: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionWindowHost"
      surface={{ kind: 'window', windowId }}
    />
  );
}

export function InstalledExtensionOverlayHost({
  pluginId,
  surfaceId,
}: {
  pluginId: string;
  surfaceId: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionOverlayHost"
      surface={{ kind: 'overlay', surfaceId }}
    />
  );
}

export function InstalledExtensionDesktopWidgetHost({
  pluginId,
  surfaceId,
}: {
  pluginId: string;
  surfaceId: string;
}) {
  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionDesktopWidgetHost"
      surface={{ kind: 'desktop-widget', surfaceId }}
    />
  );
}

export function InstalledExtensionMagnetHost({ pluginId }: { pluginId: string }) {
  const extensionStoreRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );
  const record = useMemo(() => {
    void extensionStoreRevision;
    return getInstalledExtensionRecord(pluginId);
  }, [extensionStoreRevision, pluginId]);
  const contributions = useMemo(() => {
    if (!record) return null;
    return readInstalledExtensionPmpHostContributions(record);
  }, [record]);
  const skin = useMagnetSkin(pluginId, {
    defaultRendererId: pluginId,
    defaultVariant:
      typeof contributions?.magnets?.defaultVariant === 'string' &&
      contributions.magnets.defaultVariant.trim().length > 0
        ? contributions.magnets.defaultVariant.trim()
        : 'default',
  });

  const mountContext = useMemo(() => {
    const themeVariant =
      typeof skin.variant === 'string' && skin.variant.trim().length > 0
        ? skin.variant.trim()
        : null;
    const themeVariantConfig =
      skin.props && typeof skin.props === 'object' && !Array.isArray(skin.props) ? skin.props : null;
    const manifestDefaultVariant =
      typeof contributions?.magnets?.defaultVariant === 'string' &&
      contributions.magnets.defaultVariant.trim().length > 0
        ? contributions.magnets.defaultVariant.trim()
        : null;
    const variant = themeVariant ?? manifestDefaultVariant ?? 'default';

    return {
      surface: 'magnet' as const,
      theme: {
        variant,
        ...(themeVariantConfig ? { props: themeVariantConfig } : {}),
      },
    };
  }, [contributions?.magnets?.defaultVariant, skin.props, skin.variant]);

  return (
    <InstalledExtensionSurfaceHost
      pluginId={pluginId}
      hostLabel="InstalledExtensionMagnetHost"
      surface={{ kind: 'magnet', mountContext }}
    />
  );
}
