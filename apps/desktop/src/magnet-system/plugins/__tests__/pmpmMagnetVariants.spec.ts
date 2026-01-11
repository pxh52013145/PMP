import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { clearMagnetRenderers } from '../../registry';
import { clearMagnetVariants, listMagnetVariants } from '../../variantRegistry';
import { createPmpmMagnetRenderersModule } from '../pmpmMagnetRenderersModule';
import { validatePmpmManifest } from '../pmpm';

beforeEach(() => {
  localStorage.clear();
  clearMagnetRenderers();
  clearMagnetVariants();
});

describe('pmpm magnet variants', () => {
  it('validates manifest.magnet.variants and defaultVariant', () => {
    const manifest = {
      formatVersion: '1.0',
      type: 'magnet-plugin',
      metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
      entryPoint: 'dist/plugin.js',
      magnet: {
        defaultVariant: 'neon',
        variants: [
          { id: 'default', label: 'Default' },
          { id: 'neon', label: 'Neon', description: 'Glowy' },
        ],
      },
    };

    expect(() => validatePmpmManifest(manifest)).not.toThrow();

    expect(() =>
      validatePmpmManifest({
        ...manifest,
        magnet: {
          ...manifest.magnet,
          variants: [{ id: 'default', label: 'Default' }, { id: 'default', label: 'Dup' }],
        },
      })
    ).toThrow(/duplicated/);
  });

  it('registers plugin variants into MagnetVariantRegistry', () => {
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([
        {
          manifest: {
            formatVersion: '1.0',
            type: 'magnet-plugin',
            metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
            entryPoint: 'dist/plugin.js',
            magnet: {
              defaultVariant: 'default',
              variants: [
                { id: 'default', label: 'Default' },
                { id: 'neon', label: 'Neon' },
              ],
            },
          },
          entryCode: 'export function mount() {}',
          installedAt: Date.now(),
        },
      ])
    );

    const module = createPmpmMagnetRenderersModule();
    const deactivate = module.activate({} as never);

    expect(listMagnetVariants('magnet-demo').map((v) => v.id)).toEqual(['default', 'neon']);

    if (typeof deactivate === 'function') {
      deactivate();
    }
    expect(listMagnetVariants('magnet-demo')).toEqual([]);
  });
});
