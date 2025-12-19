import { describe, it, expect, beforeEach } from 'vitest';
import { createMagnetTemplateFromPlugin, getPluginRendererDefinition } from '../pmpm';
import type { InstalledPmpmPlugin } from '../pmpm';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

beforeEach(() => {
  localStorage.clear();
});

describe('pmpm plugins', () => {
  it('creates a rectangular magnet template from range coordinates', () => {
    const plugin: InstalledPmpmPlugin = {
      manifest: {
        formatVersion: '1.0',
        type: 'magnet-plugin',
        metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
        entryPoint: 'dist/plugin.js',
        magnet: {
          defaultAnchor: { type: 'range', coordinates: [{ x: 1, y: 2 }, { x: 4, y: 6 }] },
        },
      },
      entryCode: 'export function mount() {}',
      installedAt: Date.now(),
    };

    const magnet = createMagnetTemplateFromPlugin(plugin);
    expect(magnet.id).toBe('magnet-demo');
    expect(magnet.anchorType).toBe('rectangular');
    expect(magnet.anchors).toHaveLength(4);
  });

  it('exposes plugin renderer definition when installed', () => {
    const installed = [
      {
        manifest: {
          formatVersion: '1.0',
          type: 'magnet-plugin',
          metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
          entryPoint: 'dist/plugin.js',
        },
        entryCode: 'export function mount() {}',
        installedAt: Date.now(),
      },
    ];
    localStorage.setItem(STORAGE_KEYS.PMPM_PLUGINS, JSON.stringify(installed));

    const def = getPluginRendererDefinition('magnet-demo');
    expect(def?.id).toBe('magnet-demo');
    expect(def?.source).toBe('plugin');
    expect(typeof def?.render).toBe('function');
  });
});
