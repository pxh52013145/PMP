import { describe, expect, it } from 'vitest';

import type { MagnetConfig } from './configManager';
import { applyConfig } from './configManager';
import { createDefaultBoundsForMagnet } from '../modules/magnets/layoutPresets';
import type { Magnet } from '../types/pixel';

describe('configManager', () => {
  it('keeps custom/plugin magnets that are unplaced but declare a grid footprint', () => {
    const pluginMagnet: Magnet = {
      id: 'stream-protocol-demo',
      type: 'custom',
      name: 'Stream Protocol Demo',
      renderer: 'stream-protocol-demo',
      previewText: 'Stream Protocol Demo',
      anchorType: 'rectangular',
      anchors: [],
      gridFootprint: { width: 6, height: 5 },
      bounds: createDefaultBoundsForMagnet('rectangular', {}),
      content: '',
      style: {
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
      },
      state: 'idle',
      interactions: {
        draggable: true,
        clickable: true,
      },
    };

    const config: MagnetConfig = {
      version: '1.3.0',
      gridSize: { columns: 27, rows: 20 },
      magnets: {},
      customMagnets: [pluginMagnet],
    };

    const applied = applyConfig(config, []);

    expect(applied.magnetLibrary).toEqual([
      expect.objectContaining({
        id: 'stream-protocol-demo',
        anchors: [],
        gridFootprint: { width: 6, height: 5 },
        renderer: 'stream-protocol-demo',
      }),
    ]);
    expect(applied.activeMagnetIds.size).toBe(0);
  });
});
