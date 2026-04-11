import type {
  RuntimeActivate,
  RuntimeCarrier,
  RuntimeKind,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginRuntimeResolution } from './runtime/types';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

export type PluginLifecycleSourceKind = 'pmpm' | 'extv2';

export type PluginLifecycleTelemetryContext = {
  pluginId: string;
  sourceKind: PluginLifecycleSourceKind;
  hostLabel?: string | null;
  launcherId?: string | null;
  runtimeId?: string | null;
  runtimeInstanceId?: string | null;
  runtimeKind?: RuntimeKind | string | null;
  carrier?: RuntimeCarrier | string | null;
  surfaceKind?: string | null;
  surfaceId?: string | null;
  cause?: string | null;
};

export type PluginLifecycleTelemetryHandle = {
  context: PluginLifecycleTelemetryContext;
  startedAtMs: number;
};

type PluginLifecycleExtraFields = Record<string, unknown>;

const telemetry = getTelemetryLogger('plugins', 'pluginLifecycleTelemetry');

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getNowMs(): number {
  return Date.now();
}

function isPluginLifecycleTelemetryHandle(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext
): input is PluginLifecycleTelemetryHandle {
  return 'startedAtMs' in input;
}

function mergeFields(
  context: PluginLifecycleTelemetryContext,
  status: string,
  options: {
    startedAtMs?: number | null;
    extraFields?: PluginLifecycleExtraFields;
  } = {}
): PluginLifecycleExtraFields {
  const fields: PluginLifecycleExtraFields = {
    pluginId: context.pluginId,
    sourceKind: context.sourceKind,
    hostLabel: context.hostLabel ?? null,
    launcherId: context.launcherId ?? null,
    runtimeId: context.runtimeId ?? null,
    runtimeInstanceId: context.runtimeInstanceId ?? null,
    runtimeKind: context.runtimeKind ?? null,
    carrier: context.carrier ?? null,
    surfaceKind: context.surfaceKind ?? null,
    surfaceId: context.surfaceId ?? null,
    cause: context.cause ?? null,
    status,
  };

  if (typeof options.startedAtMs === 'number' && Number.isFinite(options.startedAtMs)) {
    fields.durationMs = Math.max(0, getNowMs() - options.startedAtMs);
  }

  if (options.extraFields) {
    Object.assign(fields, options.extraFields);
  }

  return fields;
}

export function createPluginSurfaceTelemetryContext(input: {
  pluginId: string;
  sourceKind: PluginLifecycleSourceKind;
  hostLabel?: string | null;
  launcherId?: string | null;
  surfaceKind: string;
  surfaceId?: string | null;
}): PluginLifecycleTelemetryContext {
  return {
    pluginId: input.pluginId,
    sourceKind: input.sourceKind,
    hostLabel: normalizeString(input.hostLabel),
    launcherId: normalizeString(input.launcherId),
    surfaceKind: normalizeString(input.surfaceKind),
    surfaceId: normalizeString(input.surfaceId),
    cause: 'view',
  };
}

export function createPluginRuntimeTelemetryContext(input: {
  pluginId: string;
  sourceKind: PluginLifecycleSourceKind;
  hostLabel?: string | null;
  launcherId?: string | null;
  runtimeId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  runtimeActivate: RuntimeActivate;
}): PluginLifecycleTelemetryContext {
  const payload = asObject(input.runtimeActivate.payload);
  const surfaceKind =
    normalizeString(payload?.surface) ??
    (input.runtimeActivate.cause === 'command' ? 'command' : null);
  const surfaceId =
    normalizeString(payload?.surfaceId) ?? normalizeString(payload?.commandId) ?? null;

  return {
    pluginId: input.pluginId,
    sourceKind: input.sourceKind,
    hostLabel: normalizeString(input.hostLabel),
    launcherId: normalizeString(input.launcherId),
    runtimeId: normalizeString(input.runtimeId),
    runtimeInstanceId: normalizeString(input.runtimeInstanceId),
    runtimeKind: input.runtimeKind,
    carrier: input.carrier,
    surfaceKind,
    surfaceId,
    cause: normalizeString(input.runtimeActivate.cause),
  };
}

