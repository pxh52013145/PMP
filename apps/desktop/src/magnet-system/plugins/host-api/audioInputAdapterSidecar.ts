import { invoke } from '@tauri-apps/api/tauri';

import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { registerAudioInputAdapterProvider } from './capabilities';
import type {
  PluginHostAudioInputAdapterProviderHealth,
  PluginHostAudioInputAdapterProviderHealthStatus,
  PluginHostAudioInputAdapterProviderInfo,
  PluginHostAudioInputAdapterProviderOpenSessionResult,
} from './types';

type SidecarInvoke = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;

type SidecarCommandMap = {
  describe: string;
  probe: string;
  openSession: string;
  closeSession: string;
  health: string;
};

type SidecarHandshakeSnapshot = {
  ok: boolean;
  checkedAtMs: number;
  protocolVersion?: string;
  reason?: string;
};

export type AudioInputAdapterSidecarProviderOptions = {
  info: PluginHostAudioInputAdapterProviderInfo;
  setAsDefault?: boolean;
  commandPrefix?: string;
  commands?: Partial<SidecarCommandMap>;
  invokeFn?: SidecarInvoke;
  isTauriRuntimeFn?: () => boolean;
  handshakeCacheTtlMs?: number;
};

const DEFAULT_COMMAND_PREFIX = 'native_audio_decoder_sidecar';
const DEFAULT_HANDSHAKE_CACHE_TTL_MS = 5_000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error.trim();
  return 'Unknown runtime error';
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function isCommandUnavailableError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes('unknown command') ||
    message.includes('not found') ||
    message.includes('not implemented') ||
    message.includes('unimplemented')
  );
}

function normalizeHealthStatus(status: unknown): PluginHostAudioInputAdapterProviderHealthStatus {
  if (status === 'ready' || status === 'degraded' || status === 'offline') {
    return status;
  }
  return 'offline';
}

function normalizeScore(score: unknown): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0.5;
  return Math.max(0, Math.min(1, score));
}

function getMajorVersion(version: string): string {
  const normalized = version.trim();
  const match = /^([0-9]+)/.exec(normalized);
  return match?.[1] ?? '';
}

function isProtocolCompatible(expectedProtocolVersion: string, actualProtocolVersion: string): boolean {
  const expectedMajor = getMajorVersion(expectedProtocolVersion);
  const actualMajor = getMajorVersion(actualProtocolVersion);
  if (!expectedMajor || !actualMajor) return true;
  return expectedMajor === actualMajor;
}

function buildCommandMap(options: AudioInputAdapterSidecarProviderOptions): SidecarCommandMap {
  const commandPrefix =
    typeof options.commandPrefix === 'string' && options.commandPrefix.trim().length > 0
      ? options.commandPrefix.trim()
      : DEFAULT_COMMAND_PREFIX;
  const override = options.commands ?? {};

  return {
    describe: override.describe ?? `${commandPrefix}_describe_provider`,
    probe: override.probe ?? `${commandPrefix}_probe`,
    openSession: override.openSession ?? `${commandPrefix}_open_session`,
    closeSession: override.closeSession ?? `${commandPrefix}_close_session`,
    health: override.health ?? `${commandPrefix}_health`,
  };
}

