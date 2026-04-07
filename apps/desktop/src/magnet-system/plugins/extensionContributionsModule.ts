import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type {
  CommandContribution,
  KeybindingContribution,
} from '../../contracts/contributions';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  loadInstalledExtensions,
  recordInstalledExtensionCrash,
  subscribeInstalledExtensions,
} from './extensions';
import { resolveInstalledExtensionRuntime } from './runtime';
import { runResolvedInstalledExtensionCommand } from './runtime/extensionCommandRuntime';
import { INSTALLED_EXTENSION_COMMAND_LAUNCHERS } from './runtime/installedExtensionHostLaunchers';
import type { LocalizedTextDescriptor } from '@pixel-matrix/plugin-platform-contracts';

const telemetry = getTelemetryLogger('extensions', 'extensionContributionsModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildExtensionCommandContributionId(pluginId: string, commandId: string): string {
  return `extv2:${pluginId}:command:${commandId}`;
}

function buildExtensionKeybindingContributionId(pluginId: string, keybindingId: string): string {
  return `extv2:${pluginId}:keybinding:${keybindingId}`;
}

function readLocalizedText(value: LocalizedTextDescriptor | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    if (typeof value.fallback === 'string' && value.fallback.trim().length > 0) {
      return value.fallback.trim();
    }
    if (typeof value.key === 'string' && value.key.trim().length > 0) {
      return value.key.trim();
    }
  }
  return fallback;
}

export function createInstalledExtensionContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'installed-extension-contributions',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();

      const tryUnregister = (contributionId: string, unregister: () => void) => {
        try {
          unregister();
        } catch (error) {
          telemetry.warn('extension.contribution.unregister.failed', {
            message: readErrorMessage(error),
            fields: { contributionId },
          });
        }
      };

      const sync = () => {
        const installed = loadInstalledExtensions();
        const nextIds = new Set<string>();

        for (const record of installed) {
          const pluginId = record.manifest.identity.id;
          if (record.enabled === false) continue;

          const declaredCommands = record.manifest.contributes?.core?.commands ?? [];
          for (const command of declaredCommands) {
            const commandKey = buildExtensionCommandContributionId(pluginId, command.id);
            nextIds.add(commandKey);

            const existingUnregister = unregisters.get(commandKey);
            if (existingUnregister) {
              tryUnregister(commandKey, existingUnregister);
              unregisters.delete(commandKey);
            }

            const contribution: CommandContribution = {
              kind: 'command',
              id: commandKey,
              title: readLocalizedText(command.title, command.id),
              description: readLocalizedText(command.description, ''),
              source: 'plugin',
              metadata: {
                pluginId,
                pluginName:
                  record.manifest.identity.displayName ?? record.manifest.identity.name,
                commandId: command.id,
                manifestSchemaVersion: record.manifest.schemaVersion,
                ...(command.metadata ?? {}),
              },
              run: async (args?: unknown) => {
                const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
                const audioService = audioEngine.getSnapshot().audioService;
                const commands = services.getOptional(COMMANDS_SERVICE_TOKEN);
                const navigation = services.get(NAVIGATION_SERVICE_TOKEN);
                const keybindings = services.getOptional(KEYBINDINGS_SERVICE_TOKEN);

                try {
                  const runtimeResolution = resolveInstalledExtensionRuntime(record, {
                    hostId: 'pmp',
                    surfaceKind: 'command',
                    preferCommandWorker: true,
                    supportedLauncherIds: [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS],
                  });

                  await runResolvedInstalledExtensionCommand({
                    record,
                    resolution: runtimeResolution,
                    commandId: command.id,
                    args,
                    hostLabel: 'ExtensionCommand',
                    audioService,
                    commands,
                    navigation,
                    keybindings,
                  });
                } catch (error) {
                  recordInstalledExtensionCrash(pluginId, error);
                  throw error;
                }
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(commandKey, unregister);
          }

          const declaredKeybindings = record.manifest.contributes?.core?.keybindings ?? [];
          for (const keybinding of declaredKeybindings) {
            const keybindingKey = buildExtensionKeybindingContributionId(pluginId, keybinding.id);
            nextIds.add(keybindingKey);

            const existingUnregister = unregisters.get(keybindingKey);
            if (existingUnregister) {
              tryUnregister(keybindingKey, existingUnregister);
              unregisters.delete(keybindingKey);
            }

            const contribution: KeybindingContribution = {
              kind: 'keybinding',
              id: keybindingKey,
              key: keybinding.key,
              command: buildExtensionCommandContributionId(pluginId, keybinding.command),
              when: keybinding.when,
              args: keybinding.args,
              weight: keybinding.weight,
              source: 'plugin',
              metadata: {
                pluginId,
                keybindingId: keybinding.id,
                ...(keybinding.metadata ?? {}),
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(keybindingKey, unregister);
          }
        }

        for (const [contributionId, unregister] of Array.from(unregisters.entries())) {
          if (nextIds.has(contributionId)) continue;
          tryUnregister(contributionId, unregister);
          unregisters.delete(contributionId);
        }
      };

      sync();
      const unsubscribe = subscribeInstalledExtensions(sync);

      return () => {
        try {
          unsubscribe();
        } catch (error) {
          telemetry.warn('extension.subscription.unsubscribe.failed', {
            message: readErrorMessage(error),
          });
        }

        for (const [contributionId, unregister] of Array.from(unregisters.entries())) {
          tryUnregister(contributionId, unregister);
        }
        unregisters.clear();
      };
    },
  };
}
