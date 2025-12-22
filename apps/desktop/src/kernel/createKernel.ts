import { EventBus, type EventMap } from './EventBus';
import { ServiceRegistry } from './ServiceRegistry';
import { ContributionRegistry } from './ContributionRegistry';

export type Kernel<Events extends EventMap> = {
  services: ServiceRegistry;
  events: EventBus<Events>;
  contributions: ContributionRegistry;
};

export function createKernel<Events extends EventMap>(): Kernel<Events> {
  return {
    services: new ServiceRegistry(),
    events: new EventBus<Events>(),
    contributions: new ContributionRegistry(),
  };
}
