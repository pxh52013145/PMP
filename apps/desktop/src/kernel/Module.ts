import type { ScopedEventBus, EventMap } from './EventBus';
import type { ServiceRegistry } from './ServiceRegistry';
import type { ContributionRegistry } from './ContributionRegistry';

export type ModuleContext<Events extends EventMap> = {
  services: ServiceRegistry;
  events: ScopedEventBus<Events>;
  contributions: ContributionRegistry;
};

export type KernelModule<Events extends EventMap> = {
  id: string;
  activate: (ctx: ModuleContext<Events>) => void | (() => void);
  deactivate?: () => void;
};
