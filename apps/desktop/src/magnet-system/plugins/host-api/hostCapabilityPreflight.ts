import type {
  PmpHostCapabilityPreflightDecision,
  PmpHostCapabilityPreflightRequest,
  PmpHostCapabilityPreflightRequestKind,
} from '@pixel-matrix/plugin-platform-contracts';
import { invokeWithTelemetry } from '../../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../../utils/tauriRuntime';

export type PmpHostCapabilityPreflightInput = Omit<
  PmpHostCapabilityPreflightRequest,
  'permissions'
> & {
  permissions: ReadonlySet<string>;
  requestKind: PmpHostCapabilityPreflightRequestKind;
};

export async function preflightPmpHostCapabilityInRust(
  input: PmpHostCapabilityPreflightInput
): Promise<PmpHostCapabilityPreflightDecision | null> {
  if (!input.capabilityId.startsWith('host.pmp.')) {
    return null;
  }
  if (!isTauriRuntime()) {
    return null;
  }

  return await invokeWithTelemetry<PmpHostCapabilityPreflightDecision>(
    'plugin_host_capability_preflight',
    {
      request: {
        pluginId: input.pluginId,
        hostLabel: input.hostLabel,
        capabilityId: input.capabilityId,
        method: input.method,
        payload: input.payload,
        permissions: Array.from(input.permissions.values()).sort((left, right) =>
          left.localeCompare(right)
        ),
        requestKind: input.requestKind,
      } satisfies PmpHostCapabilityPreflightRequest,
    },
    {
      moduleId: 'extensions-plugin',
      component: 'hostCapabilityPreflight',
      event: 'plugin.host-capability.preflight',
      successLevel: 'debug',
      failureLevel: 'warn',
    }
  );
}

export function mapPreflightDiagnosticToCapabilityErrorCode(diagnosticCode: string): string {
  if (diagnosticCode.startsWith('permission.')) return 'FORBIDDEN';
  if (diagnosticCode.startsWith('payload.')) return 'INVALID_PAYLOAD';
  if (diagnosticCode.startsWith('method.')) return 'METHOD_NOT_SUPPORTED';
  if (diagnosticCode.startsWith('capability.')) return 'NOT_FOUND';
  return 'PREFLIGHT_DENIED';
}

export function shouldThrowPreflightDeny(diagnosticCode: string): boolean {
  return (
    diagnosticCode === 'permission.hostDenied' ||
    diagnosticCode === 'permission.capabilityDenied' ||
    diagnosticCode === 'capability.invalid' ||
    diagnosticCode === 'capability.notHostPmp' ||
    diagnosticCode === 'capability.unknown' ||
    diagnosticCode === 'context.invalid'
  );
}
