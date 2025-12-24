import React from 'react';
import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type {
  CommandContribution,
  PageContribution,
  SettingsPanelContribution,
  VisualizerContribution,
  WorkbenchContribution,
  WindowContribution,
} from '../../contracts/contributions';
import type { GovernanceService } from '../../services/governance';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { closePluginWindow, openPluginWindow } from '../../utils/pluginWindows';
import { createPluginMountApi } from './pluginHostApi';
import { PluginSettingsHost } from './PluginSettingsHost';
import { PluginPageHost } from './PluginPageHost';
import { PluginWorkbenchHost } from './PluginWorkbenchHost';
import {
  getPmpmPluginEffectivePermissions,
  loadInstalledPmpmPlugins,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { clearPmpmPluginRuntimeCache, ensurePmpmPluginRuntime } from './pmpmRuntime';
import { requestPmpmPluginRuntimeRestart } from './pmpmRuntimeSupervisor';

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

function buildPluginWorkbenchId(pluginId: string, workbenchId: string): string {
  return `pmpm:${pluginId}:workbench:${workbenchId}`;
}

export function createPmpmContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'pmpm-contributions',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();

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

          const declaredWorkbenches = plugin.manifest.contributions?.workbenches ?? [];
          for (const workbench of declaredWorkbenches) {
            const workbenchKey = buildPluginWorkbenchId(pluginId, workbench.id);
            nextIds.add(workbenchKey);

            const existingUnregister = unregisters.get(workbenchKey);
            if (existingUnregister) {
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
              unregisters.delete(workbenchKey);
            }

            const contribution: WorkbenchContribution = {
              kind: 'workbench',
              id: workbenchKey,
              title: `${plugin.manifest.metadata.name}: ${workbench.title}`,
              render: () =>
                React.createElement(PluginWorkbenchHost, {
                  pluginId,
                  workbenchId: workbench.id,
                }),
              source: 'plugin',
              order: workbench.order,
              group: workbench.group ?? plugin.manifest.metadata.id,
              tags: workbench.tags,
              metadata: {
                pluginId,
                pluginName: plugin.manifest.metadata.name,
                workbenchId: workbench.id,
                ...(workbench.metadata ?? {}),
              },
            };

            const unregister = contributions.register(contribution, { replace: true });
            unregisters.set(workbenchKey, unregister);
          }

          const declaredPages = plugin.manifest.contributions?.pages ?? [];
          for (const page of declaredPages) {
            const pageKey = buildPluginPageId(pluginId, page.id);
            nextIds.add(pageKey);

            const existingUnregister = unregisters.get(pageKey);
            if (existingUnregister) {
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
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
              try {
                existingUnregister();
              } catch (error) {
                console.warn('[pmpm-contributions] unregister failed', error);
              }
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

        try {
          unregisterGovernance();
        } catch (error) {
          console.warn('[pmpm-contributions] unregister governance failed', error);
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
