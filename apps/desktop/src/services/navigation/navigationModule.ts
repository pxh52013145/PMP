import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type { NavigationPageData, NavigationPageType } from '../../contracts/navigation';
import { InMemoryNavigationService, NAVIGATION_SERVICE_TOKEN } from './NavigationService';

type DebugTabId = Exclude<NonNullable<NavigationPageData<'debug'>['params']>['tab'], undefined>;
type HashPageWithoutParams = Extract<
  NavigationPageType,
  | 'home'
  | 'settings'
  | 'keyboard-shortcuts'
  | 'music-library'
  | 'playlists'
  | 'play-queue'
  | 'dsp-rack'
>;

const DEBUG_TAB_IDS = new Set<DebugTabId>([
  'debug-center',
  'observability',
  'perf-monitor',
  'native-debug',
]);

function isDebugTabId(value: unknown): value is DebugTabId {
  return typeof value === 'string' && DEBUG_TAB_IDS.has(value as DebugTabId);
}

function parseInitialNavigationFromHash(hash: string): NavigationPageData | undefined {
  if (!hash.startsWith('#/')) return undefined;

  const normalizedHash = hash.slice(2);
  const [pathPart, queryPart = ''] = normalizedHash.split('?');
  const pathSegments = pathPart.split('/').filter(Boolean);
  const pageId = pathSegments[0];
  const tabFromPath = pathSegments[1];
  const search = new URLSearchParams(queryPart);
  const requestedTab = tabFromPath ?? search.get('tab') ?? undefined;

  if (!pageId) return undefined;

  switch (pageId as NavigationPageType) {
    case 'home':
    case 'settings':
    case 'keyboard-shortcuts':
    case 'music-library':
    case 'playlists':
    case 'play-queue':
    case 'dsp-rack':
      return { type: pageId as HashPageWithoutParams };
    case 'debug':
      if (isDebugTabId(requestedTab)) {
        return { type: 'debug', params: { tab: requestedTab } };
      }
      return { type: 'debug' };
    case 'debug-center':
      return { type: 'debug', params: { tab: 'debug-center' } };
    case 'observability':
      return { type: 'debug', params: { tab: 'perf-monitor' } };
    case 'perf-monitor':
      return { type: 'debug', params: { tab: 'perf-monitor' } };
    case 'native-debug':
      return { type: 'debug', params: { tab: 'native-debug' } };
    default:
      return undefined;
  }
}

export function createNavigationModule(): KernelModule<AppEvents> {
  return {
    id: 'navigation',
    activate: ({ services, events }) => {
      const initialHash = typeof window === 'undefined' ? '' : window.location.hash;
      const service = new InMemoryNavigationService(
        events,
        parseInitialNavigationFromHash(initialHash) ?? { type: 'home' }
      );
      const unregister = services.register(NAVIGATION_SERVICE_TOKEN, service);
      return () => unregister();
    },
  };
}

