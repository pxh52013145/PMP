import { beforeEach, describe, expect, it } from 'vitest';
import { ContributionRegistry, EventBus, ServiceRegistry } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import type { NavigationPageData } from '../../../contracts/navigation';
import type { PageContribution, WindowContribution, WorkbenchContribution } from '../../../contracts/contributions';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { createPmpmContributionsModule } from '../pmpmContributionsModule';
import { PluginPageHost } from '../PluginPageHost';
import { PluginWorkbenchHost } from '../PluginWorkbenchHost';

beforeEach(() => {
  localStorage.clear();
});

describe('pmpmContributionsModule', () => {
  it('registers plugin pages as page contributions', () => {
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([
        {
          manifest: {
            formatVersion: '1.0',
            type: 'magnet-plugin',
            metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
            entryPoint: 'dist/plugin.js',
            contributions: {
              pages: [{ id: 'main', title: 'Main' }],
            },
          },
          entryCode: 'export function mount() {}',
          installedAt: Date.now(),
        },
      ])
    );

    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');

    const module = createPmpmContributionsModule();
    const deactivate = module.activate({ contributions, services, events });

    const page = contributions.get<PageContribution>('page', 'pmpm:magnet-demo:page:main');
    expect(page).not.toBeNull();

    const element = page?.render({ type: page.id } satisfies NavigationPageData);
    expect((element as { type?: unknown } | null)?.type).toBe(PluginPageHost);

    deactivate?.();
    expect(contributions.list<PageContribution>('page')).toHaveLength(0);
  });

  it('registers plugin windows as window contributions', () => {
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([
        {
          manifest: {
            formatVersion: '1.0',
            type: 'magnet-plugin',
            metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
            entryPoint: 'dist/plugin.js',
            contributions: {
              windows: [{ id: 'panel', title: 'Panel', width: 640, height: 480 }],
            },
          },
          entryCode: 'export function mount() {}',
          installedAt: Date.now(),
        },
      ])
    );

    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');

    const module = createPmpmContributionsModule();
    const deactivate = module.activate({ contributions, services, events });

    const win = contributions.get<WindowContribution>('window', 'pmpm:magnet-demo:window:panel');
    expect(win).not.toBeNull();
    expect(win?.label).toBe('plugin-magnet-demo-panel');
    expect(win?.route).toBe('/#/plugin-window/magnet-demo/panel');

    deactivate?.();
    expect(contributions.list<WindowContribution>('window')).toHaveLength(0);
  });

  it('registers plugin workbenches as workbench contributions', () => {
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([
        {
          manifest: {
            formatVersion: '1.0',
            type: 'magnet-plugin',
            metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
            entryPoint: 'dist/plugin.js',
            contributions: {
              workbenches: [{ id: 'alt', title: 'Alternate' }],
            },
          },
          entryCode: 'export function mount() {}',
          installedAt: Date.now(),
        },
      ])
    );

    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const events = new EventBus<AppEvents>().withSource('test');

    const module = createPmpmContributionsModule();
    const deactivate = module.activate({ contributions, services, events });

    const workbench = contributions.get<WorkbenchContribution>('workbench', 'pmpm:magnet-demo:workbench:alt');
    expect(workbench).not.toBeNull();

    const element = workbench?.render();
    expect((element as { type?: unknown } | null)?.type).toBe(PluginWorkbenchHost);

    deactivate?.();
    expect(contributions.list<WorkbenchContribution>('workbench')).toHaveLength(0);
  });
});
