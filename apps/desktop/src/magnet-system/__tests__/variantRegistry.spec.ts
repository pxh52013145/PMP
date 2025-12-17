import { beforeEach, describe, expect, it } from 'vitest';
import { clearMagnetVariants, listMagnetVariants, registerMagnetVariant } from '../variantRegistry';

describe('variantRegistry', () => {
  beforeEach(() => {
    clearMagnetVariants();
  });

  it('registers and lists variants per renderer', () => {
    registerMagnetVariant('track-info', { id: 'v1', label: 'Variant 1' });
    registerMagnetVariant('track-info', { id: 'v2', label: 'Variant 2' });
    registerMagnetVariant('other', { id: 'x', label: 'X' });

    expect(listMagnetVariants('track-info').map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(listMagnetVariants('other').map((v) => v.id)).toEqual(['x']);
  });

  it('respects overwrite=false', () => {
    registerMagnetVariant('track-info', { id: 'v1', label: 'A' });
    registerMagnetVariant('track-info', { id: 'v1', label: 'B' }, { overwrite: false });

    expect(listMagnetVariants('track-info')[0]?.label).toBe('A');
  });
});

