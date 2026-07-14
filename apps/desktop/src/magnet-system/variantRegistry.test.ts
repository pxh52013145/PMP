import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMagnetVariants,
  getMagnetVariantsRevision,
  listMagnetVariants,
  registerMagnetVariant,
  replaceMagnetVariants,
  subscribeMagnetVariants,
} from './variantRegistry';

describe('magnet variant registry', () => {
  afterEach(() => {
    clearMagnetVariants();
  });

  it('notifies subscribers when variants are registered or cleared', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMagnetVariants(listener);
    const initialRevision = getMagnetVariantsRevision();

    registerMagnetVariant('demo-renderer', { id: 'compact', label: 'Compact' });
    expect(listMagnetVariants('demo-renderer')).toHaveLength(1);
    expect(getMagnetVariantsRevision()).toBeGreaterThan(initialRevision);
    expect(listener).toHaveBeenCalledTimes(1);

    clearMagnetVariants('demo-renderer');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('does not notify when a duplicate is explicitly rejected', () => {
    registerMagnetVariant('demo-renderer', { id: 'compact', label: 'Compact' });
    const listener = vi.fn();
    const unsubscribe = subscribeMagnetVariants(listener);

    registerMagnetVariant(
      'demo-renderer',
      { id: 'compact', label: 'Replacement' },
      { overwrite: false }
    );

    expect(listener).not.toHaveBeenCalled();
    expect(listMagnetVariants('demo-renderer')[0]?.label).toBe('Compact');
    unsubscribe();
  });

  it('replaces a renderer catalog with one notification', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMagnetVariants(listener);

    replaceMagnetVariants('demo-renderer', [
      { id: 'default', label: 'Default' },
      { id: 'compact', label: 'Compact' },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listMagnetVariants('demo-renderer').map((variant) => variant.id)).toEqual([
      'default',
      'compact',
    ]);
    unsubscribe();
  });
});
