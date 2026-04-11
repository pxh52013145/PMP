import type {
  ShellSurfacePointerPolicy,
  ShellSurfaceType,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginSurfaceSourceKind } from '../contracts/pluginSurfaceSource';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import { getMainWindowBounds } from './editorWindows';
import { isTauriRuntime } from './tauriRuntime';

export interface PluginShellSurfaceConfig {
  sourceKind?: PluginSurfaceSourceKind;
  pluginId: string;
  surfaceId: string;
  surfaceType: ShellSurfaceType;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alwaysOnTop?: boolean;
  focusable?: boolean;
  pointerPolicy?: ShellSurfacePointerPolicy;
}

const telemetry = getTelemetryLogger('windowing', 'pluginShellSurfaces');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSafeId(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value) && value.length > 0 && value.length <= 48;
}

function isShellSurfaceType(value: string): value is ShellSurfaceType {
  return value === 'overlay' || value === 'desktop-widget';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function buildPluginShellSurfaceRoute(
  sourceKind: PluginSurfaceSourceKind,
  surfaceType: ShellSurfaceType,
  pluginId: string,
  surfaceId: string
): string {
  return `/#/plugin-shell-surface/${sourceKind}/${surfaceType}/${pluginId}/${surfaceId}`;
}

export function buildPluginShellSurfaceEventPayload(
  sourceKind: PluginSurfaceSourceKind,
  surfaceType: ShellSurfaceType,
  pluginId: string,
  surfaceId: string
): string {
  return `${sourceKind}/${surfaceType}/${pluginId}/${surfaceId}`;
}

export function resolvePluginShellSurfaceDefaults(
  config: Pick<
    PluginShellSurfaceConfig,
    'surfaceType' | 'width' | 'height' | 'alwaysOnTop' | 'focusable' | 'pointerPolicy'
  >
): {
  width: number;
  height: number;
  alwaysOnTop: boolean;
  focusable: boolean;
  pointerPolicy: ShellSurfacePointerPolicy;
} {
  const pointerPolicy = config.pointerPolicy ?? 'capture-input';
  const width = Math.max(
    config.surfaceType === 'overlay' ? 320 : 220,
    Math.floor(config.width ?? (config.surfaceType === 'overlay' ? 480 : 320))
  );
  const height = Math.max(
    config.surfaceType === 'overlay' ? 180 : 160,
    Math.floor(config.height ?? (config.surfaceType === 'overlay' ? 320 : 240))
  );
  const alwaysOnTop = config.alwaysOnTop ?? config.surfaceType === 'overlay';
  const focusable =
    config.focusable ?? (pointerPolicy === 'capture-input' ? true : false);

  return {
    width,
    height,
    alwaysOnTop,
    focusable,
    pointerPolicy,
  };
}

export async function calculatePluginShellSurfacePosition(options: {
  surfaceType: ShellSurfaceType;
  width: number;
  height: number;
}): Promise<{ x: number; y: number; width: number; height: number }> {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const screenWidth = Math.max(width + 48, window.screen.availWidth || width + 48);
  const screenHeight = Math.max(height + 48, window.screen.availHeight || height + 48);
  const margin = 24;

  if (options.surfaceType === 'desktop-widget') {
    return {
      x: clamp(screenWidth - width - margin, margin, Math.max(margin, screenWidth - width - margin)),
      y: clamp(
        screenHeight - height - margin,
        margin,
        Math.max(margin, screenHeight - height - margin)
      ),
      width,
      height,
    };
  }

  const main = await getMainWindowBounds();
  const centerX = main.x + main.width / 2;
  const centerY = main.y + main.height / 2;

  return {
    x: clamp(centerX - width / 2, margin, Math.max(margin, screenWidth - width - margin)),
    y: clamp(centerY - height / 2, margin, Math.max(margin, screenHeight - height - margin)),
    width,
    height,
  };
}

export async function openPluginShellSurface(config: PluginShellSurfaceConfig): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Plugin shell surfaces require the Tauri runtime (use `pnpm dev:tauri`).');
  }
  if (!isSafeId(config.pluginId)) {
    throw new Error(`Invalid pluginId "${config.pluginId}"`);
  }
  if (!isSafeId(config.surfaceId)) {
    throw new Error(`Invalid surfaceId "${config.surfaceId}"`);
  }
  if (!isShellSurfaceType(config.surfaceType)) {
    throw new Error(`Invalid surfaceType "${config.surfaceType}"`);
  }

  const sourceKind = config.sourceKind ?? 'pmpm';
  const defaults = resolvePluginShellSurfaceDefaults(config);
  const position =
    typeof config.x === 'number' &&
    Number.isFinite(config.x) &&
    typeof config.y === 'number' &&
    Number.isFinite(config.y)
      ? {
          x: Math.floor(config.x),
          y: Math.floor(config.y),
          width: defaults.width,
          height: defaults.height,
        }
      : await calculatePluginShellSurfacePosition({
          surfaceType: config.surfaceType,
          width: defaults.width,
          height: defaults.height,
        });

  try {
    await invokeWithTelemetry(
      'open_plugin_shell_surface',
      {
        sourceKind,
        pluginId: config.pluginId,
        surfaceId: config.surfaceId,
        surfaceType: config.surfaceType,
        title: config.title ?? null,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        alwaysOnTop: defaults.alwaysOnTop,
        focusable: defaults.focusable,
        pointerPolicy: defaults.pointerPolicy,
      },
      {
        moduleId: 'windowing',
        component: 'pluginShellSurfaces',
        event: 'window.plugin-shell-surface.open',
        successLevel: 'info',
      }
    );
  } catch (error) {
    telemetry.error('window.plugin-shell-surface.open.failed', {
      message: getErrorMessage(error),
      fields: {
        sourceKind,
        pluginId: config.pluginId,
        surfaceId: config.surfaceId,
        surfaceType: config.surfaceType,
      },
    });
    throw error;
  }
}

