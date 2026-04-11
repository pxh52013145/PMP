import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { useMagnetSkin } from '../../themes/useMagnetSkin';
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function PluginMagnetHost({ pluginId }: { pluginId: string }) {
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
  const skin = useMagnetSkin(pluginId, {
    defaultRendererId: pluginId,
    defaultVariant:
      typeof plugin?.manifest.magnet?.defaultVariant === 'string' &&
      plugin.manifest.magnet.defaultVariant.trim().length > 0
        ? plugin.manifest.magnet.defaultVariant.trim()
        : 'default',
  });

  const permissions = useMemo(() => {
    void pluginStoreRevision;
    return getPmpmPluginEffectivePermissions(pluginId);
  }, [pluginId, pluginStoreRevision]);
  const runtimeResolution = useMemo(() => {
    void pluginStoreRevision;
    return resolveInstalledPmpmPluginRuntime(pluginId, {
      preferSandbox: sandboxEnabled,
      surfaceKind: 'magnet',
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
        hostLabel: 'PluginMagnetHost',
        launcherId:
          runtimeResolution?.status === 'resolved' ? runtimeResolution.launcher.id : null,
        surfaceKind: 'magnet',
        surfaceId: null,
      }),
    [pluginId, runtimeResolution]
  );
  const runtimeResolveTelemetryContext = useMemo(
    () =>
      createPluginRuntimeResolveTelemetryContext({
        pluginId,
        sourceKind: 'pmpm',
        hostLabel: 'PluginMagnetHost',
        surfaceKind: 'magnet',
        cause: 'view',
      }),
    [pluginId]
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
      'magnet',
      resolutionStatus,
      runtimeId,
      launcherId,
      runtimeResolution?.issues.join('|') ?? '',
    ].join('::');
  }, [enabled, pluginId, runtimeResolution]);

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
      hostLabel: 'PluginMagnetHost',
      permissions,
      audioService,
      commands,
      navigation,
      keybindings,
    });
  }, [audioService, commands, keybindings, navigation, permissions, pluginId]);

  const mountContext = useMemo(() => {
    const themeVariant = typeof skin.variant === 'string' && skin.variant.trim().length > 0 ? skin.variant.trim() : null;
    const themeVariantConfig = isPlainObject(skin.props) ? skin.props : null;

    const manifestDefaultVariant =
      typeof plugin?.manifest.magnet?.defaultVariant === 'string' &&
      plugin.manifest.magnet.defaultVariant.trim().length > 0
        ? plugin.manifest.magnet.defaultVariant.trim()
        : null;

    const variant = themeVariant ?? manifestDefaultVariant ?? 'default';

    return {
      surface: 'magnet' as const,
      theme: {
        variant,
        ...(themeVariantConfig ? { props: themeVariantConfig } : {}),
      },
    };
  }, [plugin?.manifest.magnet?.defaultVariant, skin.props, skin.variant]);

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
        preferSandboxLauncher: sandboxEnabled,
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

    const failureKey = `${pluginId}:${runtimeResolutionError}`;
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
  }, [enabled, launcherAdapter?.mode, pluginId, runtimeResolutionError, surfaceTelemetryContext]);

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
        hostLabel: 'PluginMagnetHost',
        surface: { kind: 'magnet' },
        mountContext,
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
        recordPmpmPluginCrash(pluginId, err, 'magnet');
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
  }, [api, enabled, launcherAdapter, mountContext, pluginId, restartToken, surfaceTelemetryContext]);

  if (!plugin) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Not Installed</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{pluginId}</div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Disabled</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{pluginId}</div>
      </div>
    );
  }

  if (launcherAdapter?.mode === 'sandbox') {
    return launcherAdapter.renderSurface({
      pluginId,
      hostLabel: 'PluginMagnetHost',
      surface: { kind: 'magnet' },
      mountContext,
    });
  }

  if (runtimeResolutionError ?? error) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Error</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{runtimeResolutionError ?? error}</div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
