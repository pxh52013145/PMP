import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { buildInstalledExtensionActivationViewId } from './activationEvents';
import { resolveInstalledExtensionRuntime } from './runtime';

function loadViewSurfaceManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/view-surface-demo/manifest.v2.json'
  );
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

function createRecord(manifest: PxpManifestV2): InstalledExtensionRecord<PxpManifestV2> {
  return {
    manifest,
    installedAt: 1_710_000_000_000,
    enabled: true,
  };
}

describe('view-surface demo fixture', () => {
  it('declares a manifest-v2 webview runtime with host.pmp long-lived view surfaces', () => {
    const manifest = loadViewSurfaceManifest();

    expect(manifest.identity.id).toBe('view-surface-demo');
    expect(manifest.activationEvents).toEqual([
      'onView:demo-settings',
      'onView:demo-page',
      'onView:demo-window',
      'onView:demo-visualizer',
      'onView:view-surface-demo',
    ]);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'index.js',
        priority: 30,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['inline-json'] },
      },
    ]);
    expect(manifest.contributes?.host?.pmp).toMatchObject({
      settingsPanels: [{ id: 'demo-settings' }],
      pages: [{ id: 'demo-page' }],
      windows: [{ id: 'demo-window', width: 920, height: 620 }],
      visualizers: [{ id: 'demo-visualizer', inputs: ['spectrum'] }],
      magnets: {
        defaultVariant: 'compact',
        variants: [{ id: 'compact' }, { id: 'expanded' }],
      },
    });
  });

  it('maps magnet activation onto the manifest identity so onView scheduling can resolve it', () => {
    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'view-surface-demo',
        surfaceKind: 'magnet',
      })
    ).toBe('view-surface-demo');
  });

  it('resolves every host.pmp view surface onto the native host-frame launcher', () => {
    const manifest = loadViewSurfaceManifest();
    const record = createRecord(manifest);

    for (const surfaceKind of ['settings', 'page', 'window', 'visualizer', 'magnet'] as const) {
      const resolution = resolveInstalledExtensionRuntime(record, {
        hostId: 'pmp',
        surfaceKind,
      });

      expect(resolution.status).toBe('resolved');
      if (resolution.status !== 'resolved') continue;
      expect(resolution.runtime.runtimeId).toBe('webview.main');
      expect(resolution.launcher.id).toBe('pxp.webview.host-frame');
      expect(resolution.source).toBe('manifest-runtime');
    }
  });
});
