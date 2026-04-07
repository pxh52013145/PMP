import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import {
  convertPmpmManifestToPxpManifestV2,
  validatePmpmManifest,
  type PmpmManifest,
} from '@pixel-matrix/plugin-compat-pmpm';
import { resolveInstalledExtensionRuntime } from './runtime';

function loadSidecarManifest(): PxpManifestV2 {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/sidecar-capability-demo/manifest.v2.json'
  );
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PxpManifestV2;
}

function loadInstallableSidecarPmpmManifest(): PmpmManifest {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/sidecar-echo-demo/manifest.json'
  );
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  validatePmpmManifest(raw);
  return raw;
}

describe('sidecar demo fixture', () => {
  it('declares a manifest-v2 sidecar runtime with native-process bridge metadata', () => {
    const manifest = loadSidecarManifest();

    expect(manifest.identity.id).toBe('sidecar-capability-demo');
    expect(manifest.activationEvents).toEqual(['onCommand:sidecar-capability-demo.smoke']);
    expect(manifest.requiresCapabilities).toEqual([
      {
        capabilityId: 'core.capability-registry',
      },
      {
        capabilityId: 'host.pmp.audio-engine.analysis',
      },
    ]);
    expect(manifest.runtimes).toEqual([
      {
        runtimeId: 'sidecar.main',
        kind: 'sidecar',
        entry: 'bin/sidecar-capability-demo.js',
        priority: 10,
        sandbox: 'native',
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: { kinds: ['pipe'] },
      },
    ]);
  });

  it('resolves the fixture onto the sidecar launcher slot for command execution', () => {
    const manifest = loadSidecarManifest();
    const resolution = resolveInstalledExtensionRuntime(
      {
        manifest,
        installedAt: 1_710_000_000_000,
        enabled: true,
      },
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    if (resolution.status === 'resolved') {
      expect(resolution.runtime.runtimeId).toBe('sidecar.main');
      expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
      expect(resolution.source).toBe('manifest-runtime');
      return;
    }

    expect(resolution.runtime?.runtimeId).toBe('sidecar.main');
    expect(resolution.candidateLaunchers.map((launcher) => launcher.id)).toEqual([
      'pxp.sidecar.native-process',
    ]);
    expect(resolution.issues).toContain(
      'Runtime "sidecar.main" only matches planned launchers: pxp.sidecar.native-process'
    );
  });

  it('ships an installable PMPM sidecar demo that projects onto the native-process runtime slot', () => {
    const manifest = loadInstallableSidecarPmpmManifest();
    const projected = convertPmpmManifestToPxpManifestV2(manifest);

    expect(projected.identity.id).toBe('sidecar-echo-demo');
    expect(projected.runtimes).toEqual([
      {
        runtimeId: 'sidecar.echo',
        kind: 'sidecar',
        entry: 'sidecar/echo-runtime.js',
        priority: 100,
        sandbox: 'native',
        bridge: 'pxp.runtime.bridge.v1',
        provides: ['compat.pmpm'],
        dataPlane: { kinds: ['inline-json', 'pipe'] },
      },
    ]);

    const resolution = resolveInstalledExtensionRuntime(
      {
        manifest: projected,
        installedAt: 1_710_000_000_000,
        enabled: true,
        resolvedArtifacts: [
          {
            runtimeId: 'sidecar.echo',
            path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/pmpm-artifacts/sidecar-echo-demo/sidecar/echo-runtime.js',
          },
        ],
      },
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
    expect(resolution.artifact.path).toBe(
      'C:/Users/test/AppData/Roaming/PMP/pmp-durable/pmpm-artifacts/sidecar-echo-demo/sidecar/echo-runtime.js'
    );
  });
});
