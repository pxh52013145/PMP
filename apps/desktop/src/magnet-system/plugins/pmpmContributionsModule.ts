import React from 'react';
import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type {
  CommandContribution,
  PageContribution,
  SettingsPanelContribution,
  VisualizerContribution,
  WindowContribution,
} from '../../contracts/contributions';
import type { GovernanceService } from '../../services/governance';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { closePluginWindow, openPluginWindow } from '../../utils/pluginWindows';
import { PluginSettingsHost } from './PluginSettingsHost';
import { PluginPageHost } from './PluginPageHost';
import {
  loadInstalledPmpmPlugins,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { clearPmpmPluginRuntimeCache } from './pmpmRuntime';
import { requestPmpmPluginRuntimeRestart } from './pmpmRuntimeSupervisor';
import { getPmpmSandboxRuntimeEnabled } from './pmpmSandboxConfig';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  getResolvedPmpmLauncherAdapterError,
  resolveInstalledPmpmPluginRuntime,
  runResolvedPmpmPluginCommand,
} from './runtime';

const telemetry = getTelemetryLogger('pmpm', 'pmpmContributionsModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPluginCommandId(pluginId: string, commandId: string): string {
  return `pmpm:${pluginId}:${commandId}`;
}

function buildPluginSettingsPanelId(pluginId: string, panelId: string): string {
  return `pmpm:${pluginId}:settings:${panelId}`;
}

function buildPluginPageId(pluginId: string, pageId: string): PageContribution['id'] {
  return `pmpm:${pluginId}:page:${pageId}` as PageContribution['id'];
}

function buildPluginWindowId(pluginId: string, windowId: string): WindowContribution['id'] {
  return `pmpm:${pluginId}:window:${windowId}`;
}

function buildPluginWindowLabel(pluginId: string, windowId: string): string {
  return `plugin-${pluginId}-${windowId}`;
}

function buildPluginWindowRoute(pluginId: string, windowId: string): string {
  return `/#/plugin-window/${pluginId}/${windowId}`;
}

function buildPluginVisualizerId(pluginId: string, visualizerId: string): string {
  return `pmpm:${pluginId}:visualizer:${visualizerId}`;
}

