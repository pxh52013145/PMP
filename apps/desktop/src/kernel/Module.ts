import type { ScopedEventBus, EventMap } from './EventBus';
import type { ServiceRegistryApi } from './ServiceRegistry';
import type { ContributionRegistryApi } from './ContributionRegistry';

export type ModuleContext<Events extends EventMap> = {
  services: ServiceRegistryApi;
  events: ScopedEventBus<Events>;
  contributions: ContributionRegistryApi;
};

export type KernelModule<Events extends EventMap> = {
  id: string;
  activate: (ctx: ModuleContext<Events>) => void | (() => void);
  deactivate?: () => void;
};