export function createPluginRuntimeResolveTelemetryContext(input: {
  pluginId: string;
  sourceKind: PluginLifecycleSourceKind;
  hostLabel?: string | null;
  surfaceKind?: string | null;
  surfaceId?: string | null;
  cause: string;
}): PluginLifecycleTelemetryContext {
  return {
    pluginId: input.pluginId,
    sourceKind: input.sourceKind,
    hostLabel: normalizeString(input.hostLabel),
    surfaceKind: normalizeString(input.surfaceKind),
    surfaceId: normalizeString(input.surfaceId),
    cause: normalizeString(input.cause),
  };
}

export function createPluginSidecarTelemetryContext(input: {
  pluginId: string;
  sourceKind: PluginLifecycleSourceKind;
  hostLabel?: string | null;
  runtimeId: string;
  runtimeInstanceId: string;
  surfaceKind?: string | null;
  surfaceId?: string | null;
  cause?: string | null;
}): PluginLifecycleTelemetryContext {
  return {
    pluginId: input.pluginId,
    sourceKind: input.sourceKind,
    hostLabel: normalizeString(input.hostLabel),
    launcherId: 'pxp.sidecar.native-process',
    runtimeId: normalizeString(input.runtimeId),
    runtimeInstanceId: normalizeString(input.runtimeInstanceId),
    runtimeKind: 'sidecar',
    carrier: 'native-process',
    surfaceKind: normalizeString(input.surfaceKind),
    surfaceId: normalizeString(input.surfaceId),
    cause: normalizeString(input.cause),
  };
}

function buildPluginRuntimeResolveFields(
  resolution: PluginRuntimeResolution | null | undefined
): PluginLifecycleExtraFields {
  if (!resolution) {
    return {
      resolutionStatus: 'missing-record',
      hostId: null,
      runtimeId: null,
      runtimeKind: null,
      launcherId: null,
      runtimeSource: null,
      issueCount: 0,
      issues: [],
      compatLayerIds: [],
      candidateLauncherIds: [],
      compatMode: 'none',
    };
  }

  if (resolution.status === 'resolved') {
    const compatMode =
      resolution.source === 'compat-runtime'
        ? 'active'
        : resolution.compatLayerIds.length > 0
          ? 'fallback-available'
          : 'none';
    return {
      resolutionStatus: 'resolved',
      hostId: resolution.hostId,
      runtimeId: resolution.runtime.runtimeId,
      runtimeKind: resolution.runtime.kind,
      launcherId: resolution.launcher.id,
      runtimeSource: resolution.source,
      issueCount: resolution.issues.length,
      issues: [...resolution.issues],
      compatLayerIds: [...resolution.compatLayerIds],
      candidateLauncherIds: [resolution.launcher.id],
      compatMode,
    };
  }

  return {
    resolutionStatus: 'blocked',
    hostId: resolution.hostId,
    runtimeId: resolution.runtime?.runtimeId ?? null,
    runtimeKind: resolution.runtime?.kind ?? null,
    launcherId: null,
    runtimeSource: null,
    issueCount: resolution.issues.length,
    issues: [...resolution.issues],
    compatLayerIds: [...resolution.compatLayerIds],
    candidateLauncherIds: resolution.candidateLaunchers.map((launcher) => launcher.id),
    compatMode: resolution.compatLayerIds.length > 0 ? 'declared' : 'none',
  };
}

function readPluginRuntimeResolveError(
  resolution: PluginRuntimeResolution | null | undefined
): string {
  if (!resolution) return 'Plugin runtime record not found';
  if (resolution.status === 'resolved') {
    return 'Plugin runtime resolve unexpectedly failed';
  }
  return resolution.issues[0] ?? 'No compatible runtime launcher is available';
}

export function startPluginSurfaceMount(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): PluginLifecycleTelemetryHandle {
  telemetry.info('plugin.surface.mount.start', {
    fields: mergeFields(context, 'start', options),
  });
  return {
    context,
    startedAtMs: getNowMs(),
  };
}

