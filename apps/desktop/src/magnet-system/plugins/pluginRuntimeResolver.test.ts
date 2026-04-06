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
        surfaceKinds: ['magnet', 'settings', 'page', 'visualizer', 'window', 'command'],
      },
      {
        id: 'compat.pmpm.webview-sandbox',
        availability: 'available',
        surfaceKinds: ['magnet', 'settings', 'page', 'visualizer', 'window', 'command'],
      },
      {
        id: 'pxp.webview.host-frame',
        availability: 'planned',
        surfaceKinds: ['magnet', 'settings', 'page', 'visualizer', 'window'],
      },
      {
        id: 'pxp.extension-host.worker',
        availability: 'available',
        surfaceKinds: ['command'],
      },
      {
        id: 'pxp.sidecar.native-process',
        availability: 'planned',
        surfaceKinds: ['command'],
      },
    ]);
  });

  it('resolves compat runtimes to the inline launcher by default', () => {
    const resolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferCompatSandbox: false,
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
      preferCompatSandbox: true,
    });

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.launcher.id).toBe('compat.pmpm.webview-sandbox');
  });

  it('maps resolved runtimes onto Phase 1 launcher adapters', () => {
    const inlineResolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferCompatSandbox: false,
    });
    const sandboxResolution = resolveInstalledExtensionRuntime(createRecord(COMPAT_MANIFEST), {
      hostId: 'pmp',
      preferCompatSandbox: true,
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

  it('falls back from an unavailable higher-priority runtime to a lower-priority compat runtime', () => {
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
    expect(resolution.runtime.runtimeId).toBe('compat.pmpm.main');
    expect(resolution.launcher.id).toBe('compat.pmpm.inline-module');
    expect(resolution.issues).toContain(
      'Runtime "future-sidecar" only matches planned launchers: pxp.sidecar.native-process'
    );
  });

  it('returns a blocked resolution when only planned generic launchers are available', () => {
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

    expect(resolution.status).toBe('blocked');
    if (resolution.status !== 'blocked') return;
    expect(resolution.candidateLaunchers.map((launcher) => launcher.id)).toEqual([
      'pxp.webview.host-frame',
    ]);
    expect(getResolvedPmpmLauncherAdapter(resolution)).toBeNull();
    expect(getResolvedPmpmLauncherAdapterError(resolution)).toContain(
      'Runtime "future-webview" only matches planned launchers: pxp.webview.host-frame'
    );
  });
});
