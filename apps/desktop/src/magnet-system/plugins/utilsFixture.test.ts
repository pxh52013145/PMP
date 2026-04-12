import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { buildInstalledExtensionActivationViewId } from './activationEvents';
import { resolveInstalledExtensionRuntime } from './runtime';

function loadUtilsManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(process.cwd(), '../../community/plugins/utils/manifest.v2.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

function createRecord(manifest: PxpManifestV2): InstalledExtensionRecord<PxpManifestV2> {
  return {
    manifest,
    installedAt: 1_710_000_000_000,
    enabled: true,
  };
}

describe('utils fixture', () => {
  it('declares a hybrid manifest-v2 fixture with webview surfaces and sidecar commands', () => {
    const manifest = loadUtilsManifest();

    expect(manifest.identity.id).toBe('utils');
    expect(manifest.activationEvents).toEqual([
      'onView:utils',
      'onView:utils-page',
      'onView:utils-overlay',
      'onView:utils-widget',
      'onCommand:utils.probe.system',
      'onCommand:utils.probe.windows',
      'onCommand:utils.simulate.hang',
      'onCommand:utils.simulate.crash',
    ]);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'index.js',
        priority: 40,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['inline-json'] },
      },
      {
        runtimeId: 'sidecar.main',
        kind: 'sidecar',
        entry: 'bin/utils-sidecar.js',
        priority: 30,
        sandbox: 'native',
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['pipe'] },
      },
    ]);
    expect(manifest.contributes?.core?.commands?.map((command) => command.id)).toEqual([
      'utils.probe.system',
      'utils.probe.windows',
      'utils.simulate.hang',
      'utils.simulate.crash',
    ]);
    expect(manifest.contributes?.host?.pmp).toMatchObject({
      pages: [{ id: 'utils-page' }],
      shellSurfaces: [
        { id: 'utils-overlay', surfaceType: 'overlay' },
        { id: 'utils-widget', surfaceType: 'desktop-widget' },
      ],
      magnets: {
        defaultVariant: 'hub',
        variants: [{ id: 'hub' }, { id: 'compact' }],
      },
    });
  });

  it('maps magnet and shell surfaces onto the expected onView ids', () => {
    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'utils',
        surfaceKind: 'magnet',
      })
    ).toBe('utils');
    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'utils',
        surfaceKind: 'overlay',
        surfaceId: 'utils-overlay',
      })
    ).toBe('utils-overlay');
    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'utils',
        surfaceKind: 'desktop-widget',
        surfaceId: 'utils-widget',
      })
    ).toBe('utils-widget');
  });

  it('resolves view surfaces to webview host-frame and commands to the native sidecar launcher', () => {
    const manifest = loadUtilsManifest();
    const record = createRecord(manifest);

    for (const surfaceKind of ['magnet', 'page', 'overlay', 'desktop-widget'] as const) {
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

    const commandResolution = resolveInstalledExtensionRuntime(record, {
      hostId: 'pmp',
      surfaceKind: 'command',
      preferCommandWorker: true,
    });

    expect(commandResolution.status).toBe('resolved');
    if (commandResolution.status !== 'resolved') return;
    expect(commandResolution.runtime.runtimeId).toBe('sidecar.main');
    expect(commandResolution.launcher.id).toBe('pxp.sidecar.native-process');
    expect(commandResolution.source).toBe('manifest-runtime');
  });
});
