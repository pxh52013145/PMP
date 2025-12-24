import { describe, expect, it } from 'vitest';
import { ContributionRegistry } from '../ContributionRegistry';
import { EventBus, type EventMap } from '../EventBus';
import { ModuleLoader } from '../ModuleLoader';
import { ServiceRegistry } from '../ServiceRegistry';
import { createServiceToken } from '../tokens';
import type { KernelModule } from '../Module';

type TestEvents = EventMap & {
  ping: { n: number };
  hello: { msg: string };
};

describe('ModuleLoader', () => {
  it('scopes registrations and subscriptions to module lifetime', () => {
    const services = new ServiceRegistry();
    const events = new EventBus<TestEvents>();
    const contributions = new ContributionRegistry();
    const loader = new ModuleLoader<TestEvents>(services, events, contributions);

    const token = createServiceToken<{ value: number }>('test/service');
    const count = { ping: 0 };

    const moduleA: KernelModule<TestEvents> = {
      id: 'module-a',
      activate: ({ services: scopedServices, events: scopedEvents, contributions: scopedContribs }) => {
        scopedServices.register(token, { value: 42 });
        scopedContribs.register({ kind: 'demo', id: 'c1' });
        scopedEvents.on('ping', () => {
          count.ping += 1;
        });
      },
    };

    loader.activate([moduleA]);
    expect(services.has(token)).toBe(true);
    expect(contributions.get('demo', 'c1')).not.toBeNull();

    events.emit('ping', { n: 1 });
    expect(count.ping).toBe(1);

    loader.deactivateAll();
    expect(services.has(token)).toBe(false);
    expect(contributions.get('demo', 'c1')).toBeNull();

    events.emit('ping', { n: 2 });
    expect(count.ping).toBe(1);
  });

  it('tags emitted events with module source', () => {
    const services = new ServiceRegistry();
    const events = new EventBus<TestEvents>();
    const contributions = new ContributionRegistry();
    const loader = new ModuleLoader<TestEvents>(services, events, contributions);

    let metaSource: string | undefined;
    events.on('hello', (_payload, meta) => {
      metaSource = meta.source;
    });

    const moduleA: KernelModule<TestEvents> = {
      id: 'module-a',
      activate: ({ events: scopedEvents }) => {
        scopedEvents.emit('hello', { msg: 'hi' });
      },
    };

    loader.activate([moduleA]);
    expect(metaSource).toBe('module-a');
  });
});

