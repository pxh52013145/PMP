import type { RuntimeBridgePort } from './runtimeBridgeHostSession';
import type { RuntimeArtifactIntegrityDeps } from './runtimeArtifactIntegrity';
import type { PluginLifecycleSourceKind } from '../pluginLifecycleTelemetry';

export interface RuntimeSidecarPortController {
  port: RuntimeBridgePort;
  dispose: (reason?: string) => Promise<void> | void;
}

export interface CreateRuntimeSidecarPortControllerOptions {
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  entryPath: string;
  commandId: string;
  args?: unknown;
  timeoutMs: number;
  telemetry?: {
    sourceKind: PluginLifecycleSourceKind;
    hostLabel?: string | null;
    surfaceKind?: string | null;
    surfaceId?: string | null;
    cause?: string | null;
  };
}

export interface RuntimeSidecarCommandDeps {
  createPortController?: (
    options: CreateRuntimeSidecarPortControllerOptions
  ) => Promise<RuntimeSidecarPortController> | RuntimeSidecarPortController;
  readArtifactBytes?: RuntimeArtifactIntegrityDeps['readArtifactBytes'];
  now?: () => number;
}
