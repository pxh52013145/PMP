import { createServiceToken } from '../../kernel';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import {
  completePluginGovernanceCleanup,
  createPluginSurfaceTelemetryContext,
  failPluginGovernanceCleanup,
  startPluginGovernanceCleanup,
} from './pluginLifecycleTelemetry';
import { subscribeInstalledExtensions } from './extensions';
import {
  readHostExtensionRuntimeRestartRequest,
  subscribeHostExtensionRuntimeRestart,
  type HostExtensionRuntimeKind,
} from './hostExtensionRuntimeSupervisor';
import { subscribePmpmPlugins } from './pmpm';
import {
  dismissPluginShellSurface,
  destroyPluginShellSurface,
  openPluginShellSurface,
  type PluginShellSurfaceConfig,
} from '../../utils/pluginShellSurfaces';
import {
  readPluginShellSurfaceDescriptor,
  type PluginShellSurfaceDescriptorRecord,
} from './shellSurfaceDescriptors';

export type ManagedPluginShellSurfaceSpec = PluginShellSurfaceDescriptorRecord;

export interface ShellSurfaceManager {
  summonSurface: (spec: ManagedPluginShellSurfaceSpec) => Promise<void>;
  dismissSurface: (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    surfaceId: string;
    surfaceType: PluginShellSurfaceConfig['surfaceType'];
  }) => Promise<void>;
  cleanupSurface: (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    surfaceId: string;
    surfaceType: PluginShellSurfaceConfig['surfaceType'];
    reason?: string;
  }) => Promise<void>;
  cleanupPluginSurfaces: (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    reason?: string;
  }) => Promise<void>;
  listTrackedSurfaces: () => ManagedPluginShellSurfaceSpec[];
  start: () => void;
  dispose: () => void;
}

export const SHELL_SURFACE_MANAGER_TOKEN =
  createServiceToken<ShellSurfaceManager>('service.plugin-shell-surface-manager');

export type ShellSurfaceEnvironmentSignal =
  | 'window-focus'
  | 'document-visible'
  | 'page-resume'
  | 'page-show'
  | 'display-metrics-changed';

type ShellSurfaceManagerDeps = {
  openSurface: typeof openPluginShellSurface;
  dismissSurface: typeof dismissPluginShellSurface;
  destroySurface: typeof destroyPluginShellSurface;
  inspectSurface: typeof readPluginShellSurfaceDescriptor;
  subscribePmpm: typeof subscribePmpmPlugins;
  subscribeExtensions: typeof subscribeInstalledExtensions;
  subscribeRuntimeRestart: typeof subscribeHostExtensionRuntimeRestart;
  readRuntimeRestart: typeof readHostExtensionRuntimeRestartRequest;
  subscribeEnvironmentSignals: (
    listener: (signal: ShellSurfaceEnvironmentSignal) => void
  ) => () => void;
};

const telemetry = getTelemetryLogger('plugins', 'shellSurfaceManager');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildTrackedShellSurfaceKey(spec: {
  sourceKind: PluginSurfaceSourceKind;
  pluginId: string;
  surfaceId: string;
  surfaceType: PluginShellSurfaceConfig['surfaceType'];
}): string {
  return `${spec.sourceKind}:${spec.surfaceType}:${spec.pluginId}:${spec.surfaceId}`;
}

function buildSummonTitle(spec: ManagedPluginShellSurfaceSpec): string {
  return `${spec.pluginName}: ${spec.descriptor.title}`;
}

