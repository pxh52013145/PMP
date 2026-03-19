import { calculatePluginWindowPosition } from './pluginWindows';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from './tauriRuntime';

const telemetry = getTelemetryLogger('windowing', 'vstManagerWindow');

export async function openVstManagerWindow(options?: {
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('VST manager windows require the Tauri runtime (use `pnpm dev:tauri`).');
  }

  const width = options?.width ?? 1024;
  const height = options?.height ?? 680;

  const position =
    typeof options?.x === 'number' &&
    typeof options?.y === 'number' &&
    isFinite(options.x) &&
    isFinite(options.y)
      ? { x: options.x, y: options.y, width, height }
      : await calculatePluginWindowPosition({ width, height });

  telemetry.info('window.vst-manager.open.requested', {
    fields: {
      width: position.width,
      height: position.height,
      hasExplicitTitle: typeof options?.title === 'string' && options.title.trim().length > 0,
    },
  });
  await invokeWithTelemetry('open_vst_manager_window', {
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
    title: options?.title ?? null,
  }, {
    moduleId: 'windowing',
    component: 'vstManagerWindow',
    event: 'window.vst-manager.open',
    successLevel: 'info',
  });
}

export async function closeVstManagerWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  telemetry.info('window.vst-manager.close.requested');
  await invokeWithTelemetry('close_vst_manager_window', undefined, {
    moduleId: 'windowing',
    component: 'vstManagerWindow',
    event: 'window.vst-manager.close',
    successLevel: 'info',
  });
}

