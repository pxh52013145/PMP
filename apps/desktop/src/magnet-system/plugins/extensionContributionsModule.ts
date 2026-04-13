import React from 'react';
import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type {
  CommandContribution,
  KeybindingContribution,
  PageContribution,
  SettingsPanelContribution,
  VisualizerContribution,
  WindowContribution,
} from '../../contracts/contributions';
import type { GovernanceService } from '../../services/governance';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  loadInstalledExtensions,
  subscribeInstalledExtensions,
} from './extensions';
import type { LocalizedTextDescriptor } from '@pixel-matrix/plugin-platform-contracts';
import {
  closePluginWindow,
} from '../../utils/pluginWindows';
import {
  openBuiltinPluginVisualizerViaHostCapability,
  openBuiltinPluginWindowViaHostCapability,
} from '../../builtin-modules/builtinNavigationCapabilityBridge';
import {
  InstalledExtensionPageHost,
  InstalledExtensionSettingsHost,
} from './InstalledExtensionSurfaceHost';
import { readInstalledExtensionPmpHostContributions } from './installedExtensionHostPmp';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';
import { SHELL_SURFACE_MANAGER_TOKEN } from './shellSurfaceManager';
import { requestHostExtensionRuntimeRestart } from './hostExtensionRuntimeSupervisor';

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

function buildExtensionPageContributionId(
  pluginId: string,
  pageId: string
): PageContribution['id'] {
  return `extv2:${pluginId}:page:${pageId}` as PageContribution['id'];
}

function buildExtensionSettingsPanelContributionId(pluginId: string, panelId: string): string {
  return `extv2:${pluginId}:settings:${panelId}`;
}

function buildExtensionWindowContributionId(
  pluginId: string,
  windowId: string
): WindowContribution['id'] {
  return `extv2:${pluginId}:window:${windowId}`;
}

function buildExtensionWindowLabel(pluginId: string, windowId: string): string {
  return `plugin-extv2-${pluginId}-${windowId}`;
}

function buildExtensionWindowRoute(pluginId: string, windowId: string): string {
  return `/#/plugin-window/extv2/${pluginId}/${windowId}`;
}

function buildExtensionVisualizerContributionId(pluginId: string, visualizerId: string): string {
  return `extv2:${pluginId}:visualizer:${visualizerId}`;
}

