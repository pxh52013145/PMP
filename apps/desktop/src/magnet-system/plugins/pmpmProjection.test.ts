import { describe, expect, it } from 'vitest';
import type { InstalledPmpmPluginRecord, PmpmManifest } from '@pixel-matrix/plugin-compat-pmpm';
import {
  listEffectiveCapabilityIdsFromInstalledPmpmPlugin,
  listPmpmPermissionCapabilityBindings,
  projectInstalledPmpmPluginToExtensionRecord,
  projectPmpmManifestToExtensionManifest,
} from './pmpmProjection';

const SAMPLE_MANIFEST: PmpmManifest = {
  formatVersion: '1.0',
  type: 'magnet-plugin',
  metadata: {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    version: '1.2.3',
    description: 'Projection sample',
  },
  entryPoint: 'dist/index.js',
  permissions: ['api:navigation', 'storage:local', 'api:navigation'],
  contributions: {
    commands: [
      {
        kind: 'command',
        id: 'refresh-library',
        title: 'Refresh Library',
      },
    ],
  },
};

const SAMPLE_PLUGIN: InstalledPmpmPluginRecord = {
  manifest: SAMPLE_MANIFEST,
  installedAt: 1_710_000_000_000,
  packageSha256: 'pkg-digest',
  manifestSha256: 'manifest-digest',
  entrySha256: 'entry-digest',
  signature: {
    verified: true,
    keyId: 'trusted-key',
    summary: 'trusted',
  },
  enabled: false,
  disabledReason: 'manual',
  deniedPermissions: ['storage:local'],
  lastError: 'boom',
  lastErrorAt: 1_710_000_000_123,
};

describe('pmpm projection', () => {
  it('projects PMPM manifests into v2 extension manifests', () => {
    const projected = projectPmpmManifestToExtensionManifest(SAMPLE_MANIFEST);

    expect(projected.schemaVersion).toBe('2.0');
    expect(projected.identity.id).toBe('demo-plugin');
    expect(projected.hostTargets).toEqual([{ hostId: 'pmp', required: true }]);
    expect(projected.runtimes[0]).toMatchObject({
      runtimeId: 'compat.pmpm.main',
      bridge: 'compat.pmpm.bridge',
    });
    expect(projected.compat?.[0]).toMatchObject({
      compatLayerId: 'compat.pmpm',
    });
  });

  it('projects installed plugins into installed extension records', () => {
    const projected = projectInstalledPmpmPluginToExtensionRecord(SAMPLE_PLUGIN);

    expect(projected.manifest.identity.id).toBe('demo-plugin');
    expect(projected.enabled).toBe(false);
    expect(projected.disabledReason).toBe('manual');
    expect(projected.deniedCapabilities).toEqual(['host.pmp.storage.config']);
    expect(projected.packageDigest).toBe('pkg-digest');
    expect(projected.signature).toEqual({
      verified: true,
      keyId: 'trusted-key',
      summary: 'trusted',
    });
  });

  it('preserves resolved sidecar artifact paths when install records materialize real files', () => {
    const projected = projectInstalledPmpmPluginToExtensionRecord({
      ...SAMPLE_PLUGIN,
      manifest: {
        ...SAMPLE_MANIFEST,
        entryPoint: 'sidecar/echo-runtime.js',
        runtime: {
          runtimeId: 'sidecar.main',
          kind: 'sidecar',
          bridge: 'pxp.runtime.bridge.v1',
          sandbox: 'native',
          dataPlane: { kinds: ['pipe'] },
        },
      },
      resolvedArtifacts: [
        {
          runtimeId: 'sidecar.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/pmpm-artifacts/demo-plugin/sidecar/echo-runtime.js',
          sha256: 'entry-digest',
        },
      ],
    });

    expect(projected.manifest.runtimes[0]).toMatchObject({
      runtimeId: 'sidecar.main',
      kind: 'sidecar',
      entry: 'sidecar/echo-runtime.js',
    });
    expect(projected.resolvedArtifacts).toEqual([
      {
        runtimeId: 'sidecar.main',
        path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/pmpm-artifacts/demo-plugin/sidecar/echo-runtime.js',
        sha256: 'entry-digest',
      },
    ]);
  });

  it('lists permission-to-capability bindings and effective capability ids', () => {
    const bindings = listPmpmPermissionCapabilityBindings(SAMPLE_PLUGIN);

    expect(bindings).toEqual([
      {
        permission: 'api:navigation',
        capabilityId: 'host.pmp.navigation',
        granted: true,
      },
      {
        permission: 'storage:local',
        capabilityId: 'host.pmp.storage.config',
        granted: false,
      },
      {
        permission: 'api:navigation',
        capabilityId: 'host.pmp.navigation',
        granted: true,
      },
    ]);
    expect(listEffectiveCapabilityIdsFromInstalledPmpmPlugin(SAMPLE_PLUGIN)).toEqual([
      'host.pmp.navigation',
    ]);
  });
});
