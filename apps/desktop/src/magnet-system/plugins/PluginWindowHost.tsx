import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  getPmpmPluginsRevision,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { clearPmpmPluginRuntimeCache } from './pmpmRuntime';
import { createPluginMountApi, type PluginMountApi, type PluginNavigationSnapshot } from './pluginHostApi';
import {
  getResolvedPmpmLauncherAdapter,
  getResolvedPmpmLauncherAdapterError,
  resolveInstalledPmpmPluginRuntime,
} from './runtime';
import {
  getPmpmSandboxRevision,
  getPmpmSandboxRuntimeEnabled,
  subscribePmpmSandbox,
} from './pmpmSandboxConfig';
import { usePmpmRuntimeRestartToken } from './usePmpmRuntimeRestartToken';
import {
  completePluginSurfaceMount,
  createPluginRuntimeResolveTelemetryContext,
  createPluginSurfaceTelemetryContext,
  failPluginSurfaceMount,
  reportPluginRuntimeResolve,
  startPluginSurfaceMount,
  type PluginLifecycleTelemetryHandle,
} from './pluginLifecycleTelemetry';

export function PluginWindowHost({
  pluginId,
  windowId,
}: {
  pluginId: string;
  windowId: string;
}) {
  const kernel = useKernel();
  const audioService = useAudioService();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const keybindings = kernel.services.getOptional(KEYBINDINGS_SERVICE_TOKEN);
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const surfaceMountTelemetryRef = useRef<PluginLifecycleTelemetryHandle | null>(null);
  const reportedRuntimeResolveKeyRef = useRef<string | null>(null);
  const reportedMountFailureKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restartToken = usePmpmRuntimeRestartToken(pluginId);

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const sandboxRevision = useSyncExternalStore(
    subscribePmpmSandbox,
    getPmpmSandboxRevision,
    getPmpmSandboxRevision
  );

  const sandboxEnabled = useMemo(() => {
    void sandboxRevision;
    return getPmpmSandboxRuntimeEnabled();
  }, [sandboxRevision]);

  const plugin = useMemo(() => {
    void pluginStoreRevision;
    return getInstalledPmpmPlugin(pluginId);
  }, [pluginId, pluginStoreRevision]);

  const enabled = plugin ? (plugin.enabled ?? true) : false;

  const permissions = useMemo(() => {
    void pluginStoreRevision;
    return getPmpmPluginEffectivePermissions(pluginId);
  }, [pluginId, pluginStoreRevision]);
  const runtimeResolution = useMemo(() => {
    void pluginStoreRevision;
    return resolveInstalledPmpmPluginRuntime(pluginId, {
      preferSandbox: sandboxEnabled,
      surfaceKind: 'window',
    });
  }, [pluginId, pluginStoreRevision, sandboxEnabled]);
  const launcherAdapter = useMemo(
    () => getResolvedPmpmLauncherAdapter(runtimeResolution),
    [runtimeResolution]
  );
  const runtimeResolutionError =
    plugin && enabled
      ? getResolvedPmpmLauncherAdapterError(runtimeResolution)
      : null;
  const surfaceTelemetryContext = useMemo(
    () =>
      createPluginSurfaceTelemetryContext({
        pluginId,
        sourceKind: 'pmpm',
        hostLabel: 'PluginWindowHost',
        launcherId:
          runtimeResolution?.status === 'resolved' ? runtimeResolution.launcher.id : null,
        surfaceKind: 'window',
        surfaceId: windowId,
      }),
    [pluginId, runtimeResolution, windowId]
  );
  const runtimeResolveTelemetryContext = useMemo(
    () =>
      createPluginRuntimeResolveTelemetryContext({
        pluginId,
        sourceKind: 'pmpm',
        hostLabel: 'PluginWindowHost',
        surfaceKind: 'window',
        surfaceId: windowId,
        cause: 'view',
      }),
    [pluginId, windowId]
  );
  const runtimeResolveTelemetryKey = useMemo(() => {
    if (!enabled) return null;
    const resolutionStatus = runtimeResolution?.status ?? 'missing-record';
    const runtimeId =
      runtimeResolution?.status === 'resolved'
        ? runtimeResolution.runtime.runtimeId
        : runtimeResolution?.runtime?.runtimeId ?? '';
    const launcherId =
      runtimeResolution?.status === 'resolved' ? runtimeResolution.launcher.id : '';

    return [
      pluginId,
      'window',
      windowId,
      resolutionStatus,
      runtimeId,
      launcherId,
      runtimeResolution?.issues.join('|') ?? '',
    ].join('::');
  }, [enabled, pluginId, runtimeResolution, windowId]);

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

  const api = useMemo<PluginMountApi>(() => {
    return createPluginMountApi({
      pluginId,
      hostLabel: 'PluginWindowHost',
      permissions,
      audioService,
      commands,
      navigation,
      keybindings,
    });
  }, [audioService, commands, keybindings, navigation, permissions, pluginId]);

  useEffect(() => {
    if (!enabled || !runtimeResolveTelemetryKey) {
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
        preferCompatSandbox: sandboxEnabled,
      },
    });
  }, [
    enabled,
    runtimeResolveTelemetryContext,
    runtimeResolveTelemetryKey,
    runtimeResolution,
    sandboxEnabled,
  ]);

  useEffect(() => {
    if (!enabled || !runtimeResolutionError) {
      reportedMountFailureKeyRef.current = null;
      return;
    }

    const failureKey = `${pluginId}:${windowId}:${runtimeResolutionError}`;
    if (reportedMountFailureKeyRef.current === failureKey) {
      return;
    }

    reportedMountFailureKeyRef.current = failureKey;
    failPluginSurfaceMount(surfaceTelemetryContext, runtimeResolutionError, {
      extraFields: {
        failureStage: 'resolve',
        mountMode: launcherAdapter?.mode ?? null,
      },
    });
  }, [enabled, launcherAdapter?.mode, pluginId, runtimeResolutionError, surfaceTelemetryContext, windowId]);

  useEffect(() => {
    if (!enabled) return;
    if (!launcherAdapter || launcherAdapter.mode !== 'inline') return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setError(null);
    surfaceMountTelemetryRef.current = startPluginSurfaceMount(surfaceTelemetryContext, {
      extraFields: {
        mountMode: 'inline',
      },
    });

    void launcherAdapter
      .mountSurface({
        pluginId,
        hostLabel: 'PluginWindowHost',
        surface: { kind: 'window', windowId },
        container,
        api,
      })
      .then((cleanup) => {
        if (cancelled) return;
        cleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
        if (surfaceMountTelemetryRef.current) {
          completePluginSurfaceMount(surfaceMountTelemetryRef.current, {
            extraFields: {
              mountMode: 'inline',
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (surfaceMountTelemetryRef.current) {
          failPluginSurfaceMount(surfaceMountTelemetryRef.current, err, {
            extraFields: {
              failureStage: 'mount',
              mountMode: 'inline',
            },
          });
          surfaceMountTelemetryRef.current = null;
        }
        recordPmpmPluginCrash(pluginId, err, 'window');
        clearPmpmPluginRuntimeCache(pluginId);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      surfaceMountTelemetryRef.current = null;
      try {
        cleanupRef.current?.();
      } finally {
        cleanupRef.current = null;
        container.innerHTML = '';
      }
    };
  }, [api, enabled, launcherAdapter, pluginId, restartToken, surfaceTelemetryContext, windowId]);

  if (!plugin) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 12, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Not Installed</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{pluginId}</div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 12, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Disabled</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{pluginId}</div>
      </div>
    );
  }

  if (launcherAdapter?.mode === 'sandbox') {
    return launcherAdapter.renderSurface({
      pluginId,
      hostLabel: 'PluginWindowHost',
      surface: { kind: 'window', windowId },
    });
  }

  if (runtimeResolutionError ?? error) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 12, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Window Error</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{runtimeResolutionError ?? error}</div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