export function registerAudioInputAdapterSidecarProvider(
  options: AudioInputAdapterSidecarProviderOptions
): () => void {
  const invokeFn = options.invokeFn ?? ((command: string, payload?: Record<string, unknown>) => invoke(command, payload));
  const runtimeCheck = options.isTauriRuntimeFn ?? isTauriRuntime;
  const commandMap = buildCommandMap(options);
  const handshakeCacheTtlMs =
    typeof options.handshakeCacheTtlMs === 'number' && Number.isFinite(options.handshakeCacheTtlMs)
      ? Math.max(100, Math.floor(options.handshakeCacheTtlMs))
      : DEFAULT_HANDSHAKE_CACHE_TTL_MS;

  let handshakeSnapshot: SidecarHandshakeSnapshot | null = null;

  const describeSidecar = async (force = false): Promise<SidecarHandshakeSnapshot> => {
    const nowMs = Date.now();
    if (
      !force &&
      handshakeSnapshot &&
      nowMs - handshakeSnapshot.checkedAtMs <= handshakeCacheTtlMs
    ) {
      return handshakeSnapshot;
    }

    if (!runtimeCheck()) {
      handshakeSnapshot = {
        ok: false,
        checkedAtMs: nowMs,
        reason: 'non-tauri-runtime',
      };
      return handshakeSnapshot;
    }

    try {
      const response = await invokeFn(commandMap.describe, {
        providerId: options.info.id,
        protocolVersion: options.info.protocolVersion,
      });
      const payload = asObject(response);
      const ready = payload?.ready !== false;
      const sidecarProtocolVersion =
        asNonEmptyString(payload?.protocolVersion) ?? options.info.protocolVersion;

      if (!isProtocolCompatible(options.info.protocolVersion, sidecarProtocolVersion)) {
        handshakeSnapshot = {
          ok: false,
          checkedAtMs: nowMs,
          protocolVersion: sidecarProtocolVersion,
          reason: `protocol mismatch (host=${options.info.protocolVersion}, sidecar=${sidecarProtocolVersion})`,
        };
        return handshakeSnapshot;
      }

      if (!ready) {
        handshakeSnapshot = {
          ok: false,
          checkedAtMs: nowMs,
          protocolVersion: sidecarProtocolVersion,
          reason: asNonEmptyString(payload?.message) ?? 'sidecar-not-ready',
        };
        return handshakeSnapshot;
      }

      handshakeSnapshot = {
        ok: true,
        checkedAtMs: nowMs,
        protocolVersion: sidecarProtocolVersion,
      };
      return handshakeSnapshot;
    } catch (error) {
      handshakeSnapshot = {
        ok: false,
        checkedAtMs: nowMs,
        reason: isCommandUnavailableError(error)
          ? 'sidecar-command-unavailable'
          : toErrorMessage(error),
      };
      return handshakeSnapshot;
    }
  };

  return registerAudioInputAdapterProvider(
    {
      info: options.info,
      probe: async ({ sourcePath, preferredInputId }) => {
        const handshake = await describeSidecar();
        if (!handshake.ok) {
          return {
            supported: false,
            reason: handshake.reason ?? 'sidecar-unavailable',
          };
        }

        try {
          const response = await invokeFn(commandMap.probe, {
            providerId: options.info.id,
            protocolVersion: options.info.protocolVersion,
            sourcePath,
            preferredInputId: preferredInputId ?? null,
          });

          const payload = asObject(response);
          if (!payload) {
            return {
              supported: false,
              reason: 'invalid-sidecar-probe-response',
            };
          }

          const supported = payload.supported === true;
          if (!supported) {
            return {
              supported: false,
              reason: asNonEmptyString(payload.reason) ?? 'probe-not-supported',
              details: payload.details,
            };
          }

          return {
            supported: true,
            score: normalizeScore(payload.score),
            inputId: asNonEmptyString(payload.inputId) ?? undefined,
            reason: asNonEmptyString(payload.reason) ?? undefined,
            details: payload.details,
          };
        } catch (error) {
          return {
            supported: false,
            reason: toErrorMessage(error),
          };
        }
      },
      openSession: async ({ sourcePath, preferredInputId }): Promise<PluginHostAudioInputAdapterProviderOpenSessionResult> => {
        const handshake = await describeSidecar();
        if (!handshake.ok) {
          throw new Error(handshake.reason ?? 'sidecar-unavailable');
        }

        const response = await invokeFn(commandMap.openSession, {
          providerId: options.info.id,
          protocolVersion: options.info.protocolVersion,
          sourcePath,
          preferredInputId: preferredInputId ?? null,
        });

        const payload = asObject(response);
        if (!payload) {
          return {};
        }

        return {
          providerSessionId: asNonEmptyString(payload.providerSessionId) ?? undefined,
          selectedInputId: asNonEmptyString(payload.selectedInputId) ?? undefined,
          metadata: Object.prototype.hasOwnProperty.call(payload, 'metadata')
            ? payload.metadata
            : undefined,
        };
      },
      closeSession: async ({ sessionId, providerSessionId }) => {
        await invokeFn(commandMap.closeSession, {
          providerId: options.info.id,
          protocolVersion: options.info.protocolVersion,
          sessionId,
          providerSessionId: providerSessionId ?? null,
        });
      },
      health: async (): Promise<PluginHostAudioInputAdapterProviderHealth> => {
        if (!runtimeCheck()) {
          return {
            status: 'offline',
            message: 'non-tauri-runtime',
          };
        }

        try {
          const response = await invokeFn(commandMap.health, {
            providerId: options.info.id,
            protocolVersion: options.info.protocolVersion,
          });
          const payload = asObject(response);

          if (!payload) {
            return {
              status: 'offline',
              message: 'invalid-sidecar-health-response',
            };
          }

          return {
            status: normalizeHealthStatus(payload.status),
            message: asNonEmptyString(payload.message) ?? undefined,
          };
        } catch (error) {
          if (isCommandUnavailableError(error)) {
            const handshake = await describeSidecar();
            return {
              status: handshake.ok ? 'ready' : 'offline',
              message: handshake.reason,
            };
          }

          return {
            status: 'offline',
            message: toErrorMessage(error),
          };
        }
      },
    },
    { setAsDefault: options.setAsDefault }
  );
}

