import { describe, expect, it } from 'vitest';
import type { PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import {
  assertInstalledExtensionActivationAllowed,
  buildInstalledExtensionActivationViewId,
  hasInstalledExtensionStartupActivation,
  isInstalledExtensionActivationAllowed,
} from './activationEvents';

const BASE_MANIFEST: PxpManifestV2 = {
  schemaVersion: '2.0',
  kind: 'extension',
  identity: {
    id: 'demo-plugin',
    publisher: 'pixel-matrix.dev',
    version: '0.1.0',
    name: 'demo-plugin',
  },
  hostTargets: [{ hostId: 'pmp', required: true }],
  runtimes: [
    {
      runtimeId: 'worker.main',
      kind: 'extension-host',
      entry: 'index.js',
    },
  ],
};

describe('installed extension activation events', () => {
  it('allows all triggers when activation events are omitted', () => {
    expect(
      isInstalledExtensionActivationAllowed(BASE_MANIFEST, {
        cause: 'command',
        commandId: 'increment',
      })
    ).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(BASE_MANIFEST, {
        cause: 'view',
        viewId: 'demo-page',
      })
    ).toBe(true);
  });

  it('matches exact command and view activation events', () => {
    const manifest: PxpManifestV2 = {
      ...BASE_MANIFEST,
      activationEvents: ['onCommand:increment', 'onView:demo-page'],
    };

    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'command',
        commandId: 'increment',
      })
    ).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'view',
        viewId: 'demo-page',
      })
    ).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'command',
        commandId: 'reset',
      })
    ).toBe(false);
  });

  it('treats onStartup as a global activation trigger and detects startup auto-activation', () => {
    const manifest: PxpManifestV2 = {
      ...BASE_MANIFEST,
      activationEvents: ['onStartup'],
    };

    expect(hasInstalledExtensionStartupActivation(manifest)).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'startup',
      })
    ).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'command',
        commandId: 'increment',
      })
    ).toBe(true);
  });

  it('supports wildcard command and view activation events', () => {
    const manifest: PxpManifestV2 = {
      ...BASE_MANIFEST,
      activationEvents: ['onCommand:*', 'onView:*'],
    };

    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'command',
        commandId: 'anything',
      })
    ).toBe(true);
    expect(
      isInstalledExtensionActivationAllowed(manifest, {
        cause: 'view',
        viewId: 'whatever',
      })
    ).toBe(true);
  });

  it('maps magnet activation onto the plugin id and throws helpful errors when blocked', () => {
    const manifest: PxpManifestV2 = {
      ...BASE_MANIFEST,
      activationEvents: ['onView:view-surface-demo'],
      identity: {
        ...BASE_MANIFEST.identity,
        id: 'view-surface-demo',
      },
    };

    expect(
      buildInstalledExtensionActivationViewId({
        pluginId: 'view-surface-demo',
        surfaceKind: 'magnet',
      })
    ).toBe('view-surface-demo');

    expect(() =>
      assertInstalledExtensionActivationAllowed(manifest, {
        cause: 'view',
        viewId: 'demo-page',
      })
    ).toThrowError(
      'Extension "view-surface-demo" does not declare activation event "onView:demo-page"'
    );
  });
});
