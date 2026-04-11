import { isTauriRuntime } from './tauriRuntime';
import { getMainWindowBounds } from './editorWindows';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import type { PluginSurfaceSourceKind } from '../contracts/pluginSurfaceSource';

export type PluginWindowId = string;

export interface PluginWindowConfig {
  sourceKind?: PluginSurfaceSourceKind;
  pluginId: string;
  windowId: PluginWindowId;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const telemetry = getTelemetryLogger('windowing', 'pluginWindows');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSafeId(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value) && value.length > 0 && value.length <= 48;
}

export async function calculatePluginWindowPosition(options: {
  width: number;
  height: number;
}): Promise<{ x: number; y: number; width: number; height: number }> {
  const width = Math.max(240, options.width);
  const height = Math.max(180, options.height);

  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;

  // Prefer centering around the main window if available; otherwise center on screen.
  const main = await getMainWindowBounds();
  const centerX = main.x + main.width / 2;
  const centerY = main.y + main.height / 2;

  const x = Math.max(20, Math.min(centerX - width / 2, screenWidth - width - 20));
  const y = Math.max(20, Math.min(centerY - height / 2, screenHeight - height - 20));

  return { x, y, width, height };
}

export async function openPluginWindow(
  config: Omit<PluginWindowConfig, 'x' | 'y' | 'width' | 'height'> & {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Plugin windows require the Tauri runtime (use `pnpm dev:tauri`).');
  }
  if (!isSafeId(config.pluginId)) {
    throw new Error(`Invalid pluginId "${config.pluginId}"`);
  }
  if (!isSafeId(config.windowId)) {
    throw new Error(`Invalid windowId "${config.windowId}"`);
  }
  const sourceKind = config.sourceKind ?? 'pmpm';

  const width = config.width ?? 720;
  const height = config.height ?? 520;

  const position =
    typeof config.x === 'number' &&
    typeof config.y === 'number' &&
    isFinite(config.x) &&
    isFinite(config.y)
      ? { x: config.x, y: config.y, width, height }
      : await calculatePluginWindowPosition({ width, height });

  try {
    await invokeWithTelemetry('open_plugin_window', {
      sourceKind,
      pluginId: config.pluginId,
      windowId: config.windowId,
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
      title: config.title ?? null,
    }, {
      moduleId: 'windowing',
      component: 'pluginWindows',
      event: 'window.plugin.open',
      successLevel: 'info',
    });
  } catch (error) {
    telemetry.error('window.plugin.open.failed', {
      message: getErrorMessage(error),
      fields: {
        sourceKind,
        pluginId: config.pluginId,
        windowId: config.windowId,
      },
    });
    throw error;
  }
}

export async function closePluginWindow(
  pluginId: string,
  windowId: string,
  sourceKind: PluginSurfaceSourceKind = 'pmpm'
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!isSafeId(pluginId) || !isSafeId(windowId)) return;

  try {
    await invokeWithTelemetry('close_plugin_window', {
      sourceKind,
      pluginId,
      windowId,
    }, {
      moduleId: 'windowing',
      component: 'pluginWindows',
      event: 'window.plugin.close',
      successLevel: 'info',
    });
  } catch (error) {
    telemetry.error('window.plugin.close.failed', {
      message: getErrorMessage(error),
      fields: {
        sourceKind,
        pluginId,
        windowId,
      },
    });
    throw error;
  }
}