function buildCleanupReasonFromLookupStatus(status: 'missing-plugin' | 'disabled-plugin' | 'missing-surface'): string {
  switch (status) {
    case 'missing-plugin':
      return 'plugin-missing';
    case 'disabled-plugin':
      return 'plugin-disabled';
    case 'missing-surface':
      return 'surface-missing';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function subscribeShellSurfaceEnvironmentSignals(
  listener: (signal: ShellSurfaceEnvironmentSignal) => void
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return () => {};
  }

  const onWindowFocus = () => listener('window-focus');
  const onPageShow = () => listener('page-show');
  const onResize = () => listener('display-metrics-changed');
  const onResume = () => listener('page-resume');
  const onVisibilityChange = () => {
    if (!document.hidden) {
      listener('document-visible');
    }
  };

  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('resize', onResize);
  document.addEventListener('resume', onResume);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('resume', onResume);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export class DefaultShellSurfaceManager implements ShellSurfaceManager {
  private readonly tracked = new Map<string, ManagedPluginShellSurfaceSpec>();
  private readonly lastHandledRestartAt: Record<HostExtensionRuntimeKind, number> = {
    pmpm: 0,
    extv2: 0,
  };
  private readonly deps: ShellSurfaceManagerDeps;
  private started = false;
  private disposed = false;
  private unsubscribePmpm: (() => void) | null = null;
  private unsubscribeExtensions: (() => void) | null = null;
  private unsubscribeRuntimeRestart: (() => void) | null = null;
  private unsubscribeEnvironmentSignals: (() => void) | null = null;

  constructor(
    private readonly options: {
      enableBackgroundSync?: boolean;
      deps?: Partial<ShellSurfaceManagerDeps>;
    } = {}
  ) {
    this.deps = {
      openSurface: openPluginShellSurface,
      dismissSurface: dismissPluginShellSurface,
      destroySurface: destroyPluginShellSurface,
      inspectSurface: readPluginShellSurfaceDescriptor,
      subscribePmpm: subscribePmpmPlugins,
      subscribeExtensions: subscribeInstalledExtensions,
      subscribeRuntimeRestart: subscribeHostExtensionRuntimeRestart,
      readRuntimeRestart: readHostExtensionRuntimeRestartRequest,
      subscribeEnvironmentSignals: subscribeShellSurfaceEnvironmentSignals,
      ...(options.deps ?? {}),
    };
  }

  summonSurface = async (spec: ManagedPluginShellSurfaceSpec): Promise<void> => {
    await this.deps.openSurface(this.buildSurfaceConfig(spec));
    this.tracked.set(
      buildTrackedShellSurfaceKey({
        sourceKind: spec.sourceKind,
        pluginId: spec.pluginId,
        surfaceId: spec.descriptor.id,
        surfaceType: spec.descriptor.surfaceType,
      }),
      spec
    );
  };

  dismissSurface = async (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    surfaceId: string;
    surfaceType: PluginShellSurfaceConfig['surfaceType'];
  }): Promise<void> => {
    await this.deps.dismissSurface(
      target.pluginId,
      target.surfaceId,
      target.surfaceType,
      target.sourceKind
    );
  };

  cleanupSurface = async (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    surfaceId: string;
    surfaceType: PluginShellSurfaceConfig['surfaceType'];
    reason?: string;
  }): Promise<void> => {
    const key = buildTrackedShellSurfaceKey(target);
    const tracked = this.tracked.get(key);
    const context = createPluginSurfaceTelemetryContext({
      pluginId: target.pluginId,
      sourceKind: target.sourceKind,
      hostLabel: 'ShellSurfaceManager',
      surfaceKind: target.surfaceType,
      surfaceId: target.surfaceId,
    });
    const handle = startPluginGovernanceCleanup(context, {
      extraFields: {
        reason: target.reason ?? 'manual-cleanup',
      },
    });

    try {
      await this.deps.destroySurface(
        target.pluginId,
        target.surfaceId,
        target.surfaceType,
        target.sourceKind
      );
      this.tracked.delete(key);
      completePluginGovernanceCleanup(handle, {
        extraFields: {
          reason: target.reason ?? 'manual-cleanup',
          trackedSurfaceCount: this.tracked.size,
          sourceTitle: tracked ? buildSummonTitle(tracked) : null,
        },
      });
    } catch (error) {
      failPluginGovernanceCleanup(handle, error, {
        extraFields: {
          reason: target.reason ?? 'manual-cleanup',
          trackedSurfaceCount: this.tracked.size,
        },
      });
      throw error;
    }
  };

  cleanupPluginSurfaces = async (target: {
    sourceKind: PluginSurfaceSourceKind;
    pluginId: string;
    reason?: string;
  }): Promise<void> => {
    const matches = Array.from(this.tracked.values()).filter(
      (entry) =>
        entry.sourceKind === target.sourceKind && entry.pluginId === target.pluginId
    );

    for (const spec of matches) {
      try {
        await this.cleanupSurface({
          sourceKind: spec.sourceKind,
          pluginId: spec.pluginId,
          surfaceId: spec.descriptor.id,
          surfaceType: spec.descriptor.surfaceType,
          reason: target.reason,
        });
      } catch (error) {
        telemetry.warn('shell-surface.cleanup-plugin-surface.failed', {
          message: readErrorMessage(error),
          fields: {
            sourceKind: spec.sourceKind,
            pluginId: spec.pluginId,
            surfaceId: spec.descriptor.id,
            surfaceType: spec.descriptor.surfaceType,
            reason: target.reason ?? null,
          },
        });
      }
    }
  };

  listTrackedSurfaces = (): ManagedPluginShellSurfaceSpec[] => {
    return Array.from(this.tracked.values());
  };

  start = (): void => {
    if (this.started || this.disposed) return;
    this.started = true;

    if (this.options.enableBackgroundSync === false) {
      return;
    }

    const sync = () => {
      this.syncTrackedSurfaces();
    };

    this.unsubscribePmpm = this.deps.subscribePmpm(sync);
    this.unsubscribeExtensions = this.deps.subscribeExtensions(sync);
    this.unsubscribeRuntimeRestart = this.deps.subscribeRuntimeRestart(
      this.handleRuntimeRestartSignal
    );
    this.unsubscribeEnvironmentSignals = this.deps.subscribeEnvironmentSignals(
      this.handleEnvironmentSignal
    );
    sync();
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;

    try {
      this.unsubscribePmpm?.();
    } catch (error) {
      telemetry.warn('shell-surface.unsubscribe.pmpm.failed', {
        message: readErrorMessage(error),
      });
    }
    try {
      this.unsubscribeExtensions?.();
    } catch (error) {
      telemetry.warn('shell-surface.unsubscribe.extensions.failed', {
        message: readErrorMessage(error),
      });
    }
    try {
      this.unsubscribeRuntimeRestart?.();
    } catch (error) {
      telemetry.warn('shell-surface.unsubscribe.runtime-restart.failed', {
        message: readErrorMessage(error),
      });
    }
    try {
      this.unsubscribeEnvironmentSignals?.();
    } catch (error) {
      telemetry.warn('shell-surface.unsubscribe.environment.failed', {
        message: readErrorMessage(error),
      });
    }

    this.unsubscribePmpm = null;
    this.unsubscribeExtensions = null;
    this.unsubscribeRuntimeRestart = null;
    this.unsubscribeEnvironmentSignals = null;
  };

  private syncTrackedSurfaces(): void {
    for (const spec of Array.from(this.tracked.values())) {
      const lookup = this.deps.inspectSurface({
        sourceKind: spec.sourceKind,
        pluginId: spec.pluginId,
        surfaceId: spec.descriptor.id,
        surfaceType: spec.descriptor.surfaceType,
      });

      if (lookup.status === 'present') {
        continue;
      }

      void this.cleanupSurface({
        sourceKind: spec.sourceKind,
        pluginId: spec.pluginId,
        surfaceId: spec.descriptor.id,
        surfaceType: spec.descriptor.surfaceType,
        reason: buildCleanupReasonFromLookupStatus(lookup.status),
      }).catch((error) => {
        telemetry.warn('shell-surface.sync.cleanup.failed', {
          message: readErrorMessage(error),
          fields: {
            sourceKind: spec.sourceKind,
            pluginId: spec.pluginId,
            surfaceId: spec.descriptor.id,
            surfaceType: spec.descriptor.surfaceType,
            syncStatus: lookup.status,
          },
        });
      });
    }
  }

  private handleRuntimeRestartSignal = (): void => {
    for (const kind of ['pmpm', 'extv2'] as const) {
      const request = this.deps.readRuntimeRestart(kind);
      if (!request) continue;
      if (request.at <= this.lastHandledRestartAt[kind]) continue;
      this.lastHandledRestartAt[kind] = request.at;

      void this.cleanupPluginSurfaces({
        sourceKind: kind,
        pluginId: request.pluginId,
        reason: request.reason ?? 'runtime-restart',
      });
    }
  };

  private handleEnvironmentSignal = (signal: ShellSurfaceEnvironmentSignal): void => {
    void this.refreshTrackedSurfaces(signal);
  };

  private buildSurfaceConfig(spec: ManagedPluginShellSurfaceSpec): PluginShellSurfaceConfig {
    return {
      sourceKind: spec.sourceKind,
      pluginId: spec.pluginId,
      surfaceId: spec.descriptor.id,
      surfaceType: spec.descriptor.surfaceType,
      title: buildSummonTitle(spec),
      width: spec.descriptor.width,
      height: spec.descriptor.height,
      alwaysOnTop: spec.descriptor.alwaysOnTop,
      focusable: spec.descriptor.focusable,
      pointerPolicy: spec.descriptor.pointerPolicy,
    };
  }

  private async refreshTrackedSurfaces(signal: ShellSurfaceEnvironmentSignal): Promise<void> {
    for (const spec of Array.from(this.tracked.values())) {
      const lookup = this.deps.inspectSurface({
        sourceKind: spec.sourceKind,
        pluginId: spec.pluginId,
        surfaceId: spec.descriptor.id,
        surfaceType: spec.descriptor.surfaceType,
      });

      if (lookup.status !== 'present') {
        void this.cleanupSurface({
          sourceKind: spec.sourceKind,
          pluginId: spec.pluginId,
          surfaceId: spec.descriptor.id,
          surfaceType: spec.descriptor.surfaceType,
          reason: buildCleanupReasonFromLookupStatus(lookup.status),
        }).catch((error) => {
          telemetry.warn('shell-surface.environment.cleanup.failed', {
            message: readErrorMessage(error),
            fields: {
              sourceKind: spec.sourceKind,
              pluginId: spec.pluginId,
              surfaceId: spec.descriptor.id,
              surfaceType: spec.descriptor.surfaceType,
              signal,
              syncStatus: lookup.status,
            },
          });
        });
        continue;
      }

      try {
        await this.deps.openSurface(this.buildSurfaceConfig(spec));
      } catch (error) {
        telemetry.warn('shell-surface.environment.refresh.failed', {
          message: readErrorMessage(error),
          fields: {
            sourceKind: spec.sourceKind,
            pluginId: spec.pluginId,
            surfaceId: spec.descriptor.id,
            surfaceType: spec.descriptor.surfaceType,
            signal,
          },
        });
      }
    }
  }
}
