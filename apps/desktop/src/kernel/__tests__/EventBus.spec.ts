import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../EventBus';

type Events = {
  'a/happened': { value: number };
};

describe('EventBus', () => {
  it('emits events with tracing meta', () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();

    bus.on('a/happened', listener);
    bus.emit('a/happened', { value: 1 }, { source: 'unit-test', timestamp: 123 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({ value: 1 });
    expect(listener.mock.calls[0]?.[1]).toEqual({ source: 'unit-test', timestamp: 123 });
  });

  it('does not throw if a listener fails', () => {
    const bus = new EventBus<Events>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bus.on('a/happened', () => {
      throw new Error('boom');
    });

    expect(() => bus.emit('a/happened', { value: 1 })).not.toThrow();

    warn.mockRestore();
  });

  it('supports source-scoped emitter', () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    bus.on('a/happened', listener);

    const scoped = bus.withSource('scoped-module');
    scoped.emit('a/happened', { value: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1].source).toBe('scoped-module');
  });
});

