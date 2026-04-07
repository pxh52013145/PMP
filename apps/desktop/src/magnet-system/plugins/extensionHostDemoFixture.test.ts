import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { resolveInstalledExtensionRuntime } from './runtime';

function loadExtensionHostManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/command-surface-demo/manifest.v2.json'
  );
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

describe('extension-host demo fixture', () => {
  it('declares a manifest-v2 extension-host runtime for command execution', () => {
    const manifest = loadExtensionHostManifest();

    expect(manifest.identity.id).toBe('command-surface-demo');
    expect(manifest.activationEvents).toEqual(['onCommand:increment', 'onCommand:reset']);
    expect(manifest.requiresCapabilities).toEqual([
      {
        capabilityId: 'host.pmp.storage.config',
      },
    ]);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'worker.main',
        kind: 'extension-host',
        entry: 'index.js',
        priority: 20,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['inline-json'] },
      },
    ]);
  });

  it('resolves the fixture onto the dedicated worker launcher slot for command execution', () => {
    const manifest = loadExtensionHostManifest();
    const resolution = resolveInstalledExtensionRuntime(
      {
        manifest,
        installedAt: 1_710_000_000_000,
        enabled: true,
      },
      {
        hostId: 'pmp',
        surfaceKind: 'command',
        preferCommandWorker: true,
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('worker.main');
    expect(resolution.launcher.id).toBe('pxp.extension-host.worker');
    expect(resolution.source).toBe('manifest-runtime');
  });
});