export async function dismissPluginShellSurface(
  pluginId: string,
  surfaceId: string,
  surfaceType: ShellSurfaceType,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!isSafeId(pluginId) || !isSafeId(surfaceId) || !isShellSurfaceType(surfaceType)) {
    return;
  }

  try {
    await invokeWithTelemetry(
      'dismiss_plugin_shell_surface',
      {
        sourceKind,
        pluginId,
        surfaceId,
        surfaceType,
      },
      {
        moduleId: 'windowing',
        component: 'pluginShellSurfaces',
        event: 'window.plugin-shell-surface.dismiss',
        successLevel: 'info',
      }
    );
  } catch (error) {
    telemetry.error('window.plugin-shell-surface.dismiss.failed', {
      message: getErrorMessage(error),
      fields: {
        sourceKind,
        pluginId,
        surfaceId,
        surfaceType,
      },
    });
    throw error;
  }
}

export async function destroyPluginShellSurface(
  pluginId: string,
  surfaceId: string,
  surfaceType: ShellSurfaceType,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!isSafeId(pluginId) || !isSafeId(surfaceId) || !isShellSurfaceType(surfaceType)) {
    return;
  }

  try {
    await invokeWithTelemetry(
      'destroy_plugin_shell_surface',
      {
        sourceKind,
        pluginId,
        surfaceId,
        surfaceType,
      },
      {
        moduleId: 'windowing',
        component: 'pluginShellSurfaces',
        event: 'window.plugin-shell-surface.destroy',
        successLevel: 'info',
      }
    );
  } catch (error) {
    telemetry.error('window.plugin-shell-surface.destroy.failed', {
      message: getErrorMessage(error),
      fields: {
        sourceKind,
        pluginId,
        surfaceId,
        surfaceType,
      },
    });
    throw error;
  }
}
