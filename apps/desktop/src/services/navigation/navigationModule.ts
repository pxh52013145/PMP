import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { InMemoryNavigationService, NAVIGATION_SERVICE_TOKEN } from './NavigationService';

export function createNavigationModule(): KernelModule<AppEvents> {
  return {
    id: 'navigation',
    activate: ({ services, events }) => {
      const service = new InMemoryNavigationService(events);
      const unregister = services.register(NAVIGATION_SERVICE_TOKEN, service);
      return () => unregister();
    },
  };
}

