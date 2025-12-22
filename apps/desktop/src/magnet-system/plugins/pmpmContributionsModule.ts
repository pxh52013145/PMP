import React from 'react';
import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type { CommandContribution, SettingsPanelContribution, VisualizerContribution } from '../../contracts/contributions';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { createPluginMountApi } from './pluginHostApi';
import { PluginSettingsHost } from './PluginSettingsHost';
import {
  getPmpmPluginEffectivePermissions,
  loadInstalledPmpmPlugins,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { ensurePmpmPluginRuntime } from './pmpmRuntime';

function buildPluginCommandId(pluginId: string, commandId: string): string {
  return `pmpm:${pluginId}:${commandId}`;
}

function buildPluginSettingsPanelId(pluginId: string, panelId: string): string {
  return `pmpm:${pluginId}:settings:${panelId}`;
}

function buildPluginVisualizerId(pluginId: string, visualizerId: string): string {
  return `pmpm:${pluginId}:visualizer:${visualizerId}`;
}

export function createPmpmContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'pmpm-contributions',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();

      const sync = () => {
        const installed = loadInstalledPmpmPlugins();
        const nextIds = new Set<string>();

        for (const plugin of installed) {
          const pluginId = plugin.manifest.metadata.id;
          const enabled = plugin.enabled ?? true;
          if (!enabled) continue;

          const declared = plugin.manifest.contributions?.commands ?? [];
          for (const command of declared) {
            const commandKey = buildPluginCommandId(pluginId, command.id);
            nextIds.add(commandKey);

            const existingUnregister = unregisters.get(commandKey);
            if (existingUnregister) {
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
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
                const permissions = getPmpmPluginEffectivePermissions(pluginId);
                const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
                const audioService = audioEngine.getSnapshot().audioService;
                const navigation = services.get(NAVIGATION_SERVICE_TOKEN);

                const api = createPluginMountApi({
                  pluginId,
                  hostLabel: 'PluginCommand',
                  permissions,
                  audioService,
                  navigation,
                });

                try {
                  const runtime = await ensurePmpmPluginRuntime(pluginId);
                  const runCommand = runtime.runCommand;
                  if (typeof runCommand !== 'function') {
                    throw new Error('Plugin entry must export `runCommand(api, commandId, args?)`');
                  }
                  await runCommand(api, command.id, args);
                } catch (error) {
                  recordPmpmPluginCrash(pluginId, error, 'command');
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
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
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
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
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
            console.warn('[pmpm-contributions] unregister failed', error);
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
          console.warn('[pmpm-contributions] unsubscribe failed', error);
        }

        for (const unregister of Array.from(unregisters.values())) {
          try {
            unregister();
          } catch (error) {
            console.warn('[pmpm-contributions] unregister failed', error);
          }
        }
        unregisters.clear();
      };
    },
  };
}
