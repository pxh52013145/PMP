import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { hasInstalledExtensionStartupActivation } from './activationEvents';

function loadStartupWorkerManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/startup-worker-demo/manifest.v2.json'
  );
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

describe('startup worker demo fixture', () => {
  it('declares an onStartup extension-host runtime for long-lived worker activation', () => {
    const manifest = loadStartupWorkerManifest();

    expect(manifest.identity.id).toBe('startup-worker-demo');
    expect(manifest.activationEvents).toEqual(['onStartup']);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'worker.main',
        kind: 'extension-host',
        entry: 'index.js',
        priority: 25,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['inline-json'] },
      },
    ]);
    expect(manifest.requiresCapabilities).toEqual([
      { capabilityId: 'core.capability-registry' },
      { capabilityId: 'host.pmp.storage.config' },
    ]);
    expect(hasInstalledExtensionStartupActivation(manifest)).toBe(true);
  });
});
