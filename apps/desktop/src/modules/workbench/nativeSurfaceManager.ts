import type {
  WorkbenchNativeSurfaceContent,
  WorkbenchStateSnapshot,
  WorkbenchSurfaceRegion,
  WorkbenchSurfaceSpec,
} from '../../contracts/workbench';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export interface WorkbenchNativeSurfaceOpenConfig {
  surfaceId: string;
  region: WorkbenchSurfaceRegion;
  width: number;
  height: number;
  title: string | null;
}

export interface ResolveWorkbenchNativeSurfaceConfigOptions {
  surfaceIds?: readonly string[];
}

export interface WorkbenchNativeSurfaceManager {
  openSurfaces(
    snapshot: WorkbenchStateSnapshot,
    options?: ResolveWorkbenchNativeSurfaceConfigOptions
  ): Promise<WorkbenchNativeSurfaceOpenConfig[]>;
  updateContent(surfaceId: string, content: WorkbenchNativeSurfaceContent): Promise<void>;
  syncGeometry(): Promise<void>;
  closeSurface(surfaceId: string): Promise<void>;
  closeAll(): Promise<void>;
}

const telemetry = getTelemetryLogger('windowing', 'WorkbenchNativeSurfaceManager');

const SUPPORTED_NATIVE_SURFACE_REGIONS: readonly WorkbenchSurfaceRegion[] = ['bottom', 'right'];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSupportedNativeSurface(surface: WorkbenchSurfaceSpec): boolean {
  return (
    surface.visible &&
    surface.carrierHint === 'native' &&
    SUPPORTED_NATIVE_SURFACE_REGIONS.includes(surface.region) &&
    (surface.kind === 'timeline' || surface.kind === 'outliner')
  );
}

function fallbackSurfaceTitle(surface: WorkbenchSurfaceSpec): string | null {
  if (typeof surface.title === 'string' && surface.title.trim().length > 0) {
    return surface.title.trim();
  }
  return null;
}

function resolveSurfaceSize(surface: WorkbenchSurfaceSpec): { width: number; height: number } {
  if (surface.region === 'bottom') {
    return {
      width: Math.max(1, Math.floor(surface.width ?? surface.minWidth ?? 1)),
      height: Math.max(44, Math.floor(surface.height ?? surface.minHeight ?? 208)),
    };
  }
  if (surface.region === 'right') {
    return {
      width: Math.max(180, Math.floor(surface.width ?? surface.minWidth ?? 300)),
      height: Math.max(1, Math.floor(surface.height ?? surface.minHeight ?? 1)),
    };
  }
  return {
    width: Math.max(1, Math.floor(surface.width ?? surface.minWidth ?? 1)),
    height: Math.max(1, Math.floor(surface.height ?? surface.minHeight ?? 1)),
  };
}

export function resolveWorkbenchNativeSurfaceOpenConfigs(
  snapshot: WorkbenchStateSnapshot,
  options: ResolveWorkbenchNativeSurfaceConfigOptions = {}
): WorkbenchNativeSurfaceOpenConfig[] {
  const allowed = options.surfaceIds ? new Set(options.surfaceIds) : null;
  return Object.values(snapshot.surfaces)
    .filter((surface) => (allowed ? allowed.has(surface.id) : true))
    .filter(isSupportedNativeSurface)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((surface) => {
      const size = resolveSurfaceSize(surface);
      return {
        surfaceId: surface.id,
        region: surface.region,
        width: size.width,
        height: size.height,
        title: fallbackSurfaceTitle(surface),
      };
    });
}

export function createWorkbenchNativeSurfaceManager(): WorkbenchNativeSurfaceManager {
  return {
    openSurfaces: async (
      snapshot: WorkbenchStateSnapshot,
      options?: ResolveWorkbenchNativeSurfaceConfigOptions
    ) => {
      const configs = resolveWorkbenchNativeSurfaceOpenConfigs(snapshot, options);
      if (!isTauriRuntime() || configs.length === 0) return configs;

      for (const config of configs) {
        try {
          await invokeWithTelemetry(
            'open_workbench_native_surface',
            {
              surfaceId: config.surfaceId,
              region: config.region,
              width: config.width,
              height: config.height,
              title: config.title,
            },
            {
              moduleId: 'windowing',
              component: 'WorkbenchNativeSurfaceManager',
              event: 'window.workbench-native-surface.open',
              successLevel: 'info',
            }
          );
        } catch (error) {
          telemetry.error('window.workbench-native-surface.open.failed', {
            message: getErrorMessage(error),
            fields: {
              surfaceId: config.surfaceId,
              region: config.region,
            },
          });
          throw error;
        }
      }

      await invokeWithTelemetry('sync_workbench_native_surfaces_geometry', undefined, {
        moduleId: 'windowing',
        component: 'WorkbenchNativeSurfaceManager',
        event: 'window.workbench-native-surface.sync-geometry',
        successLevel: 'debug',
      });

      return configs;
    },
    updateContent: async (surfaceId: string, content: WorkbenchNativeSurfaceContent) => {
      if (!isTauriRuntime()) return;
      await invokeWithTelemetry(
        'update_workbench_native_surface_content',
        { surfaceId, content },
        {
          moduleId: 'windowing',
          component: 'WorkbenchNativeSurfaceManager',
          event: 'window.workbench-native-surface.content.update',
          successLevel: 'debug',
          failureLevel: 'warn',
          slowThresholdMs: 60,
        }
      );
    },
    syncGeometry: async () => {
      if (!isTauriRuntime()) return;
      await invokeWithTelemetry('sync_workbench_native_surfaces_geometry', undefined, {
        moduleId: 'windowing',
        component: 'WorkbenchNativeSurfaceManager',
        event: 'window.workbench-native-surface.sync-geometry',
        successLevel: 'debug',
      });
    },
    closeSurface: async (surfaceId: string) => {
      if (!isTauriRuntime()) return;
      await invokeWithTelemetry(
        'close_workbench_native_surface',
        { surfaceId },
        {
          moduleId: 'windowing',
          component: 'WorkbenchNativeSurfaceManager',
          event: 'window.workbench-native-surface.close',
          successLevel: 'info',
        }
      );
    },
    closeAll: async () => {
      if (!isTauriRuntime()) return;
      await invokeWithTelemetry('close_all_workbench_native_surfaces', undefined, {
        moduleId: 'windowing',
        component: 'WorkbenchNativeSurfaceManager',
        event: 'window.workbench-native-surface.close-all',
        successLevel: 'info',
      });
    },
  };
}
