import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type {
  RuntimeCapsuleState,
  RuntimeLifecycleParticipant,
} from '../../contracts/runtimeCapsule';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../../services/runtime-capsules';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  DefaultInstalledExtensionRuntimeManager,
  INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN,
} from './installedExtensionRuntimeManager';
import { SHELL_SURFACE_MANAGER_TOKEN, type ShellSurfaceManager } from './shellSurfaceManager';

const PLUGIN_RUNTIME_CAPSULE_ID = 'plugin.runtime';
const PLUGIN_RUNTIME_PARTICIPANT_ID = 'installed-extension-runtime-manager';

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type InstalledExtensionRuntimeManagerModuleOptions = {
  autoStartBackgroundRuntimes?: boolean;
};

export function createInstalledExtensionRuntimeManagerModule(
  options: InstalledExtensionRuntimeManagerModuleOptions = {}
): KernelModule<AppEvents> {
  const autoStartBackgroundRuntimes = options.autoStartBackgroundRuntimes ?? true;
  return {
    id: 'installed-extension-runtime-manager',
    activate: ({ services, events }) => {
      const telemetry = getTelemetryLogger('plugins', 'installedExtensionRuntimeManagerModule');
      const service = new DefaultInstalledExtensionRuntimeManager({
        audioEngine: services.get(AUDIO_ENGINE_SERVICE_TOKEN),
        commands: services.getOptional(COMMANDS_SERVICE_TOKEN),
        navigation: services.get(NAVIGATION_SERVICE_TOKEN),
        keybindings: services.getOptional(KEYBINDINGS_SERVICE_TOKEN),
        events,
      });

      if (autoStartBackgroundRuntimes) {
        service.start();
      }
      const unregister = services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, service);
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;
      const shellSurfaceManager = services.getOptional(
        SHELL_SURFACE_MANAGER_TOKEN
      ) as ShellSurfaceManager | null;
      let participantState: RuntimeCapsuleState = 'active';
      let cleanupInProgress = false;
      const touchPluginRuntimeCapsule = (detail: string): void => {
        if (cleanupInProgress) return;
        if (!runtimeCapsuleManager) return;
        const managedRuntimeCount = service.listManagedRuntimes().length;
        const trackedShellSurfaceCount = shellSurfaceManager?.listTrackedSurfaces().length ?? 0;
        if (managedRuntimeCount + trackedShellSurfaceCount <= 0) return;

        const lease = runtimeCapsuleManager.acquireLease({
          capsuleId: PLUGIN_RUNTIME_CAPSULE_ID,
          ownerKind: 'system',
          ownerId: PLUGIN_RUNTIME_PARTICIPANT_ID,
          priority: 'background',
          reason: {
            detail,
          },
        });
        if (!lease) return;
        runtimeCapsuleManager.releaseLease(lease.id, {
          kind: 'lease-expired',
          sourceId: PLUGIN_RUNTIME_PARTICIPANT_ID,
          detail,
        });
      };
      const cleanupRuntimeResources = async (reason: string): Promise<void> => {
        cleanupInProgress = true;
        const [runtimeResult, surfaceResult, hiddenWindowResult] = await Promise.allSettled([
          service.cleanupManagedRuntimes(reason),
          shellSurfaceManager?.cleanupAllSurfaces(reason) ?? Promise.resolve(0),
          isTauriRuntime()
            ? invokeWithTelemetry<number>('governance_destroy_hidden_plugin_windows', undefined, {
                moduleId: 'plugins',
                component: 'installedExtensionRuntimeManagerModule',
                event: 'plugin.runtime.hidden-windows.destroy',
                successLevel: 'info',
              })
            : Promise.resolve(0),
        ]).finally(() => {
          cleanupInProgress = false;
        });

        if (runtimeResult.status === 'rejected') {
          telemetry.warn('plugin.runtime.cleanup.runtimes.failed', {
            message: readErrorMessage(runtimeResult.reason),
            fields: { reason },
          });
        }
        if (surfaceResult.status === 'rejected') {
          telemetry.warn('plugin.runtime.cleanup.shell-surfaces.failed', {
            message: readErrorMessage(surfaceResult.reason),
            fields: { reason },
          });
        }
        if (hiddenWindowResult.status === 'rejected') {
          telemetry.warn('plugin.runtime.cleanup.hidden-windows.failed', {
            message: readErrorMessage(hiddenWindowResult.reason),
            fields: { reason },
          });
        }

        telemetry.info('plugin.runtime.cleanup.completed', {
          fields: {
            reason,
            stoppedRuntimeCount: runtimeResult.status === 'fulfilled' ? runtimeResult.value : null,
            cleanedSurfaceCount: surfaceResult.status === 'fulfilled' ? surfaceResult.value : null,
            destroyedHiddenPluginWindowCount:
              hiddenWindowResult.status === 'fulfilled' ? hiddenWindowResult.value : null,
          },
        });
      };
      const participant: RuntimeLifecycleParticipant = {
        id: PLUGIN_RUNTIME_PARTICIPANT_ID,
        capsuleId: PLUGIN_RUNTIME_CAPSULE_ID,
        onWarm: () => {
          participantState = 'active';
        },
        onSuspend: () => {
          participantState = 'suspended';
        },
        onHibernate: (reason) => {
          participantState = 'hibernated';
          void cleanupRuntimeResources(`plugin-runtime:${reason.kind}`);
        },
        onTeardown: (reason) => {
          participantState = 'cold';
          void cleanupRuntimeResources(`plugin-runtime:${reason.kind}`);
        },
        collectSnapshot: () => ({
          id: PLUGIN_RUNTIME_PARTICIPANT_ID,
          capsuleId: PLUGIN_RUNTIME_CAPSULE_ID,
          state: participantState,
          detail: {
            managedRuntimeCount: service.listManagedRuntimes().length,
            trackedShellSurfaceCount: shellSurfaceManager?.listTrackedSurfaces().length ?? 0,
            hasShellSurfaceManager: shellSurfaceManager !== null,
          },
        }),
      };
      const unregisterParticipant = runtimeCapsuleManager?.registerParticipant(
        PLUGIN_RUNTIME_CAPSULE_ID,
        participant
      );
      const unsubscribeManagedRuntimes = service.subscribeManagedRuntimes((runtimes) => {
        if (runtimes.length === 0) return;
        touchPluginRuntimeCapsule('plugin-runtime:managed-runtimes-changed');
      });
      const unsubscribeShellSurfaces = shellSurfaceManager?.subscribeTrackedSurfaces((surfaces) => {
        if (surfaces.length === 0) return;
        touchPluginRuntimeCapsule('plugin-runtime:shell-surfaces-changed');
      });
      return () => {
        unsubscribeShellSurfaces?.();
        unsubscribeManagedRuntimes();
        unregisterParticipant?.();
        unregister();
        service.dispose();
      };
    },
  };
}
