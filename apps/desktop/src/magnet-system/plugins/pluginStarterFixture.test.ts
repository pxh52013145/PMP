import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { buildInstalledExtensionActivationViewId } from './activationEvents';
import { resolveInstalledExtensionRuntime } from './runtime';

function loadPluginStarterManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(process.cwd(), '../../community/plugins/plugin-starter/manifest.v2.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

function createRecord(manifest: PxpManifestV2): InstalledExtensionRecord<PxpManifestV2> {
  return {
    manifest,
    installedAt: 1_710_000_000_000,
    enabled: true,
  };
}

describe('plugin starter fixture', () => {
  it('declares a minimal manifest-v2 webview starter for page, settings, and magnet surfaces', () => {
    const manifest = loadPluginStarterManifest();

    expect(manifest.identity.id).toBe('plugin-starter');
    expect(manifest.activationEvents).toEqual([
      'onView:starter-settings',
      'onView:starter-page',
      'onView:plugin-starter',
    ]);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'index.js',
        priority: 20,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['inline-json'] },
      },
    ]);
    expect(manifest.contributes?.host?.pmp).toMatchObject({
      settingsPanels: [{ id: 'starter-settings' }],
      pages: [{ id: 'starter-page' }],
      magnets: {
        defaultVariant: 'default',
        variants: [{ id: 'default' }],
      },
    });
  });

  it('maps the starter magnet activation onto the manifest identity', () => {
    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'plugin-starter',
        surfaceKind: 'magnet',
      })
    ).toBe('plugin-starter');
  });

  it('resolves starter view surfaces onto the native host-frame launcher', () => {
    const manifest = loadPluginStarterManifest();
    const record = createRecord(manifest);

    for (const surfaceKind of ['settings', 'page', 'magnet'] as const) {
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
