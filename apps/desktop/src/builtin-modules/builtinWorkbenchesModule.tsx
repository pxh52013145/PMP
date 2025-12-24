import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { WorkbenchContribution } from '../contracts/contributions';
import { DefaultWorkbench } from '../workbenches/default/DefaultWorkbench';
import { MinimalWorkbench } from '../workbenches/minimal/MinimalWorkbench';

export function createBuiltinWorkbenchesModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-workbenches',
    activate: ({ contributions }) => {
      const unregisters: Array<() => void> = [];

      const register = (contribution: WorkbenchContribution) => {
        unregisters.push(contributions.register(contribution));
      };

      register({
        kind: 'workbench',
        id: 'default',
        title: 'Default Workbench',
        render: () => <DefaultWorkbench />,
        source: 'builtin',
        order: 10,
        group: 'core',
        tags: ['matrix'],
      });

      register({
        kind: 'workbench',
        id: 'minimal',
        title: 'Minimal Workbench',
        render: () => <MinimalWorkbench />,
        source: 'builtin',
        order: 20,
        group: 'core',
        tags: ['matrix'],
        metadata: {
          experimental: true,
        },
      });

      return () => {
        for (const unregister of unregisters.splice(0)) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-workbenches] unregister failed', error);
          }
        }
      };
    },
  };
}

