import { describe, expect, it } from 'vitest';
import {
  convertInstalledPmpmPluginToInstalledExtensionRecord,
  convertPmpmManifestToPxpManifestV2,
  mapLegacyFoundationCapabilityId,
  mapPmpmBridgeEventToRuntimeOp,
  mapPmpmPermissionToCapabilityId,
  normalizePmpmEntryPoint,
  validatePmpmManifest,
  type PmpmManifest,
} from '@pixel-matrix/plugin-platform-contracts';

const SAMPLE_PMPM_MANIFEST: PmpmManifest = {
  formatVersion: '1.0',
  type: 'magnet-plugin',
  metadata: {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    version: '1.2.3',
    description: 'Compat bridge sample',
    tags: ['demo', 'compat'],
  },
  entryPoint: 'dist/index.js',
  permissions: ['api:navigation', 'api:audio-control', 'storage:local'],
  contributions: {
    pages: [
      {
        kind: 'page',
        id: 'demo-page',
        title: 'Demo Page',
      },
    ],
    windows: [
      {
        kind: 'window',
        id: 'demo-window',
        title: 'Demo Window',
        width: 640,
        height: 360,
      },
    ],
    shellSurfaces: [
      {
        kind: 'shell-surface',
        id: 'demo-overlay',
        title: 'Demo Overlay',
        surfaceType: 'overlay',
        width: 480,
        height: 320,
        pointerPolicy: 'capture-input',
        dismissOnEscape: true,
      },
      {
        kind: 'shell-surface',
        id: 'demo-widget',
        title: 'Demo Widget',
        surfaceType: 'desktop-widget',
        width: 320,
        height: 240,
        pointerPolicy: 'passthrough',
      },
    ],
    commands: [
      {
        kind: 'command',
        id: 'refresh-library',
        title: 'Refresh Library',
      },
    ],
    settingsPanels: [
      {
        kind: 'settings-panel',
        id: 'demo-settings',
        title: 'Demo Settings',
      },
    ],
    visualizers: [
      {
        kind: 'visualizer',
        id: 'spectrum-view',
        title: 'Spectrum View',
        inputs: ['post-dsp'],
      },
    ],
  },
  magnet: {
    defaultVariant: 'compact',
    variants: [
      {
        id: 'compact',
        label: 'Compact',
      },
    ],
  },
};