function buildExtensionShellSurfaceCommandId(pluginId: string, surfaceId: string): string {
  return `extv2:${pluginId}:shell-surface:${surfaceId}:summon`;
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
      const runtimeManager = services.get(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN);
      const shellSurfaceManager = services.get(SHELL_SURFACE_MANAGER_TOKEN);
      const unregisters = new Map<string, () => void>();
      const governance: GovernanceService = {
        restartHostExtensionRuntime: (pluginId, options = {}) => {
          requestHostExtensionRuntimeRestart(pluginId, {
            reason: options.reason,
          });
        },
        restartInstalledExtensionRuntime: (pluginId, options = {}) => {
          requestHostExtensionRuntimeRestart(pluginId, { reason: options.reason });
        },
      };
      const unregisterGovernance = services.register(GOVERNANCE_SERVICE_TOKEN, governance, {
        replace: true,
      });

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
          const pluginName =
            record.manifest.identity.displayName ?? record.manifest.identity.name;
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
                pluginName,
                commandId: command.id,
                manifestSchemaVersion: record.manifest.schemaVersion,
                ...(command.metadata ?? {}),
              },
              run: async (args?: unknown) => {
                await runtimeManager.runCommand({
                  record,
                  commandId: command.id,
                  args,
                  hostLabel: 'ExtensionCommand',
                });
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

          const hostContributions = readInstalledExtensionPmpHostContributions(record);

          for (const page of hostContributions?.pages ?? []) {
            const pageKey = buildExtensionPageContributionId(pluginId, page.id);
            nextIds.add(pageKey);

            const existingUnregister = unregisters.get(pageKey);
            if (existingUnregister) {
              tryUnregister(pageKey, existingUnregister);
              unregisters.delete(pageKey);
            }

            const contribution: PageContribution = {
              kind: 'page',
              id: pageKey,
              title: `${pluginName}: ${page.title}`,
              render: () =>
                React.createElement(InstalledExtensionPageHost, {
                  pluginId,
                  pageId: page.id,
                }),
              source: 'plugin',
              order: page.order,
              group: page.group ?? pluginId,
              tags: page.tags,
              metadata: {
                pluginId,
                pluginName,
                pageId: page.id,
                ...(page.metadata ?? {}),
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(pageKey, unregister);
          }

          for (const panel of hostContributions?.settingsPanels ?? []) {
            const panelKey = buildExtensionSettingsPanelContributionId(pluginId, panel.id);
            nextIds.add(panelKey);

            const existingUnregister = unregisters.get(panelKey);
            if (existingUnregister) {
              tryUnregister(panelKey, existingUnregister);
              unregisters.delete(panelKey);
            }

            const contribution: SettingsPanelContribution = {
              kind: 'settings-panel',
              id: panelKey,
              title: `${pluginName}: ${panel.title}`,
              description: panel.description,
              source: 'plugin',
              order: panel.order,
              group: panel.group ?? pluginId,
              tags: panel.tags,
              metadata: {
                pluginId,
                pluginName,
                panelId: panel.id,
                ...(panel.metadata ?? {}),
                settingsSection: 'plugins',
              },
              render: () =>
                React.createElement(InstalledExtensionSettingsHost, {
                  pluginId,
                  panelId: panel.id,
                }),
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(panelKey, unregister);
          }

          for (const window of hostContributions?.windows ?? []) {
            const windowKey = buildExtensionWindowContributionId(pluginId, window.id);
            nextIds.add(windowKey);

            const existingUnregister = unregisters.get(windowKey);
            if (existingUnregister) {
              tryUnregister(windowKey, existingUnregister);
              unregisters.delete(windowKey);
            }

            const title = `${pluginName}: ${window.title}`;
            const contribution: WindowContribution = {
              kind: 'window',
              id: windowKey,
              title,
              label: buildExtensionWindowLabel(pluginId, window.id),
              route: buildExtensionWindowRoute(pluginId, window.id),
              source: 'plugin',
              metadata: {
                pluginId,
                pluginName,
                windowId: window.id,
                ...(window.metadata ?? {}),
              },
              open: async (options) => {
                const safeOptions =
                  options && typeof options === 'object' && !Array.isArray(options)
                    ? (options as Record<string, unknown>)
                    : undefined;

                await openBuiltinPluginWindowViaHostCapability(
                  services.get(NAVIGATION_SERVICE_TOKEN),
                  {
                    sourceKind: 'extv2',
                    pluginId,
                    windowId: window.id,
                    title:
                      typeof safeOptions?.title === 'string' && safeOptions.title.length > 0
                        ? safeOptions.title
                        : title,
                    width:
                      typeof safeOptions?.width === 'number' && Number.isFinite(safeOptions.width)
                        ? safeOptions.width
                        : window.width,
                    height:
                      typeof safeOptions?.height === 'number' && Number.isFinite(safeOptions.height)
                        ? safeOptions.height
                        : window.height,
                    x:
                      typeof safeOptions?.x === 'number' && Number.isFinite(safeOptions.x)
                        ? safeOptions.x
                        : undefined,
                    y:
                      typeof safeOptions?.y === 'number' && Number.isFinite(safeOptions.y)
                        ? safeOptions.y
                        : undefined,
                  },
                  `window:extv2:${pluginId}:${window.id}`
                );
              },
              close: async () => {
                await closePluginWindow(pluginId, window.id, 'extv2');
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(windowKey, unregister);
          }

          for (const shellSurface of hostContributions?.shellSurfaces ?? []) {
            const surfaceCommandKey = buildExtensionShellSurfaceCommandId(pluginId, shellSurface.id);
            nextIds.add(surfaceCommandKey);

            const existingUnregister = unregisters.get(surfaceCommandKey);
            if (existingUnregister) {
              tryUnregister(surfaceCommandKey, existingUnregister);
              unregisters.delete(surfaceCommandKey);
            }

            const contribution: CommandContribution = {
              kind: 'command',
              id: surfaceCommandKey,
              title: `${pluginName}: ${shellSurface.title}`,
              description: shellSurface.description,
              source: 'plugin',
              order: shellSurface.order,
              group: shellSurface.group ?? pluginId,
              tags: shellSurface.tags,
              metadata: {
                pluginId,
                pluginName,
                surfaceId: shellSurface.id,
                surfaceType: shellSurface.surfaceType,
                ...(shellSurface.metadata ?? {}),
              },
              run: async () => {
                await shellSurfaceManager.summonSurface({
                  sourceKind: 'extv2',
                  pluginId,
                  pluginName,
                  enabled: true,
                  descriptor: shellSurface,
                });
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(surfaceCommandKey, unregister);
          }

          for (const visualizer of hostContributions?.visualizers ?? []) {
            const visualizerKey = buildExtensionVisualizerContributionId(pluginId, visualizer.id);
            nextIds.add(visualizerKey);

            const existingUnregister = unregisters.get(visualizerKey);
            if (existingUnregister) {
              tryUnregister(visualizerKey, existingUnregister);
              unregisters.delete(visualizerKey);
            }

            const contribution: VisualizerContribution = {
              kind: 'visualizer',
              id: visualizerKey,
              title: `${pluginName}: ${visualizer.title}`,
              description: visualizer.description,
              source: 'plugin',
              order: visualizer.order,
              group: visualizer.group ?? pluginId,
              tags: visualizer.tags,
              inputs: visualizer.inputs,
              metadata: {
                pluginId,
                pluginName,
                visualizerId: visualizer.id,
                ...(visualizer.metadata ?? {}),
              },
              open: async () => {
                await openBuiltinPluginVisualizerViaHostCapability(
                  services.get(NAVIGATION_SERVICE_TOKEN),
                  {
                    pluginId,
                    visualizerId: visualizer.id,
                    sourceKind: 'extv2',
                  },
                  `visualizer:extv2:${pluginId}:${visualizer.id}`
                );
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(visualizerKey, unregister);
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

        try {
          unregisterGovernance();
        } catch (error) {
          telemetry.warn('extension.governance.unregister.failed', {
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
