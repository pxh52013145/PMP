import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Music4 } from 'lucide-react';
import {
  MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT,
  PMP_HOST_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_FAMILIES,
  type MusicPlatformWorkspaceContextField,
  type PmpHostCapabilityFamilyId,
  type SandboxBridgeIncomingMessage,
  type SandboxBridgeOutgoingMessage,
} from '@pixel-matrix/plugin-platform-contracts';

import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useKernel } from '../../../contexts/KernelContext';
import { useT } from '../../../i18n';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { COMMANDS_SERVICE_TOKEN } from '../../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../../services/navigation';
import {
  buildRuntimeActivateSnapshot,
  buildRuntimeHealthSnapshot,
  buildRuntimeHelloSnapshot,
  buildRuntimeInitSnapshot,
  buildViewMountRequestSnapshot,
} from '../../../magnet-system/plugins/runtimeBridgeSnapshots';
import { buildRuntimeSandboxSrcDoc } from '../../../magnet-system/plugins/runtimeSandboxSrcDoc';
import { dispatchSandboxRpcRequest } from '../../../magnet-system/plugins/runtime/sandboxCapabilityTransport';
import { createRuntimeResourceRegistry } from '../../../magnet-system/plugins/runtime/runtimeResourceRegistry';
import {
  createSandboxRuntimeSessionAdapter,
  type SandboxCapabilityRevokeAckMessage,
} from '../../../magnet-system/plugins/runtime/sandboxRuntimeSessionAdapter';
import { createRuntimeBridgeHostSession } from '../../../magnet-system/plugins/runtime/runtimeBridgeHostSession';
import { bindHostRuntimeEventChannel } from '../../../magnet-system/plugins/runtime/runtimeEventChannel';
import { createPluginMountApi, type PluginNavigationSnapshot } from '../../../magnet-system/plugins/pluginHostApi';
import { PLUGIN_PERMISSIONS } from '../../../magnet-system/plugins/host-api/permissions';
import type { PlatformRuntimeWorkspaceMount } from '../../../modules/music-platform/platformRuntimeDescriptor';
import { type PlatformPackWorkspaceSurfaceRecord } from '../../../modules/music-platform/platformWorkspaceSurface';

const STARTUP_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 1_500;
const UNRESPONSIVE_TIMEOUT_MS = 8_000;
const telemetry = getTelemetryLogger('magnet.platform', 'PackWorkspaceMount');

type FrameMessage = SandboxBridgeIncomingMessage | SandboxCapabilityRevokeAckMessage;
type FramePostMessage = Omit<SandboxBridgeOutgoingMessage, 'frameId'>;

const PACK_WORKSPACE_BASE_PERMISSIONS = [
  PLUGIN_PERMISSIONS.host,
  PLUGIN_PERMISSIONS.hostCapabilityInvoke,
  PLUGIN_PERMISSIONS.musicPlatformWorkspace,
] as const;

const PACK_WORKSPACE_CAPABILITY_PERMISSION_MAP = {
  'host.pmp.audio-engine.playback': [
    PLUGIN_PERMISSIONS.audioState,
    PLUGIN_PERMISSIONS.audioControl,
    PLUGIN_PERMISSIONS.audioCover,
  ],
  'host.pmp.audio-engine.analysis': [PLUGIN_PERMISSIONS.audioVisual],
  'host.pmp.navigation': [PLUGIN_PERMISSIONS.navigation],
  'host.pmp.storage.config': [PLUGIN_PERMISSIONS.configLocal],
  'host.pmp.storage.durable-text': [PLUGIN_PERMISSIONS.durableText],
  'host.pmp.connector-auth': [PLUGIN_PERMISSIONS.connectorAuth],
  'host.pmp.music-platform.catalog': [PLUGIN_PERMISSIONS.musicPlatformCatalog],
  'host.pmp.music-platform.workspace': [PLUGIN_PERMISSIONS.musicPlatformWorkspace],
  'host.pmp.music-platform.search': [PLUGIN_PERMISSIONS.musicPlatformSearch],
  'host.pmp.music-platform.prepare': [PLUGIN_PERMISSIONS.musicPlatformPrepare],
} as const satisfies Partial<Record<PmpHostCapabilityFamilyId, readonly string[]>>;