describe('plugin compat pmpm', () => {
  it('validates v1 manifests and rejects reserved ids', () => {
    expect(() => validatePmpmManifest(SAMPLE_PMPM_MANIFEST)).not.toThrow();
    expect(() => normalizePmpmEntryPoint('../escape.js')).toThrow('path segments');

    expect(() =>
      validatePmpmManifest(SAMPLE_PMPM_MANIFEST, {
        reservedIds: new Set(['demo-plugin']),
      })
    ).toThrow('reserved ids');
  });

  it('converts a PMPM manifest into the phase-1 v2 compat shape', () => {
    const converted = convertPmpmManifestToPxpManifestV2(SAMPLE_PMPM_MANIFEST);

    expect(converted.schemaVersion).toBe('2.0');
    expect(converted.kind).toBe('extension');
    expect(converted.identity.id).toBe('demo-plugin');
    expect(converted.identity.displayName).toBe('Demo Plugin');
    expect(converted.hostTargets).toEqual([{ hostId: 'pmp', required: true }]);
    expect(converted.runtimes[0]).toMatchObject({
      runtimeId: 'compat.pmpm.main',
      kind: 'extension-host',
      entry: 'dist/index.js',
      bridge: 'compat.pmpm.bridge',
    });
    expect(converted.requiresCapabilities?.map((item) => item.capabilityId)).toEqual(
      expect.arrayContaining([
        'host.pmp.navigation',
        'host.pmp.audio-engine.playback',
        'host.pmp.storage.config',
      ])
    );
    expect(converted.contributes?.core?.commands?.[0]).toMatchObject({
      kind: 'command',
      id: 'refresh-library',
    });
    expect((converted.contributes?.host as { pmp?: unknown })?.pmp).toMatchObject({
      pages: [{ id: 'demo-page' }],
      shellSurfaces: [
        { id: 'demo-overlay', surfaceType: 'overlay' },
        { id: 'demo-widget', surfaceType: 'desktop-widget' },
      ],
      magnets: { defaultVariant: 'compact' },
    });
    expect(converted.compat?.[0]).toMatchObject({
      compatLayerId: 'compat.pmpm',
    });
  });

  it('rejects invalid shell surface descriptors in compat manifests', () => {
    expect(() =>
      validatePmpmManifest({
        ...SAMPLE_PMPM_MANIFEST,
        contributions: {
          ...SAMPLE_PMPM_MANIFEST.contributions,
          shellSurfaces: [
            {
              kind: 'shell-surface',
              id: 'bad-shell',
              title: 'Bad Shell',
              surfaceType: 'overlay',
              pointerPolicy: 'hover-only',
            },
          ],
        },
      })
    ).toThrow(
      'manifest.contributions.shellSurfaces["bad-shell"].pointerPolicy must be "capture-input" or "passthrough"'
    );
  });

  it('projects sidecar-oriented PMPM runtimes into manifest-v2 native-process metadata', () => {
    const converted = convertPmpmManifestToPxpManifestV2({
      ...SAMPLE_PMPM_MANIFEST,
      entryPoint: 'sidecar/echo-runtime.js',
      runtime: {
        runtimeId: 'demo-sidecar',
        kind: 'sidecar',
        bridge: 'pxp.runtime.bridge.v1',
        adapter: {
          kind: 'native-sidecar.process',
          protocol: 'pxp.runtime.bridge.v1',
          implementation: {
            language: 'rust',
            runtime: 'cargo',
          },
          trust: {
            minimumLevel: 'verified',
            requiresSignature: true,
          },
        },
        sandbox: 'native',
        priority: 50,
        dataPlane: {
          kinds: ['pipe'],
        },
      },
    });

    expect(converted.runtimes).toHaveLength(1);
    expect(converted.runtimes[0]).toMatchObject({
      runtimeId: 'demo-sidecar',
      kind: 'sidecar',
      entry: 'sidecar/echo-runtime.js',
      priority: 50,
      sandbox: 'native',
      bridge: 'pxp.runtime.bridge.v1',
      adapter: {
        kind: 'native-sidecar.process',
        protocol: 'pxp.runtime.bridge.v1',
        implementation: {
          language: 'rust',
          runtime: 'cargo',
        },
        trust: {
          minimumLevel: 'verified',
          requiresSignature: true,
        },
      },
      provides: ['compat.pmpm'],
      dataPlane: { kinds: ['pipe'] },
    });
  });

  it('defaults sidecar adapter metadata when compat manifests omit the explicit adapter block', () => {
    const converted = convertPmpmManifestToPxpManifestV2({
      ...SAMPLE_PMPM_MANIFEST,
      entryPoint: 'sidecar/default-runtime',
      runtime: {
        runtimeId: 'default-sidecar',
        kind: 'sidecar',
      },
    });

    expect(converted.runtimes[0]?.adapter).toEqual({
      kind: 'native-sidecar.process',
      protocol: 'pxp.runtime.bridge.v1',
      trust: {
        minimumLevel: 'trusted',
        requiresDigest: true,
        requiresSignature: false,
      },
      lifecycle: {
        phases: ['hello', 'init', 'activate', 'health', 'invoke', 'revoke', 'dispose'],
        quarantineOnTimeout: true,
        supportsGracefulShutdown: true,
      },
    });
  });

  it('rejects adapter metadata on non-sidecar compat runtimes', () => {
    expect(() =>
      validatePmpmManifest({
        ...SAMPLE_PMPM_MANIFEST,
        runtime: {
          runtimeId: 'bad-webview',
          kind: 'webview',
          adapter: {
            kind: 'native-sidecar.process',
            protocol: 'pxp.runtime.bridge.v1',
          },
        },
      })
    ).toThrow('manifest.runtime.adapter is only supported for sidecar runtimes');
  });

  it('keeps install state out of the raw manifest and maps legacy ids', () => {
    const installed = convertInstalledPmpmPluginToInstalledExtensionRecord({
      manifest: SAMPLE_PMPM_MANIFEST,
      installedAt: 1_710_000_000_000,
      packageSha256: 'pkg-digest',
      manifestSha256: 'manifest-digest',
      entrySha256: 'entry-digest',
      signature: {
        verified: true,
        keyId: 'dev-key',
        summary: 'trusted',
      },
      enabled: false,
      disabledReason: 'manual',
      deniedPermissions: ['api:navigation'],
      lastError: 'boom',
      lastErrorAt: 1_710_000_000_123,
    });

    expect(installed.enabled).toBe(false);
    expect(installed.disabledReason).toBe('manual');
    expect(installed.deniedCapabilities).toEqual(['host.pmp.navigation']);
    expect(installed.packageDigest).toBe('pkg-digest');
    expect(installed.manifest.integrity?.manifestDigest).toBe('manifest-digest');
    expect(installed.signature).toEqual({
      verified: true,
      keyId: 'dev-key',
      summary: 'trusted',
    });

    expect(mapLegacyFoundationCapabilityId('foundation.audio-input-adapter')).toBe(
      'host.pmp.audio-engine.input'
    );
    expect(mapPmpmPermissionToCapabilityId('api:music-platform-search')).toBe(
      'host.pmp.music-platform.search'
    );
    expect(mapPmpmPermissionToCapabilityId('api:connector-auth')).toBe('host.pmp.connector-auth');
    expect(mapPmpmPermissionToCapabilityId('api:magnets-catalog')).toBe('host.pmp.magnets.catalog');
    expect(mapPmpmPermissionToCapabilityId('api:magnets-layout')).toBe('host.pmp.magnets.layout');
    expect(mapPmpmPermissionToCapabilityId('storage:durable-text')).toBe(
      'host.pmp.storage.durable-text'
    );
    expect(mapPmpmBridgeEventToRuntimeOp('pmpm:init')).toBe('runtime.init');
    expect(mapPmpmBridgeEventToRuntimeOp('pmpm:rpc')).toBe('capability.invoke.request');
  });
});
