import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMagnetTemplateFromPlugin,
  getPluginRendererDefinition,
  validatePmpmManifest,
} from '../pmpm';
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
    expect(magnet.anchors).toHaveLength(0);
    expect(magnet.gridFootprint).toEqual({ width: 4, height: 5 });
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

  it('creates a magnet template with no anchors when defaultAnchor is missing', () => {
    const plugin: InstalledPmpmPlugin = {
      manifest: {
        formatVersion: '1.0',
        type: 'magnet-plugin',
        metadata: { id: 'magnet-no-anchor', name: 'No Anchor', version: '0.1.0' },
        entryPoint: 'dist/plugin.js',
      },
      entryCode: 'export function mount() {}',
      installedAt: Date.now(),
    };

    const magnet = createMagnetTemplateFromPlugin(plugin);
    expect(magnet.id).toBe('magnet-no-anchor');
    expect(magnet.anchorType).toBe('single');
    expect(magnet.anchors).toHaveLength(0);
    expect(magnet.gridFootprint).toEqual({ width: 1, height: 1 });
  });

  it('validates contributions.pages entries', () => {
    const manifest = {
      formatVersion: '1.0',
      type: 'magnet-plugin',
      metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
      entryPoint: 'dist/plugin.js',
      contributions: {
        pages: [{ id: 'main', title: 'Main Page', order: 10 }],
      },
    };

    expect(() => validatePmpmManifest(manifest)).not.toThrow();

    const duplicated = {
      ...manifest,
      contributions: {
        pages: [
          { id: 'main', title: 'Main Page' },
          { id: 'main', title: 'Duplicate' },
        ],
      },
    };
    expect(() => validatePmpmManifest(duplicated)).toThrow(/duplicated/);
  });

  it('validates contributions.windows entries', () => {
    const manifest = {
      formatVersion: '1.0',
      type: 'magnet-plugin',
      metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
      entryPoint: 'dist/plugin.js',
      contributions: {
        windows: [{ id: 'panel', title: 'Panel', width: 640, height: 480 }],
      },
    };

    expect(() => validatePmpmManifest(manifest)).not.toThrow();

    const invalidWidth = {
      ...manifest,
      contributions: {
        windows: [{ id: 'panel', title: 'Panel', width: -1 }],
      },
    };
    expect(() => validatePmpmManifest(invalidWidth)).toThrow(/width/);
  });

  it('validates contributions.workbenches entries', () => {
    const manifest = {
      formatVersion: '1.0',
      type: 'magnet-plugin',
      metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
      entryPoint: 'dist/plugin.js',
      contributions: {
        workbenches: [{ id: 'alt', title: 'Alternate Workbench', order: 10 }],
      },
    };

    expect(() => validatePmpmManifest(manifest)).not.toThrow();

    const duplicated = {
      ...manifest,
      contributions: {
        workbenches: [
          { id: 'alt', title: 'Alternate Workbench' },
          { id: 'alt', title: 'Duplicate' },
        ],
      },
    };
    expect(() => validatePmpmManifest(duplicated)).toThrow(/duplicated/);
  });
});
