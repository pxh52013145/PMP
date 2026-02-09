import React, { type ReactNode } from 'react';
import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type {
  WorkbenchContribution,
  WorkbenchLayoutContribution,
  WorkbenchNavigationContribution,
  WorkbenchPageContainerContribution,
} from '../contracts/contributions';
import { subscribeLocale, t } from '../i18n/core';

const NavigationPageLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/NavigationPage')).NavigationPage,
}));
const DefaultWorkbenchLazy = React.lazy(async () => ({
  default: (await import('../workbenches/default/DefaultWorkbench')).DefaultWorkbench,
}));
const MinimalWorkbenchLazy = React.lazy(async () => ({
  default: (await import('../workbenches/minimal/MinimalWorkbench')).MinimalWorkbench,
}));
const MatrixWorkbenchLazy = React.lazy(async () => ({
  default: (await import('../workbenches/matrix/MatrixWorkbench')).MatrixWorkbench,
}));
const WorkbenchPagesNavigationLazy = React.lazy(async () => ({
  default: (await import('../workbenches/navigation/WorkbenchPagesNavigation')).WorkbenchPagesNavigation,
}));

function renderWithLazyBoundary(node: React.ReactNode) {
  return (
    <React.Suspense
      fallback={
        <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.75)' }}>
          {t('common.state.loading')}
        </div>
      }
    >
      {node}
    </React.Suspense>
  );
}

export function createBuiltinWorkbenchesModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-workbenches',
    activate: ({ contributions }) => {
      const unregisters = new Map<string, () => void>();

      type BuiltinWorkbenchContribution =
        | WorkbenchContribution
        | WorkbenchLayoutContribution
        | WorkbenchNavigationContribution
        | WorkbenchPageContainerContribution;

      const register = (contribution: BuiltinWorkbenchContribution) => {
        const key = `${contribution.kind}/${contribution.id}`;
        const unregister = contributions.register(contribution, { replace: true });
        unregisters.set(key, unregister);
      };

      const renderStackLayout = (slots: { navigation: unknown; content: unknown }) => (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{ position: 'absolute', inset: 0 }}>{slots.content as ReactNode}</div>
          {slots.navigation ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>{slots.navigation as ReactNode}</div>
          ) : null}
        </div>
      );

      const sync = () => {
        register({
          kind: 'workbench-layout',
          id: 'matrix1',
          title: t('workbench.layouts.matrix1.title'),
          render: (slots) => renderStackLayout(slots),
          source: 'builtin',
          order: 5,
          group: 'matrix',
          tags: ['layout', 'matrix', 'matrix1'],
          metadata: {
            description: t('workbench.layouts.matrix1.description'),
          },
        });

        register({
          kind: 'workbench-layout',
          id: 'matrix2',
          title: t('workbench.layouts.matrix2.title'),
          render: (slots) => renderStackLayout(slots),
          source: 'builtin',
          order: 6,
          group: 'matrix',
          tags: ['layout', 'matrix', 'matrix2'],
          metadata: {
            experimental: true,
            description: t('workbench.layouts.matrix2.description'),
          },
        });

        register({
          kind: 'workbench-layout',
          id: 'stack',
          title: t('workbench.layouts.stack.title'),
          render: (slots) => renderStackLayout(slots),
          source: 'builtin',
          order: 10,
          group: 'core',
          tags: ['layout'],
          metadata: {
            description: t('workbench.layouts.stack.description'),
          },
        });

        register({
          kind: 'workbench-layout',
          id: 'split-left',
          title: t('workbench.layouts.splitLeft.title'),
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
          metadata: {
            description: t('workbench.layouts.splitLeft.description'),
          },
        });

        register({
          kind: 'workbench-navigation',
          id: 'none',
          title: t('workbench.navigations.none.title'),
          render: () => null,
          source: 'builtin',
          order: 10,
          group: 'core',
          tags: ['navigation'],
          metadata: {
            description: t('workbench.navigations.none.description'),
          },
        });

        register({
          kind: 'workbench-navigation',
          id: 'pages-list',
          title: t('workbench.navigations.pagesList.title'),
          render: () => renderWithLazyBoundary(<WorkbenchPagesNavigationLazy />),
          source: 'builtin',
          order: 20,
          group: 'core',
          tags: ['navigation'],
          metadata: {
            description: t('workbench.navigations.pagesList.description'),
          },
        });

        register({
          kind: 'workbench-page-container',
          id: 'matrix',
          title: t('workbench.pageContainers.matrix.title'),
          render: () =>
            renderWithLazyBoundary(
              <MatrixWorkbenchLazy showEditorOverlay showEditorPanel showWindowBorder />
            ),
          source: 'builtin',
          order: 10,
          group: 'core',
          tags: ['content', 'matrix'],
          metadata: {
            description: t('workbench.pageContainers.matrix.description'),
          },
        });

        register({
          kind: 'workbench-page-container',
          id: 'matrix-minimal',
          title: t('workbench.pageContainers.matrixMinimal.title'),
          render: () =>
            renderWithLazyBoundary(
              <MatrixWorkbenchLazy showEditorOverlay={false} showEditorPanel={false} showWindowBorder />
            ),
          source: 'builtin',
          order: 20,
          group: 'core',
          tags: ['content', 'matrix'],
          metadata: {
            experimental: true,
            description: t('workbench.pageContainers.matrixMinimal.description'),
          },
        });

        register({
          kind: 'workbench-page-container',
          id: 'navigation-page',
          title: t('workbench.pageContainers.navigationPage.title'),
          render: () => renderWithLazyBoundary(<NavigationPageLazy />),
          source: 'builtin',
          order: 30,
          group: 'core',
          tags: ['content', 'pages'],
          metadata: {
            experimental: true,
            description: t('workbench.pageContainers.navigationPage.description'),
          },
        });

        register({
          kind: 'workbench',
          id: 'default',
          title: t('workbench.workbenches.default.title'),
          render: () => renderWithLazyBoundary(<DefaultWorkbenchLazy />),
          source: 'builtin',
          order: 10,
          group: 'core',
          tags: ['matrix'],
          metadata: {
            description: t('workbench.workbenches.default.description'),
          },
        });

        register({
          kind: 'workbench',
          id: 'minimal',
          title: t('workbench.workbenches.minimal.title'),
          render: () => renderWithLazyBoundary(<MinimalWorkbenchLazy />),
          source: 'builtin',
          order: 20,
          group: 'core',
          tags: ['matrix'],
          metadata: {
            experimental: true,
            description: t('workbench.workbenches.minimal.description'),
          },
        });
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          console.warn('[builtin-workbenches] locale subscription cleanup failed', error);
        }

        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-workbenches] unregister failed', error);
          }
        }
        unregisters.clear();
      };
    },
  };
}