export function createPmpmContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'pmpm-contributions',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();
      const warnCleanupFailure = (
        event: string,
        error: unknown,
        fields: Record<string, unknown>
      ) => {
        telemetry.warn(event, {
          message: readErrorMessage(error),
          fields,
        });
      };
      const tryUnregister = (
        contributionId: string,
        contributionKind: string,
        unregister: () => void
      ) => {
        try {
          unregister();
        } catch (error) {
          warnCleanupFailure('plugin.contribution.unregister.failed', error, {
            contributionId,
            contributionKind,
          });
        }
      };

      const governance: GovernanceService = {
        restartPmpmPluginRuntime: (pluginId, options = {}) => {
          requestPmpmPluginRuntimeRestart(pluginId, { reason: options.reason });
        },
      };

      const unregisterGovernance = services.register(GOVERNANCE_SERVICE_TOKEN, governance, {
        replace: true,
      });

      const sync = () => {
        const installed = loadInstalledPmpmPlugins();
        const nextIds = new Set<string>();

        for (const plugin of installed) {
          const pluginId = plugin.manifest.metadata.id;
          const enabled = plugin.enabled ?? true;
          if (!enabled) continue;

          const declaredPages = plugin.manifest.contributions?.pages ?? [];
          for (const page of declaredPages) {
            const pageKey = buildPluginPageId(pluginId, page.id);
            nextIds.add(pageKey);

            const existingUnregister = unregisters.get(pageKey);
            if (existingUnregister) {
              tryUnregister(pageKey, 'page', existingUnregister);
              unregisters.delete(pageKey);
            }

            const contribution: PageContribution = {
              kind: 'page',
              id: pageKey,
              title: `${plugin.manifest.metadata.name}: ${page.title}`,
              render: () =>
                React.createElement(PluginPageHost, {
                  pluginId,
                  pageId: page.id,
                }),
              source: 'plugin',
              order: page.order,
              group: page.group ?? plugin.manifest.metadata.id,
              tags: page.tags,
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                pageId: page.id,
                ...(page.metadata ?? {}),
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(pageKey, unregister);
          }

          const declaredWindows = plugin.manifest.contributions?.windows ?? [];
          for (const window of declaredWindows) {
            const windowKey = buildPluginWindowId(pluginId, window.id);
            nextIds.add(windowKey);

            const existingUnregister = unregisters.get(windowKey);
            if (existingUnregister) {
              tryUnregister(windowKey, 'window', existingUnregister);
              unregisters.delete(windowKey);
            }

            const title = `${plugin.manifest.metadata.name}: ${window.title}`;
            const contribution: WindowContribution = {
              kind: 'window',
              id: windowKey,
              title,
              label: buildPluginWindowLabel(pluginId, window.id),
              route: buildPluginWindowRoute(pluginId, window.id),
              source: 'plugin',
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                windowId: window.id,
                ...(window.metadata ?? {}),
              },
              open: async (options) => {
                const safeOptions =
                  options && typeof options === 'object' && !Array.isArray(options)
                    ? (options as Record<string, unknown>)
                    : undefined;

                const overrideTitle = safeOptions?.title;
                const overrideWidth = safeOptions?.width;
                const overrideHeight = safeOptions?.height;
                const overrideX = safeOptions?.x;
                const overrideY = safeOptions?.y;

                await openPluginWindow({
                  pluginId,
                  windowId: window.id,
                  title: typeof overrideTitle === 'string' && overrideTitle.length > 0 ? overrideTitle : title,
                  width:
                    typeof overrideWidth === 'number' && Number.isFinite(overrideWidth) ? overrideWidth : window.width,
                  height:
                    typeof overrideHeight === 'number' && Number.isFinite(overrideHeight)
                      ? overrideHeight
                      : window.height,
                  x: typeof overrideX === 'number' && Number.isFinite(overrideX) ? overrideX : undefined,
                  y: typeof overrideY === 'number' && Number.isFinite(overrideY) ? overrideY : undefined,
                });
              },
              close: async () => {
                await closePluginWindow(pluginId, window.id);
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(windowKey, unregister);
          }

          const declared = plugin.manifest.contributions?.commands ?? [];
          for (const command of declared) {
            const commandKey = buildPluginCommandId(pluginId, command.id);
            nextIds.add(commandKey);

            const existingUnregister = unregisters.get(commandKey);
            if (existingUnregister) {
              tryUnregister(commandKey, 'command', existingUnregister);
              unregisters.delete(commandKey);
            }

            const contribution: CommandContribution = {
              kind: 'command',
              id: commandKey,
              title: `${plugin.manifest.metadata.name}: ${command.title}`,
              description: command.description,
              source: 'plugin',
              order: command.order,
              group: command.group ?? plugin.manifest.metadata.id,
              tags: command.tags,
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                commandId: command.id,
              },
              run: async (args?: unknown) => {
                const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
                const audioService = audioEngine.getSnapshot().audioService;
                const commands = services.getOptional(COMMANDS_SERVICE_TOKEN);
                const navigation = services.get(NAVIGATION_SERVICE_TOKEN);
                const keybindings = services.getOptional(KEYBINDINGS_SERVICE_TOKEN);

                try {
                  const runtimeResolution = resolveInstalledPmpmPluginRuntime(pluginId, {
                    preferSandbox: getPmpmSandboxRuntimeEnabled(),
                  });
                  const runtimeResolutionError =
                    getResolvedPmpmLauncherAdapterError(runtimeResolution);
                  if (runtimeResolutionError) {
                    throw new Error(runtimeResolutionError);
                  }

                  await runResolvedPmpmPluginCommand({
                    pluginId,
                    resolution: runtimeResolution,
                    commandId: command.id,
                    args,
                    hostLabel: 'PluginCommand',
                    audioService,
                    commands,
                    navigation,
                    keybindings,
                  });
                } catch (error) {
                  recordPmpmPluginCrash(pluginId, error, 'command');
                  clearPmpmPluginRuntimeCache(pluginId);
                  throw error;
                }
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(commandKey, unregister);
          }

          const declaredPanels = plugin.manifest.contributions?.settingsPanels ?? [];
          for (const panel of declaredPanels) {
            const panelKey = buildPluginSettingsPanelId(pluginId, panel.id);
            nextIds.add(panelKey);

            const existingUnregister = unregisters.get(panelKey);
            if (existingUnregister) {
              tryUnregister(panelKey, 'settings-panel', existingUnregister);
              unregisters.delete(panelKey);
            }

            const contribution: SettingsPanelContribution = {
              kind: 'settings-panel',
              id: panelKey,
              title: `${plugin.manifest.metadata.name}: ${panel.title}`,
              description: panel.description,
              source: 'plugin',
              order: panel.order,
              group: panel.group ?? plugin.manifest.metadata.id,
              tags: panel.tags,
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                panelId: panel.id,
                ...(panel.metadata ?? {}),
                settingsSection: 'plugins',
              },
              render: () =>
                React.createElement(PluginSettingsHost, {
                  pluginId,
                  panelId: panel.id,
                }),
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(panelKey, unregister);
          }

          const declaredVisualizers = plugin.manifest.contributions?.visualizers ?? [];
          for (const visualizer of declaredVisualizers) {
            const visualizerKey = buildPluginVisualizerId(pluginId, visualizer.id);
            nextIds.add(visualizerKey);

            const existingUnregister = unregisters.get(visualizerKey);
            if (existingUnregister) {
              tryUnregister(visualizerKey, 'visualizer', existingUnregister);
              unregisters.delete(visualizerKey);
            }

            const contribution: VisualizerContribution = {
              kind: 'visualizer',
              id: visualizerKey,
              title: `${plugin.manifest.metadata.name}: ${visualizer.title}`,
              description: visualizer.description,
              source: 'plugin',
              order: visualizer.order,
              group: visualizer.group ?? plugin.manifest.metadata.id,
              tags: visualizer.tags,
              inputs: visualizer.inputs,
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                visualizerId: visualizer.id,
                ...(visualizer.metadata ?? {}),
              },
              open: async () => {
                services
                  .get(NAVIGATION_SERVICE_TOKEN)
                  .navigateTo('plugin-visualizer', { pluginId, visualizerId: visualizer.id });
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(visualizerKey, unregister);
          }
        }

        for (const [commandKey, unregister] of Array.from(unregisters.entries())) {
          if (nextIds.has(commandKey)) continue;
          try {
            unregister();
          } catch (error) {
            warnCleanupFailure('plugin.contribution.unregister.failed', error, {
              contributionId: commandKey,
              contributionKind: 'unknown',
            });
          } finally {
            unregisters.delete(commandKey);
          }
        }
      };

      sync();
      const unsubscribe = subscribePmpmPlugins(sync);

      return () => {
        try {
          unsubscribe();
        } catch (error) {
          warnCleanupFailure('plugin.subscription.unsubscribe.failed', error, {});
        }

        try {
          unregisterGovernance();
        } catch (error) {
          warnCleanupFailure('plugin.governance.unregister.failed', error, {});
        }

        for (const [contributionId, unregister] of Array.from(unregisters.entries())) {
          tryUnregister(contributionId, 'unknown', unregister);
        }
        unregisters.clear();
      };
    },
  };
}
