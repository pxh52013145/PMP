export type EventMap = Record<string, unknown>;
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

export type EventMeta = {
  timestamp: number;
  source?: string;
};
const telemetry = getTelemetryLogger('kernel', 'EventBus');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type EventListener<Payload> = (payload: Payload, meta: EventMeta) => void;

export type Unsubscribe = () => void;

export type ScopedEventBus<Events extends EventMap> = {
  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void;
  on<K extends keyof Events & string>(event: K, listener: EventListener<Events[K]>): Unsubscribe;
};

export class EventBus<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events & string, Set<EventListener<unknown>>>();

  on<K extends keyof Events & string>(event: K, listener: EventListener<Events[K]>): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as EventListener<unknown>);
    this.listeners.set(event, set);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(listener as EventListener<unknown>);
      if (current.size === 0) this.listeners.delete(event);
    };
  }

  emit<K extends keyof Events & string>(
    event: K,
    payload: Events[K],
    meta: Partial<EventMeta> = {}
  ): void {
    const metaWithDefaults: EventMeta = {
      timestamp: meta.timestamp ?? Date.now(),
      source: meta.source,
    };
    const current = this.listeners.get(event);
    if (!current || current.size === 0) return;
    for (const listener of Array.from(current)) {
      try {
        (listener as EventListener<Events[K]>)(payload, metaWithDefaults);
      } catch (error) {
        telemetry.warn('event_bus.listener.failed', {
          message: readErrorMessage(error),
          fields: {
            event: String(event),
            source: metaWithDefaults.source ?? null,
          },
        });
      }
    }
  }

  withSource(source: string): ScopedEventBus<Events> {
    return {
      emit: (event, payload) => this.emit(event, payload, { source }),
      on: (event, listener) => this.on(event, listener),
    };
  }
}