function resolvePackWorkspaceRuntimePermissions(
  capabilityFamilies: PlatformPackWorkspaceSurfaceRecord['workspace']['capabilityFamilies']
): Set<string> {
  const permissions = new Set<string>(PACK_WORKSPACE_BASE_PERMISSIONS);
  const grantedCapabilityFamilies = new Set<string>(
    PMP_HOST_MUSIC_PLATFORM_WORKSPACE_CAPABILITY_FAMILIES
  );
  for (const capabilityId of capabilityFamilies?.required ?? []) {
    grantedCapabilityFamilies.add(capabilityId);
  }
  for (const capabilityId of capabilityFamilies?.optional ?? []) {
    grantedCapabilityFamilies.add(capabilityId);
  }

  for (const capabilityId of grantedCapabilityFamilies) {
    if (!(capabilityId in PACK_WORKSPACE_CAPABILITY_PERMISSION_MAP)) {
      continue;
    }
    for (const permission of PACK_WORKSPACE_CAPABILITY_PERMISSION_MAP[
      capabilityId as keyof typeof PACK_WORKSPACE_CAPABILITY_PERMISSION_MAP
    ] ?? []) {
      permissions.add(permission);
    }
  }

  return permissions;
}

function readMountErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPackWorkspacePluginId(packId: string): string {
  return `platform-pack.${packId}`;
}

