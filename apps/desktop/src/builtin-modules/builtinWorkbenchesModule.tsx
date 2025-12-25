import type { ReactNode } from 'react';
import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type {
  WorkbenchContribution,
  WorkbenchLayoutContribution,
  WorkbenchNavigationContribution,
  WorkbenchPageContainerContribution,
} from '../contracts/contributions';
import { NavigationPage } from '../components/magnet/NavigationPage';
import { DefaultWorkbench } from '../workbenches/default/DefaultWorkbench';
import { MinimalWorkbench } from '../workbenches/minimal/MinimalWorkbench';
import { MatrixWorkbench } from '../workbenches/matrix/MatrixWorkbench';
import { WorkbenchPagesNavigation } from '../workbenches/navigation/WorkbenchPagesNavigation';

export function createBuiltinWorkbenchesModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-workbenches',
    activate: ({ contributions }) => {
      const unregisters: Array<() => void> = [];

      const register = (
        contribution:
          | WorkbenchContribution
          | WorkbenchLayoutContribution
          | WorkbenchNavigationContribution
          | WorkbenchPageContainerContribution
      ) => {
        unregisters.push(contributions.register(contribution));
      };

      const renderStackLayout = (slots: { navigation: unknown; content: unknown }) => (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{ position: 'absolute', inset: 0 }}>{slots.content as ReactNode}</div>
          {slots.navigation ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>{slots.navigation as ReactNode}</div>
          ) : null}
        </div>
      );

      register({
        kind: 'workbench-layout',
        id: 'matrix1',
        title: 'Matrix 1 Layout',
        render: (slots) => renderStackLayout(slots),
        source: 'builtin',
        order: 5,
        group: 'matrix',
        tags: ['layout', 'matrix', 'matrix1'],
      });

      register({
        kind: 'workbench-layout',
        id: 'matrix2',
        title: 'Matrix 2 Layout',
        render: (slots) => renderStackLayout(slots),
        source: 'builtin',
        order: 6,
        group: 'matrix',
        tags: ['layout', 'matrix', 'matrix2'],
        metadata: {
          experimental: true,
        },
      });

      register({
        kind: 'workbench-layout',
        id: 'stack',
        title: 'Stack Layout',
        render: (slots) => renderStackLayout(slots),
        source: 'builtin',
        order: 10,
        group: 'core',
        tags: ['layout'],
      });

      register({
        kind: 'workbench-layout',
        id: 'split-left',
        title: 'Split Left Layout',
        render: (slots) => (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div
              style={{
                width: 300,
                maxWidth: 380,
                borderRight: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              {slots.navigation as ReactNode}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{slots.content as ReactNode}</div>
          </div>
        ),
        source: 'builtin',
        order: 20,
        group: 'core',
        tags: ['layout'],
      });

      register({
        kind: 'workbench-navigation',
        id: 'none',
        title: 'No Navigation',
        render: () => null,
        source: 'builtin',
        order: 10,
        group: 'core',
        tags: ['navigation'],
      });

      register({
        kind: 'workbench-navigation',
        id: 'pages-list',
        title: 'Pages List',
        render: () => <WorkbenchPagesNavigation />,
        source: 'builtin',
        order: 20,
        group: 'core',
        tags: ['navigation'],
      });

      register({
        kind: 'workbench-page-container',
        id: 'matrix',
        title: 'Matrix',
        render: () => <MatrixWorkbench showEditorOverlay showEditorPanel showWindowBorder />,
        source: 'builtin',
        order: 10,
        group: 'core',
        tags: ['content', 'matrix'],
      });

      register({
        kind: 'workbench-page-container',
        id: 'matrix-minimal',
        title: 'Matrix (Minimal)',
        render: () => <MatrixWorkbench showEditorOverlay={false} showEditorPanel={false} showWindowBorder />,
        source: 'builtin',
        order: 20,
        group: 'core',
        tags: ['content', 'matrix'],
        metadata: {
          experimental: true,
        },
      });

      register({
        kind: 'workbench-page-container',
        id: 'navigation-page',
        title: 'Navigation Page',
        render: () => <NavigationPage />,
        source: 'builtin',
        order: 30,
        group: 'core',
        tags: ['content', 'pages'],
        metadata: {
          experimental: true,
        },
      });

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
