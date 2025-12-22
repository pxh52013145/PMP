import type { EventMap, EventBus } from './EventBus';
import type { KernelModule } from './Module';
import type { ServiceRegistry } from './ServiceRegistry';
import type { ContributionRegistry } from './ContributionRegistry';

export class ModuleLoader<Events extends EventMap> {
  private readonly active: Array<{
    module: KernelModule<Events>;
    cleanupFromActivate?: (() => void) | void;
  }> = [];

  constructor(
    private readonly services: ServiceRegistry,
    private readonly events: EventBus<Events>,
    private readonly contributions: ContributionRegistry
  ) {}

  activate(modules: KernelModule<Events>[]): void {
    for (const module of modules) {
      const ctx = {
        services: this.services,
        events: this.events.withSource(module.id),
        contributions: this.contributions,
      };
      const cleanupFromActivate = module.activate(ctx);
      this.active.push({ module, cleanupFromActivate });
    }
  }

  deactivateAll(): void {
    for (const entry of [...this.active].reverse()) {
      try {
        entry.module.deactivate?.();
      } catch (error) {
        console.warn(`[ModuleLoader] deactivate() failed: ${entry.module.id}`, error);
      }

      if (typeof entry.cleanupFromActivate === 'function') {
        try {
          entry.cleanupFromActivate();
        } catch (error) {
          console.warn(`[ModuleLoader] activate cleanup failed: ${entry.module.id}`, error);
        }
      }
    }
    this.active.length = 0;
  }
}
