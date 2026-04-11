import { describe, expect, it } from 'vitest';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import {
  getResolvedPmpmLauncherAdapter,
  getResolvedPmpmLauncherAdapterError,
  listPluginRuntimeLaunchers,
  resolveInstalledExtensionRuntime,
} from './runtime';

function createRecord(manifest: PxpManifestV2): InstalledExtensionRecord<PxpManifestV2> {
  return {
    manifest,
    installedAt: 1_710_000_000_000,
    enabled: true,
  };
}

const COMPAT_MANIFEST: PxpManifestV2 = {
  schemaVersion: '2.0',
  kind: 'extension',
  identity: {
    id: 'demo-plugin',
    publisher: 'compat.pmpm',
    version: '1.0.0',
    name: 'demo-plugin',
  },
  hostTargets: [{ hostId: 'pmp', required: true }],
  runtimes: [
    {
      runtimeId: 'compat.pmpm.main',
      kind: 'extension-host',
      entry: 'dist/index.js',
      bridge: 'compat.pmpm.bridge',
      provides: ['compat.pmpm'],
      dataPlane: { kinds: ['inline-json'] },
    },
  ],
  compat: [{ compatLayerId: 'compat.pmpm' }],
};

describe('plugin runtime resolver', () => {
  it('exposes the Phase 1 launcher registry skeleton', () => {
    expect(
      listPluginRuntimeLaunchers().map((launcher) => ({
        id: launcher.id,
        availability: launcher.availability,
        surfaceKinds: launcher.surfaceKinds,
      }))
    ).toEqual([
      {
        id: 'compat.pmpm.inline-module',
        availability: 'available',
        surfaceKinds: [
          'magnet',
          'settings',
          'page',
          'visualizer',
          'window',
          'overlay',
          'desktop-widget',
          'command',
        ],
      },
      {
        id: 'compat.pmpm.webview-sandbox',
        availability: 'available',
        surfaceKinds: [
          'magnet',
          'settings',
          'page',
          'visualizer',
          'window',
          'overlay',
          'desktop-widget',
          'command',
        ],
      },
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

  it('resolves compat runtimes to the inline launcher by default', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferSandboxLauncher: false,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('compat.pmpm.main');
    expect(resolution.launcher.id).toBe('compat.pmpm.inline-module');
    expect(resolution.source).toBe('compat-runtime');
  });

  it('resolves compat runtimes to the sandbox launcher when sandbox is preferred', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferSandboxLauncher: true,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.launcher.id).toBe('compat.pmpm.webview-sandbox');
  });

  it('maps resolved runtimes onto Phase 1 launcher adapters', () => {
    const inlineResolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferSandboxLauncher: false,
    });
    const sandboxResolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferSandboxLauncher: true,
    });

    const inlineAdapter = getResolvedPmpmLauncherAdapter(inlineResolution);
    const sandboxAdapter = getResolvedPmpmLauncherAdapter(sandboxResolution);

    expect(inlineAdapter?.mode).toBe('inline');
    expect(inlineAdapter?.launcherId).toBe('compat.pmpm.inline-module');
    expect(sandboxAdapter?.mode).toBe('sandbox');
    expect(sandboxAdapter?.launcherId).toBe('compat.pmpm.webview-sandbox');
  });

  it('prefers the dedicated worker launcher for command surfaces when requested', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      surfaceKind: 'command',
      preferCommandWorker: true,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.launcher.id).toBe('pxp.extension-host.worker');

    const workerAdapter = getResolvedPmpmLauncherAdapter(resolution);
    expect(workerAdapter?.mode).toBe('worker');
    expect(workerAdapter?.launcherId).toBe('pxp.extension-host.worker');
  });

  it('keeps view surfaces on compat launchers even when command worker is preferred', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      surfaceKind: 'magnet',
      preferCommandWorker: true,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.launcher.id).toBe('compat.pmpm.inline-module');
  });

  it('prefers manifest-native webview launchers over compat webview launchers when both are available', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord({
        ...COMPAT_MANIFEST,
        runtimes: [
          {
            runtimeId: 'hybrid-webview',
            kind: 'webview',
            entry: 'dist/hybrid.html',
            bridge: 'pxp.runtime.bridge.v1',
            provides: ['compat.pmpm'],
            priority: 20,
          },
        ],
      }),
      {
        hostId: 'pmp',
        surfaceKind: 'page',
        preferSandboxLauncher: true,
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('hybrid-webview');
    expect(resolution.launcher.id).toBe('pxp.webview.host-frame');
    expect(resolution.source).toBe('manifest-runtime');
  });

  it('prefers an available higher-priority sidecar runtime over a lower-priority compat runtime', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord({
        ...COMPAT_MANIFEST,
        runtimes: [
          {
            runtimeId: 'future-sidecar',
            kind: 'sidecar',
            entry: 'bin/demo',
            priority: 100,
          },
          {
            runtimeId: 'compat.pmpm.main',
            kind: 'extension-host',
            entry: 'dist/index.js',
            priority: 10,
            bridge: 'compat.pmpm.bridge',
            provides: ['compat.pmpm'],
            dataPlane: { kinds: ['inline-json'] },
          },
        ],
      }),
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('future-sidecar');
    expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
    expect(resolution.issues).toEqual([]);
  });

  it('resolves sidecar command runtimes to the native-process launcher', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord({
        ...COMPAT_MANIFEST,
        compat: undefined,
        runtimes: [
          {
            runtimeId: 'demo-sidecar',
            kind: 'sidecar',
            entry: 'bin/demo-sidecar',
            bridge: 'pxp.runtime.bridge.v1',
            adapter: {
              kind: 'native-sidecar.process',
              protocol: 'pxp.runtime.bridge.v1',
              implementation: {
                language: 'rust',
                runtime: 'cargo',
              },
            },
            dataPlane: { kinds: ['pipe'] },
            priority: 20,
          },
        ],
      }),
      {
        hostId: 'pmp',
        surfaceKind: 'command',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('demo-sidecar');
    expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
    expect(resolution.source).toBe('manifest-runtime');
    expect(resolution.runtime.adapter).toMatchObject({
      kind: 'native-sidecar.process',
      protocol: 'pxp.runtime.bridge.v1',
      implementation: {
        language: 'rust',
        runtime: 'cargo',
      },
    });
  });

  it('blocks runtimes that only match launchers unsupported by the current host path', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      surfaceKind: 'command',
      preferCommandWorker: true,
      supportedLauncherIds: ['pxp.sidecar.native-process'],
    });

    expect(resolution.status).toBe('blocked');
    if (resolution.status !== 'blocked') return;
    expect(resolution.issues).toContain(
      'Runtime "compat.pmpm.main" only matches unsupported launchers: pxp.extension-host.worker, compat.pmpm.inline-module, compat.pmpm.webview-sandbox'
    );
  });

  it('blocks runtimes when a required capability is denied by host policy', () => {
    const resolution = resolveInstalledExtensionRuntime(
      {
        ...createRecord({
          ...COMPAT_MANIFEST,
          requiresCapabilities: [{ capabilityId: 'core.capability-registry' }],
        }),
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

  it('resolves webview view runtimes onto the host-frame launcher', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord({
        ...COMPAT_MANIFEST,
        compat: undefined,
        runtimes: [
          {
            runtimeId: 'future-webview',
            kind: 'webview',
            entry: 'dist/webview.js',
            priority: 10,
          },
        ],
      }),
      {
        hostId: 'pmp',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('future-webview');
    expect(resolution.launcher.id).toBe('pxp.webview.host-frame');
    expect(resolution.source).toBe('manifest-runtime');
    expect(getResolvedPmpmLauncherAdapter(resolution)).toBeNull();
    expect(getResolvedPmpmLauncherAdapterError(resolution)).toContain(
      'Resolved runtime launcher is not wired: pxp.webview.host-frame'
    );
  });

  it('resolves overlay shell surfaces onto the same long-lived view launcher path', () => {
    const resolution = resolveInstalledExtensionRuntime(
      createRecord({
        ...COMPAT_MANIFEST,
        compat: undefined,
        runtimes: [
          {
            runtimeId: 'future-overlay-webview',
            kind: 'webview',
            entry: 'dist/overlay.html',
            priority: 10,
          },
        ],
      }),
      {
        hostId: 'pmp',
        surfaceKind: 'overlay',
      }
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.runtime.runtimeId).toBe('future-overlay-webview');
    expect(resolution.launcher.id).toBe('pxp.webview.host-frame');
    expect(resolution.source).toBe('manifest-runtime');
  });
});
