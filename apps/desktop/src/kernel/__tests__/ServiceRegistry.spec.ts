import { describe, expect, it } from 'vitest';
import { createServiceToken } from '../tokens';
import { ServiceRegistry } from '../ServiceRegistry';

describe('ServiceRegistry', () => {
  it('registers and resolves services by token', () => {
    const registry = new ServiceRegistry();
    const token = createServiceToken<{ value: number }>('test.service');
    const service = { value: 1 };

    const unregister = registry.register(token, service);

    expect(registry.has(token)).toBe(true);
    expect(registry.get(token)).toBe(service);
    expect(registry.getOptional(token)).toBe(service);

    unregister();
    expect(registry.has(token)).toBe(false);
    expect(registry.getOptional(token)).toBeNull();
  });

  it('throws on duplicate registration without replace', () => {
    const registry = new ServiceRegistry();
    const token = createServiceToken<{ value: number }>('test.service');
    registry.register(token, { value: 1 });
    expect(() => registry.register(token, { value: 2 })).toThrow(/already registered/i);
  });

  it('supports replace option', () => {
    const registry = new ServiceRegistry();
    const token = createServiceToken<{ value: number }>('test.service');
    const first = { value: 1 };
    const second = { value: 2 };

    registry.register(token, first);
    registry.register(token, second, { replace: true });
    expect(registry.get(token)).toBe(second);
  });
});

