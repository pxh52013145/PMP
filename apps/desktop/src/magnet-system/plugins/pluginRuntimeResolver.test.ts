import { describe, expect, it } from 'vitest';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { listPluginRuntimeLaunchers, resolveInstalledExtensionRuntime } from './runtime';

function createRecord(manifest: PxpManifestV2): InstalledExtensionRecord<PxpManifestV2> {
  return {
    manifest,
    installedAt: 1_710_000_000_000,
    enabled: true,
  };
}

function createBaseManifest(overrides: Partial<PxpManifestV2> = {}): PxpManifestV2 {
  return {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: 'demo-plugin',
      publisher: 'pixel-matrix.dev',
      version: '1.0.0',
      name: 'demo-plugin',
    },
    hostTargets: [{ hostId: 'pmp', required: true }],
    runtimes: [
      {
        runtimeId: 'worker.main',
        kind: 'extension-host',
        entry: 'dist/index.js',
        bridge: 'pxp.runtime.bridge.v1',
      },
    ],
    ...overrides,
  };
}

describe('plugin runtime resolver', () => {
  it('exposes the extv2 launcher registry', () => {
    expect(
      listPluginRuntimeLaunchers().map((launcher) => ({
        id: launcher.id,
        availability: launcher.availability,
        surfaceKinds: launcher.surfaceKinds,
      }))
    ).toEqual([
      {
        id: 'pxp.webview.host-frame',
        availability: 'available',
        surfaceKinds: [
          'magnet',
          'settings',
          'page',
          'visualizer',
          'window',
          'overlay',
          'desktop-widget',
        ],
      },
      {
        id: 'pxp.extension-host.worker',
        availability: 'available',
        surfaceKinds: ['command'],
      },
      {
        id: 'pxp.sidecar.native-process',
        availability: 'available',
        surfaceKinds: ['command'],
      },
    ]);
  });

  it('resolves extension-host command runtimes to the worker launcher', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(createBaseManifest()), {
      hostId: 'pmp',
      surfaceKind: 'command',
      preferCommandWorker: true,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('worker.main');
    expect(resolution.launcher.id).toBe('pxp.extension-host.worker');
    expect(resolution.source).toBe('manifest-runtime');
  });

  it('resolves webview page runtimes to the host-frame launcher', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord(
        createBaseManifest({
          runtimes: [
            {
              runtimeId: 'webview.main',
              kind: 'webview',
              entry: 'dist/view.html',
              bridge: 'pxp.runtime.bridge.v1',
            },
          ],
        })
      ),
      {
        hostId: 'pmp',
        surfaceKind: 'page',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('webview.main');
    expect(resolution.launcher.id).toBe('pxp.webview.host-frame');
  });

  it('resolves sidecar command runtimes to the native-process launcher', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord(
        createBaseManifest({
          runtimes: [
            {
              runtimeId: 'sidecar.main',
              kind: 'sidecar',
              entry: 'bin/demo',
              bridge: 'pxp.runtime.bridge.v1',
              dataPlane: { kinds: ['pipe'] },
            },
          ],
        })
      ),
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('sidecar.main');
    expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
  });

  it('prefers the highest-priority launchable runtime', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord(
        createBaseManifest({
          runtimes: [
            {
              runtimeId: 'worker.low',
              kind: 'extension-host',
              entry: 'dist/low.js',
              priority: 10,
            },
            {
              runtimeId: 'worker.high',
              kind: 'extension-host',
              entry: 'dist/high.js',
              priority: 20,
            },
          ],
        })
      ),
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('worker.high');
    expect(resolution.launcher.id).toBe('pxp.extension-host.worker');
  });

  it('blocks runtimes that only match unsupported launchers', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(createBaseManifest()), {
      hostId: 'pmp',
      surfaceKind: 'command',
      supportedLauncherIds: ['pxp.sidecar.native-process'],
    });

    expect(resolution.status).toBe('blocked');
    if (resolution.status !== 'blocked') return;
    expect(resolution.issues).toContain(
      'Runtime "worker.main" only matches unsupported launchers: pxp.extension-host.worker'
    );
  });

  it('blocks runtimes when a required capability is denied by host policy', () => {
    const resolution = resolveInstalledExtensionRuntime(
      {
        ...createRecord(
          createBaseManifest({
            requiresCapabilities: [{ capabilityId: 'core.capability-registry' }],
          })
        ),
        deniedCapabilities: ['core.capability-registry'],
      },
      {
        hostId: 'pmp',
      }
    );

    expect(resolution.status).toBe('blocked');
    if (resolution.status !== 'blocked') return;
    expect(resolution.issues).toEqual([
      'Required capability "core.capability-registry" is currently denied by host policy',
    ]);
  });
});
