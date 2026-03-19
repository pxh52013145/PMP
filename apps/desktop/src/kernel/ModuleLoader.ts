import type { EventMap, EventBus } from './EventBus';
import type { KernelModule } from './Module';
import type { ServiceRegistryApi } from './ServiceRegistry';
import type { ContributionRegistryApi } from './ContributionRegistry';
import type { ServiceToken } from './tokens';
import type { RegisterOptions } from './ServiceRegistry';
import type { Contribution, RegisterContributionOptions } from './ContributionRegistry';
import type { EventListener, ScopedEventBus } from './EventBus';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

type Disposable = () => void;
const telemetry = getTelemetryLogger('kernel', 'ModuleLoader');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class DisposableBag {
  private readonly disposers = new Set<Disposable>();

  track(disposer: Disposable): Disposable {
    this.disposers.add(disposer);

    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.disposers.delete(disposer);
      disposer();
    };
  }

  disposeAll(): void {
    for (const disposer of Array.from(this.disposers)) {
      try {
        disposer();
      } catch (error) {
        telemetry.warn('module_loader.scoped_disposer.failed', {
          message: readErrorMessage(error),
        });
      }
    }
    this.disposers.clear();
  }
}

export class ModuleLoader<Events extends EventMap> {
  private readonly active: Array<{
    module: KernelModule<Events>;
    cleanupFromActivate?: (() => void) | void;
    bag: DisposableBag;
  }> = [];

  constructor(
    private readonly services: ServiceRegistryApi,
    private readonly events: EventBus<Events>,
    private readonly contributions: ContributionRegistryApi
  ) {}

  activate(modules: KernelModule<Events>[]): void {
    for (const module of modules) {
      const bag = new DisposableBag();

      const scopedServices: ServiceRegistryApi = {
        register: <T>(token: ServiceToken<T>, service: T, options: RegisterOptions = {}) => {
          return bag.track(this.services.register(token, service, options));
        },
        get: <T>(token: ServiceToken<T>) => this.services.get(token),
        getOptional: <T>(token: ServiceToken<T>) => this.services.getOptional(token),
        has: <T>(token: ServiceToken<T>) => this.services.has(token),
      };

      const scopedEvents: ScopedEventBus<Events> = (() => {
        const scoped = this.events.withSource(module.id);
        return {
          emit: scoped.emit,
          on: <K extends keyof Events & string>(event: K, listener: EventListener<Events[K]>) =>
            bag.track(scoped.on(event, listener)),
        };
      })();

      const scopedContributions: ContributionRegistryApi = {
        register: <C extends Contribution>(
          contribution: C,
          options: RegisterContributionOptions = {}
        ): Disposable => {
          return bag.track(this.contributions.register(contribution, options));
        },
        get: <C extends Contribution>(kind: C['kind'], id: string): C | null =>
          this.contributions.get(kind, id),
        list: <C extends Contribution>(kind: C['kind']): C[] => this.contributions.list(kind),
        listAll: <C extends Contribution>(): C[] => this.contributions.listAll(),
        subscribe: (listener) => bag.track(this.contributions.subscribe(listener)),
      };

      const ctx = {
        services: scopedServices,
        events: scopedEvents,
        contributions: scopedContributions,
      };

      try {
        const cleanupFromActivate = module.activate(ctx);
        this.active.push({ module, cleanupFromActivate, bag });
      } catch (error) {
        bag.disposeAll();
        try {
          this.deactivateAll();
        } catch {
          // ignore
        }
        throw error;
      }
    }
  }

  deactivateAll(): void {
    for (const entry of [...this.active].reverse()) {
      try {
        entry.module.deactivate?.();
      } catch (error) {
        telemetry.warn('module_loader.deactivate.failed', {
          message: readErrorMessage(error),
          fields: {
            moduleId: entry.module.id,
          },
        });
      }

      if (typeof entry.cleanupFromActivate === 'function') {
        try {
          entry.cleanupFromActivate();
        } catch (error) {
          telemetry.warn('module_loader.activate_cleanup.failed', {
            message: readErrorMessage(error),
            fields: {
              moduleId: entry.module.id,
            },
          });
        }
      }

      entry.bag.disposeAll();
    }
    this.active.length = 0;
  }
}