export function completePluginSurfaceMount(
  handle: PluginLifecycleTelemetryHandle,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.surface.mount.completed', {
    fields: mergeFields(handle.context, 'completed', {
      startedAtMs: handle.startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function failPluginSurfaceMount(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.error('plugin.surface.mount.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function startPluginRuntimeActivate(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): PluginLifecycleTelemetryHandle {
  telemetry.info('plugin.runtime.activate.start', {
    fields: mergeFields(context, 'start', options),
  });
  return {
    context,
    startedAtMs: getNowMs(),
  };
}

export function completePluginRuntimeActivate(
  handle: PluginLifecycleTelemetryHandle,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.runtime.activate.completed', {
    fields: mergeFields(handle.context, 'completed', {
      startedAtMs: handle.startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function startPluginRuntimeResolve(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): PluginLifecycleTelemetryHandle {
  telemetry.info('plugin.runtime.resolve.start', {
    fields: mergeFields(context, 'start', options),
  });
  return {
    context,
    startedAtMs: getNowMs(),
  };
}

export function completePluginRuntimeResolve(
  handle: PluginLifecycleTelemetryHandle,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.runtime.resolve.completed', {
    fields: mergeFields(handle.context, 'completed', {
      startedAtMs: handle.startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function failPluginRuntimeResolve(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.warn('plugin.runtime.resolve.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function reportPluginRuntimeResolve(input: {
  context: PluginLifecycleTelemetryContext;
  resolution: PluginRuntimeResolution | null | undefined;
  extraFields?: PluginLifecycleExtraFields;
}): void {
  const handle = startPluginRuntimeResolve(input.context, {
    extraFields: input.extraFields,
  });
  const resolutionFields = {
    ...buildPluginRuntimeResolveFields(input.resolution),
    ...(input.extraFields ?? {}),
  };

  if (input.resolution?.status === 'resolved') {
    completePluginRuntimeResolve(handle, {
      extraFields: resolutionFields,
    });
    return;
  }

  failPluginRuntimeResolve(handle, readPluginRuntimeResolveError(input.resolution), {
    extraFields: resolutionFields,
  });
}

export function reportPluginSidecarBridgeOpened(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.sidecar.bridge.opened', {
    fields: mergeFields(context, 'opened', options),
  });
}

export function reportPluginSidecarBridgeFailed(
  context: PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.error('plugin.sidecar.bridge.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', options),
  });
}

export function reportPluginSidecarProcessUnresponsive(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.warn('plugin.sidecar.process.unresponsive', {
    fields: mergeFields(context, 'unresponsive', options),
  });
}

export function reportPluginSidecarProcessForcedTeardown(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.warn('plugin.sidecar.process.forced-teardown', {
    fields: mergeFields(context, 'forced-teardown', options),
  });
}

export function startPluginGovernanceRevoke(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): PluginLifecycleTelemetryHandle {
  telemetry.info('plugin.governance.revoke.start', {
    fields: mergeFields(context, 'start', options),
  });
  return {
    context,
    startedAtMs: getNowMs(),
  };
}

export function completePluginGovernanceRevoke(
  handle: PluginLifecycleTelemetryHandle,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.governance.revoke.completed', {
    fields: mergeFields(handle.context, 'completed', {
      startedAtMs: handle.startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function timeoutPluginGovernanceRevoke(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.warn('plugin.governance.revoke.timeout', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'timeout', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function failPluginGovernanceRevoke(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.error('plugin.governance.revoke.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function startPluginGovernanceCleanup(
  context: PluginLifecycleTelemetryContext,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): PluginLifecycleTelemetryHandle {
  telemetry.info('plugin.governance.cleanup.start', {
    fields: mergeFields(context, 'start', options),
  });
  return {
    context,
    startedAtMs: getNowMs(),
  };
}

export function completePluginGovernanceCleanup(
  handle: PluginLifecycleTelemetryHandle,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  telemetry.info('plugin.governance.cleanup.completed', {
    fields: mergeFields(handle.context, 'completed', {
      startedAtMs: handle.startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function failPluginGovernanceCleanup(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.error('plugin.governance.cleanup.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}

export function failPluginRuntimeActivate(
  input: PluginLifecycleTelemetryHandle | PluginLifecycleTelemetryContext,
  error: unknown,
  options: { extraFields?: PluginLifecycleExtraFields } = {}
): void {
  const context = isPluginLifecycleTelemetryHandle(input) ? input.context : input;
  const startedAtMs = isPluginLifecycleTelemetryHandle(input) ? input.startedAtMs : undefined;
  telemetry.error('plugin.runtime.activate.failed', {
    message: readErrorMessage(error),
    fields: mergeFields(context, 'failed', {
      startedAtMs,
      extraFields: options.extraFields,
    }),
  });
}