function hashPackWorkspaceIdentity(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildPackWorkspaceRuntimeIdentity(input: {
  connectorId: string;
  instanceId: string | null;
  installationId: string | null;
  resolutionSource: string | null;
  sourceType: string | null;
  source: string | null;
  packId: string;
  packVersion: string;
  packageDigest: string | null;
  runtimePath: string | null;
  runtimeImportUrl: string | null;
  rootViewId: string;
  rootViewType: string;
  requiredRuntimeCarrier: string | null;
  capabilityRequiredKey: string;
  capabilityOptionalKey: string;
}): string {
  const stableSeed = JSON.stringify([
    input.connectorId,
    input.instanceId,
    input.installationId,
    input.resolutionSource,
    input.sourceType,
    input.source,
    input.packId,
    input.packVersion,
    input.packageDigest,
    input.runtimePath,
    input.runtimeImportUrl,
    input.rootViewId,
    input.rootViewType,
    input.requiredRuntimeCarrier,
    input.capabilityRequiredKey,
    input.capabilityOptionalKey,
  ]);
  return hashPackWorkspaceIdentity(stableSeed);
}

export interface PackWorkspaceMountProps {
  connectorId: string;
  displayName: string;
  instanceId?: string | null;
  surface: PlatformPackWorkspaceSurfaceRecord;
  workspaceMount?: PlatformRuntimeWorkspaceMount | null;
}

export const PackWorkspaceMount: React.FC<PackWorkspaceMountProps> = ({
  connectorId,
  displayName,
  instanceId,
  surface,
  workspaceMount,
}) => {
  const t = useT();
  const kernel = useKernel();
  const audioService = useAudioService();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const keybindings = kernel.services.getOptional(KEYBINDINGS_SERVICE_TOKEN);
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastPongAtRef = useRef<number>(Date.now());
  const frameReadyRef = useRef(false);
  const crashReportedRef = useRef(false);
  const sandboxRuntimeAdapterRef = useRef<ReturnType<
    typeof createSandboxRuntimeSessionAdapter
  > | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const surfacePackId = surface.packId;
  const surfacePackVersion = surface.packVersion;
  const surfacePlatformId = surface.platformId;
  const surfaceRootViewId = surface.root.viewId;
  const surfaceRootViewType = surface.root.viewType ?? 'page';
  const surfaceRequiredRuntimeCarrier = surface.requiredRuntimeCarrier;
  const workspaceOwnership = surface.workspace.ownership;
  const workspaceRequiredRuntimeCarrier = surface.workspace.requiredRuntimeCarrier;
  const workspaceRoot = useMemo(
    () => ({
      viewId: surfaceRootViewId,
      ...(surface.root.viewType ? { viewType: surface.root.viewType } : {}),
    }),
    [surface.root.viewType, surfaceRootViewId]
  );
  const workspaceCapabilityRequiredKey = (surface.workspace.capabilityFamilies?.required ?? [])
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join('\u001f');
  const workspaceCapabilityOptionalKey = (surface.workspace.capabilityFamilies?.optional ?? [])
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join('\u001f');
  const hasWorkspaceCapabilityFamilies = Boolean(surface.workspace.capabilityFamilies);
  const workspaceContextScope = surface.workspace.context?.scope;
  const workspaceContextFields = useMemo<MusicPlatformWorkspaceContextField[]>(
    () => [...(surface.workspace.context?.fields ?? [])].sort((left, right) => left.localeCompare(right)),
    [surface.workspace.context?.fields]
  );
  const workspaceCapabilityFamilies = useMemo(
    () =>
      hasWorkspaceCapabilityFamilies
        ? {
            required:
              workspaceCapabilityRequiredKey.length > 0
                ? workspaceCapabilityRequiredKey.split('\u001f')
                : [],
            optional:
              workspaceCapabilityOptionalKey.length > 0
                ? workspaceCapabilityOptionalKey.split('\u001f')
                : [],
          }
        : undefined,
    [hasWorkspaceCapabilityFamilies, workspaceCapabilityOptionalKey, workspaceCapabilityRequiredKey]
  );
  const workspaceContext = useMemo(
    () =>
      workspaceContextScope
        ? {
            scope: workspaceContextScope,
            fields: workspaceContextFields,
          }
        : undefined,
    [workspaceContextFields, workspaceContextScope]
  );
  const resolvedRuntimeImportUrl = useMemo(
    () =>
      workspaceMount?.runtimeImportUrl ??
      (typeof surface.runtimeImportUrl === 'string' ? surface.runtimeImportUrl : null),
    [surface.runtimeImportUrl, workspaceMount?.runtimeImportUrl]
  );
  const workspaceInstallationId = workspaceMount?.installationId ?? null;
  const workspaceResolutionSource = workspaceMount?.resolutionSource ?? null;
  const workspaceSourceType = workspaceMount?.sourceType ?? null;
  const workspaceSource =
    workspaceMount?.source ??
    (typeof surface.source === 'string' ? surface.source : null);
  const workspacePackageDigest = workspaceMount?.packageDigest ?? null;
  const workspaceArtifactRootPath = workspaceMount?.artifactRootPath ?? null;
  const workspaceRuntimePath = workspaceMount?.runtimePath ?? null;
  const workspaceIconPath = workspaceMount?.iconPath ?? null;
  const mountTelemetryFields = useMemo(
    () => ({
      connectorId,
      instanceId: instanceId ?? null,
      installationId: workspaceInstallationId,
      resolutionSource: workspaceResolutionSource,
      sourceType: workspaceSourceType,
      source: workspaceSource,
      packId: surfacePackId,
      packVersion: surfacePackVersion,
      packageDigest: workspacePackageDigest,
      artifactRootPath: workspaceArtifactRootPath,
      runtimePath: workspaceRuntimePath,
      runtimeImportUrl: resolvedRuntimeImportUrl,
      iconPath: workspaceIconPath,
      viewId: surfaceRootViewId,
      viewType: surfaceRootViewType,
      requiredRuntimeCarrier: surfaceRequiredRuntimeCarrier,
    }),
    [
      connectorId,
      instanceId,
      surfacePackId,
      surfacePackVersion,
      surfaceRequiredRuntimeCarrier,
      surfaceRootViewId,
      surfaceRootViewType,
      workspaceArtifactRootPath,
      workspaceIconPath,
      workspaceInstallationId,
      workspacePackageDigest,
      workspaceResolutionSource,
      workspaceRuntimePath,
      workspaceSource,
      workspaceSourceType,
      resolvedRuntimeImportUrl,
    ]
  );

  const pluginId = useMemo(() => buildPackWorkspacePluginId(surfacePackId), [surfacePackId]);
  const runtimeIdentity = useMemo(
    () =>
      buildPackWorkspaceRuntimeIdentity({
        connectorId,
        instanceId: instanceId ?? null,
        installationId: workspaceInstallationId,
        resolutionSource: workspaceResolutionSource,
        sourceType: workspaceSourceType,
        source: workspaceSource,
        packId: surfacePackId,
        packVersion: surfacePackVersion,
        packageDigest: workspacePackageDigest,
        runtimePath: workspaceRuntimePath,
        runtimeImportUrl: resolvedRuntimeImportUrl,
        rootViewId: surfaceRootViewId,
        rootViewType: surfaceRootViewType,
        requiredRuntimeCarrier: surfaceRequiredRuntimeCarrier,
        capabilityRequiredKey: workspaceCapabilityRequiredKey,
        capabilityOptionalKey: workspaceCapabilityOptionalKey,
      }),
    [
      connectorId,
      instanceId,
      resolvedRuntimeImportUrl,
      surfacePackId,
      surfacePackVersion,
      surfaceRequiredRuntimeCarrier,
      surfaceRootViewId,
      surfaceRootViewType,
      workspaceCapabilityOptionalKey,
      workspaceCapabilityRequiredKey,
      workspaceInstallationId,
      workspacePackageDigest,
      workspaceResolutionSource,
      workspaceRuntimePath,
      workspaceSource,
      workspaceSourceType,
    ]
  );
  const frameId = useMemo(
    () => `platform-pack-${runtimeIdentity}`,
    [runtimeIdentity]
  );
  const permissions = useMemo(
    () => resolvePackWorkspaceRuntimePermissions(workspaceCapabilityFamilies),
    [workspaceCapabilityFamilies]
  );
  const runtimeResources = useMemo(() => {
    // Recreate runtime-scoped resources when the iframe runtime instance changes.
    void frameId;
    return createRuntimeResourceRegistry();
  }, [frameId]);
  const runtimeId = useMemo(
    () => `${pluginId}.workspace.${runtimeIdentity}`,
    [pluginId, runtimeIdentity]
  );
  const mountContext = useMemo(
    () => ({
      scope: 'music-platform-workspace',
      connectorId,
      platformId: surfacePlatformId,
      instanceId: instanceId ?? undefined,
      packId: surfacePackId,
      packVersion: surfacePackVersion,
      rootViewId: surfaceRootViewId,
      rootViewType: surfaceRootViewType,
    }),
    [
      connectorId,
      instanceId,
      surfacePackId,
      surfacePackVersion,
      surfacePlatformId,
      surfaceRootViewId,
      surfaceRootViewType,
    ]
  );
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
      hostLabel: 'PlatformPackWorkspaceMount',
      permissions,
      audioService,
      commands,
      navigation,
      keybindings,
    });
  }, [audioService, commands, keybindings, navigation, permissions, pluginId]);
  const initialNavigation = useMemo(
    () => api.navigation.getSnapshot(),
    [api.navigation]
  );
  const initialConfig = useMemo(() => api.config.get(), [api.config]);
  const hostInfo = useMemo(() => api.host.getInfo(), [api.host]);

  const postToFrame = useMemo(() => {
    return <T extends FramePostMessage>(message: T) => {
      const targetWindow = iframeRef.current?.contentWindow;
      if (!targetWindow) return;
      try {
        targetWindow.postMessage({ frameId, ...message }, '*');
      } catch {
        // Ignore best-effort iframe messaging failures.
      }
    };
  }, [frameId]);

  useEffect(() => {
    setFrameReady(false);
    setMounted(false);
    setError(null);
    lastPongAtRef.current = Date.now();
    frameReadyRef.current = false;
    crashReportedRef.current = false;
  }, [frameId]);

  useEffect(() => {
    let disposed = false;

    const handler = (event: MessageEvent) => {
      if (disposed) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as FrameMessage;
      if (!data || typeof data !== 'object') return;
      if ((data as { frameId?: unknown }).frameId !== frameId) return;

      if (data.type === 'sandbox:iframe-ready') {
        setFrameReady(true);
        frameReadyRef.current = true;
        lastPongAtRef.current = Date.now();
        sandboxRuntimeAdapterRef.current?.handleSandboxMessage(data);
        return;
      }

      if (data.type === 'sandbox:mounted') {
        setMounted(true);
        sandboxRuntimeAdapterRef.current?.handleSandboxMessage(data);
        return;
      }

      if (data.type === 'sandbox:error') {
        sandboxRuntimeAdapterRef.current?.handleSandboxMessage(data);
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        setError(typeof data.message === 'string' ? data.message : 'Workspace runtime error');
        void runtimeResources.cleanup('runtime-crash');
        return;
      }

      if (data.type === 'sandbox:pong') {
        lastPongAtRef.current = Date.now();
        return;
      }

      if (data.type === 'sandbox:capabilities-revoke-ack') {
        sandboxRuntimeAdapterRef.current?.handleSandboxMessage(data);
        return;
      }

      if (data.type === 'sandbox:permission-denied') {
        sandboxRuntimeAdapterRef.current?.handleSandboxMessage(data);
        return;
      }

      if (data.type === 'sandbox:rpc') {
        void (async () => {
          const response = await dispatchSandboxRpcRequest(api, permissions, data, {
            runtimeResources,
            emitProtocolMessage: (message) =>
              postToFrame({
                type: 'sandbox:event',
                name: 'protocol.message',
                payload: message,
              }),
          });
          postToFrame(response);
        })();
      }
    };

    window.addEventListener('message', handler);
    const bootTimer = window.setTimeout(() => {
      if (disposed || frameReadyRef.current || crashReportedRef.current) return;
      crashReportedRef.current = true;
      telemetry.warn('platform.pack-workspace.mount.boot-timeout', {
        message: 'Pack workspace webview boot timed out before iframe ready.',
        fields: {
          ...mountTelemetryFields,
          permissionCount: permissions.size,
          audioVisualEnabled: permissions.has(PLUGIN_PERMISSIONS.audioVisual),
        },
      });
      setError('Pack workspace webview boot timeout');
      void runtimeResources.cleanup('runtime-crash');
    }, STARTUP_TIMEOUT_MS);

    return () => {
      disposed = true;
      window.removeEventListener('message', handler);
      window.clearTimeout(bootTimer);
    };
  }, [
    api,
    frameId,
    mountTelemetryFields,
    permissions,
    postToFrame,
    runtimeResources,
  ]);

  useEffect(() => {
    if (!frameReady) {
      return;
    }

    let disposed = false;
    let pingInterval: number | null = null;
    let disposeRuntimeEvents: (() => void) | null = null;
    let runtimeSession: ReturnType<typeof createRuntimeBridgeHostSession> | null = null;

    const cleanupRuntime = async (reason: string) => {
      sandboxRuntimeAdapterRef.current = null;
      if (pingInterval !== null) {
        window.clearInterval(pingInterval);
        pingInterval = null;
      }
      try {
        disposeRuntimeEvents?.();
      } catch {
        // Ignore cleanup errors from best-effort subscriptions.
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
            // Capability revoke is best-effort during teardown.
          }
        }
        await currentRuntimeSession.dispose(reason);
        return;
      }

      await runtimeResources.cleanup(reason);
    };

    const boot = async () => {
      try {
        telemetry.info('platform.pack-workspace.mount.start', {
          fields: {
            ...mountTelemetryFields,
            permissionCount: permissions.size,
            audioVisualEnabled: permissions.has(PLUGIN_PERMISSIONS.audioVisual),
          },
        });
        const runtimeHelloSnapshot = buildRuntimeHelloSnapshot({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
          runtimeKind: 'webview',
          carrier: surfaceRequiredRuntimeCarrier,
          supportsViewMount: true,
        });
        const runtimeInitSnapshot = buildRuntimeInitSnapshot({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
          permissions,
          manifestPermissions: Array.from(permissions),
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          unresponsiveTimeoutMs: UNRESPONSIVE_TIMEOUT_MS,
        });
        const runtimeActivateSnapshot = buildRuntimeActivateSnapshot({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
          kind: 'page',
          surfaceId: surfaceRootViewId,
          mountContext,
        });
        const runtimeHealthSnapshot = buildRuntimeHealthSnapshot({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
        });
        const viewMountRequestSnapshot = buildViewMountRequestSnapshot({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
          kind: 'page',
          surfaceId: surfaceRootViewId,
          mountContext,
          viewType: surfaceRootViewType,
          surfaceSlot: MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT,
          mountMetadata: {
            scope: 'music-platform-workspace',
            connectorId,
            platformId: surfacePlatformId,
            instanceId: instanceId ?? undefined,
            workspace: {
              ownership: workspaceOwnership,
              requiredRuntimeCarrier: workspaceRequiredRuntimeCarrier,
            },
            root: workspaceRoot,
            capabilityFamilies: workspaceCapabilityFamilies,
            context: workspaceContext,
          },
        });

        const entryUrl =
          typeof resolvedRuntimeImportUrl === 'string' &&
          resolvedRuntimeImportUrl.trim().length > 0
            ? resolvedRuntimeImportUrl
            : undefined;
        const entryCode = entryUrl ? '' : surface.runtimeCode;
        if (!entryUrl && !entryCode.trim()) {
          throw new Error('Pack workspace runtime entry is missing');
        }

        const sandboxRuntimeAdapter = createSandboxRuntimeSessionAdapter({
          runtimeHello: runtimeHelloSnapshot,
          runtimeHealth: runtimeHealthSnapshot,
          viewMountRequest: viewMountRequestSnapshot ?? undefined,
          hostLabel: 'PlatformPackWorkspaceMount',
          surface: 'page',
          surfaceId: surfaceRootViewId,
          permissions: Array.from(permissions),
          entryCode,
          entryUrl,
          mountContext,
          hostInfo,
          initialAudioState: permissions.has(PLUGIN_PERMISSIONS.audioState)
            ? audioService.getState()
            : null,
          initialAudioSpectrum: permissions.has(PLUGIN_PERMISSIONS.audioVisual)
            ? api.visualizer.getSpectrum()
            : null,
          initialAudioSpectrumFramePre: permissions.has(PLUGIN_PERMISSIONS.audioVisual)
            ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
            : null,
          initialAudioSpectrumFramePost: permissions.has(PLUGIN_PERMISSIONS.audioVisual)
            ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
            : null,
          initialNavigation,
          initialConfig,
          postSandboxMessage: postToFrame,
        });

        sandboxRuntimeAdapterRef.current = sandboxRuntimeAdapter;
        sandboxRuntimeAdapter.primeRuntimeHello();

        runtimeSession = createRuntimeBridgeHostSession({
          pluginId,
          runtimeId,
          runtimeInstanceId: frameId,
          runtimeKind: runtimeHelloSnapshot.runtimeKind,
          carrier: runtimeHelloSnapshot.carrier,
          api,
          permissions,
          port: sandboxRuntimeAdapter.port,
          runtimeInit: runtimeInitSnapshot,
          runtimeActivate: runtimeActivateSnapshot,
          runtimeResources,
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          requestTimeoutMs: UNRESPONSIVE_TIMEOUT_MS,
        });

        disposeRuntimeEvents = bindHostRuntimeEventChannel({
          permissions,
          audioService,
          navigation,
          emitRuntimeEvent: (eventName, payload) =>
            runtimeSession?.emitRuntimeEvent(eventName, payload) ?? Promise.resolve(),
          subscribeConfig: permissions.has(PLUGIN_PERMISSIONS.configLocal)
            ? (listener) => api.config.onChange(listener)
            : undefined,
          getSpectrum: permissions.has(PLUGIN_PERMISSIONS.audioVisual)
            ? () => api.visualizer.getSpectrum()
            : undefined,
          getSpectrumFrame: permissions.has(PLUGIN_PERMISSIONS.audioVisual)
            ? (options) => api.visualizer.getSpectrumFrame(options)
            : undefined,
        });

        pingInterval = window.setInterval(() => {
          postToFrame({ type: 'sandbox:ping', pingId: Date.now() });
          const elapsed = Date.now() - lastPongAtRef.current;
          if (elapsed < UNRESPONSIVE_TIMEOUT_MS || crashReportedRef.current) return;
          crashReportedRef.current = true;
          telemetry.warn('platform.pack-workspace.mount.unresponsive', {
            message: `Pack workspace runtime became unresponsive after ${elapsed}ms.`,
            fields: {
              ...mountTelemetryFields,
              elapsedMs: elapsed,
              permissionCount: permissions.size,
              audioVisualEnabled: permissions.has(PLUGIN_PERMISSIONS.audioVisual),
            },
          });
          setError(`Pack workspace runtime unresponsive (${elapsed}ms)`);
          void cleanupRuntime('runtime-unresponsive');
        }, HEARTBEAT_INTERVAL_MS);

        await runtimeSession.start();
      } catch (bootError) {
        if (disposed || crashReportedRef.current) return;
        crashReportedRef.current = true;
        telemetry.warn('platform.pack-workspace.mount.failed', {
          message: readMountErrorMessage(bootError),
          fields: {
            ...mountTelemetryFields,
            permissionCount: permissions.size,
            audioVisualEnabled: permissions.has(PLUGIN_PERMISSIONS.audioVisual),
          },
        });
        setError(readMountErrorMessage(bootError));
        void cleanupRuntime('runtime-crash');
      }
    };

    void boot();

    return () => {
      disposed = true;
      void cleanupRuntime('runtime-dispose');
      postToFrame({ type: 'sandbox:dispose' });
    };
  }, [
    api,
    audioService,
    connectorId,
    frameId,
    frameReady,
    hostInfo,
    initialConfig,
    initialNavigation,
    instanceId,
    mountContext,
    mountTelemetryFields,
    navigation,
    permissions,
    pluginId,
    postToFrame,
    resolvedRuntimeImportUrl,
    runtimeId,
    runtimeResources,
    surface.runtimeCode,
    surfacePackId,
    surfacePlatformId,
    surfaceRequiredRuntimeCarrier,
    surfaceRootViewId,
    surfaceRootViewType,
    workspaceOwnership,
    workspaceRequiredRuntimeCarrier,
    workspaceRoot,
    workspaceCapabilityFamilies,
    workspaceContext,
  ]);

  return (
    <div className="platform-pack-workspace-shell">
      {error ? (
        <div className="platform-pack-workspace-state platform-pack-workspace-state-error">
          <div className="platform-pack-workspace-state-icon">
            <Music4 className="h-5 w-5" />
          </div>
          <div className="platform-pack-workspace-state-title">
            {t('magnet.platform.workspace.packMount.errorTitle')}
          </div>
          <div className="platform-pack-workspace-state-detail">
            {t('magnet.platform.workspace.packMount.errorBody', {
              connector: displayName,
              packId: surface.packId,
              viewId: surface.root.viewId,
            })}
          </div>
          <div className="platform-pack-workspace-state-reason">{error}</div>
        </div>
      ) : null}
      {!error && !mounted ? (
        <div className="platform-pack-workspace-state platform-pack-workspace-state-loading">
          <div className="platform-pack-workspace-state-title">
            {t('magnet.platform.workspace.packMount.loadingTitle')}
          </div>
          <div className="platform-pack-workspace-state-detail">
            {t('magnet.platform.workspace.packMount.loadingBody', {
              connector: displayName,
              packId: surface.packId,
              viewId: surface.root.viewId,
            })}
          </div>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={`PlatformPackWorkspace:${surface.packId}`}
        sandbox="allow-scripts allow-same-origin"
        srcDoc={buildRuntimeSandboxSrcDoc(frameId)}
        className="platform-pack-workspace-frame"
      />
    </div>
  );
};
