import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformPackDevInstanceBindingRecord } from './platformPackDevBinding';
import {
  parsePlatformPackDevSourcePayload,
  type NativePlatformPackDevSourcePayload,
  type PlatformPackDevSource,
} from './platformPackDevSource';
import {
  getPlatformPackDevWatcher,
  runPlatformPackDevWatcherPass,
  setPlatformPackDevWatcherEnabled,
} from './platformPackDevWatcher';

function createPayload(
  overrides: Partial<NativePlatformPackDevSourcePayload> = {}
): NativePlatformPackDevSourcePayload {
  return {
    rootDir: 'D:/packs/demo',
    manifestPath: 'D:/packs/demo/manifest.json',
    manifestRaw: JSON.stringify({
      formatVersion: '1.0',
      type: 'platform-pack',
      metadata: {
        id: 'demo-pack',
        name: 'Demo',
        version: '0.1.0',
      },
      connector: {
        connectorId: 'connector.platform.demo',
        workspaceKind: 'demo',
        workspaceMode: 'dedicated',
      },
      entry: {
        contract: 'contract.json',
        runtime: 'runtime.js',
        icon: 'icon.svg',
      },
    }),
    contractPath: 'D:/packs/demo/contract.json',
    contractRaw: JSON.stringify({
      contractVersion: '1.0',
      platform: {
        platformId: 'demo',
        displayName: 'Demo',
        staticIcon: 'demo',
        supportsMultiInstance: false,
      },
      auth: {
        loginMode: 'none',
        requiresCookie: false,
        requiresAccountId: false,
        supportsRefresh: false,
      },
      capabilities: {
        playlists: false,
        favorites: false,
        dailyRecommendations: false,
        search: false,
        quality: false,
        navigation: false,
        settings: false,
        pages: true,
      },
      apiBindings: {
        auth: 'host.pmp.connector-auth',
      },
      extension: {
        connectorId: 'connector.platform.demo',
      },
    }),
    runtimePath: 'D:/packs/demo/runtime.js',
    runtimeRaw: 'export const visible = "v1";',
    runtimeExists: true,
    runtimeModifiedAtMs: 100,
    iconPath: 'D:/packs/demo/icon.svg',
    iconRawBase64: 'PHN2Zz48L3N2Zz4=',
    iconExists: true,
    iconModifiedAtMs: 100,
    diagnostics: [],
    ...overrides,
  };
}

function createSource(
  overrides: Partial<NativePlatformPackDevSourcePayload> = {}
): PlatformPackDevSource {
  return parsePlatformPackDevSourcePayload(createPayload(overrides));
}

function createBinding(
  overrides: Partial<PlatformPackDevInstanceBindingRecord> = {}
): PlatformPackDevInstanceBindingRecord {
  return {
    instanceId: 'demo:dev-test',
    connectorId: 'connector.platform.demo',
    installationId: 'dev-demo-pack-test',
    rootDir: 'D:/packs/demo',
    displayName: 'Demo',
    packId: 'demo-pack',
    packVersion: '0.1.0',
    platformId: 'demo',
    manifestPath: 'D:/packs/demo/manifest.json',
    contractPath: 'D:/packs/demo/contract.json',
    runtimePath: 'D:/packs/demo/runtime.js',
    iconPath: 'D:/packs/demo/icon.svg',
    sidecarPath: null,
    status: 'bound',
    revision: 1,
    updatedAt: 100,
    reloadHistory: [],
    lastError: null,
    ...overrides,
  };
}

describe('platform pack dev watcher', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('captures a baseline without reloading on first pass', async () => {
    const binding = createBinding();
    const source = createSource();
    const reloadBinding = vi.fn();
    setPlatformPackDevWatcherEnabled(binding, true);

    const result = await runPlatformPackDevWatcherPass(binding, {
      now: () => 1000,
      readSource: async () => source,
      reloadBinding,
    });

    expect(result.action).toBe('baseline');
    expect(reloadBinding).not.toHaveBeenCalled();
    expect(getPlatformPackDevWatcher(binding.instanceId)).toMatchObject({
      status: 'watching',
      pendingReload: null,
    });
  });

  it('auto reloads runtime-only changes after dry-run validation', async () => {
    const binding = createBinding();
    const source = createSource();
    const runtimeChanged = createSource({
      runtimeRaw: 'export const visible = "v2";',
      runtimeModifiedAtMs: 200,
    });
    const reloadedRecord = createBinding({ revision: 2 });
    const reloadBinding = vi.fn(async () => ({
      record: reloadedRecord,
      source: runtimeChanged,
    }));
    setPlatformPackDevWatcherEnabled(binding, true);
    await runPlatformPackDevWatcherPass(binding, {
      now: () => 1000,
      readSource: async () => source,
      reloadBinding,
    });

    const result = await runPlatformPackDevWatcherPass(binding, {
      now: () => 2000,
      readSource: async () => runtimeChanged,
      reloadBinding,
    });

    expect(result.action).toBe('auto-reloaded');
    expect(reloadBinding).toHaveBeenCalledWith(binding);
    expect(getPlatformPackDevWatcher(binding.instanceId)?.lastAutoReload).toMatchObject({
      status: 'success',
      changeKind: 'runtime-only',
      revision: 2,
    });
  });

  it('leaves manifest changes pending for confirmation', async () => {
    const binding = createBinding();
    const source = createSource();
    const manifestChanged = createSource({
      manifestRaw: JSON.stringify({
        formatVersion: '1.0',
        type: 'platform-pack',
        metadata: {
          id: 'demo-pack',
          name: 'Demo',
          version: '0.2.0',
        },
        connector: {
          connectorId: 'connector.platform.demo',
          workspaceKind: 'demo',
          workspaceMode: 'dedicated',
        },
        entry: {
          contract: 'contract.json',
          runtime: 'runtime.js',
          icon: 'icon.svg',
        },
      }),
    });
    const reloadBinding = vi.fn();
    setPlatformPackDevWatcherEnabled(binding, true);
    await runPlatformPackDevWatcherPass(binding, {
      now: () => 1000,
      readSource: async () => source,
      reloadBinding,
    });

    const result = await runPlatformPackDevWatcherPass(binding, {
      now: () => 2000,
      readSource: async () => manifestChanged,
      reloadBinding,
    });

    expect(result.action).toBe('pending');
    expect(reloadBinding).not.toHaveBeenCalled();
    expect(getPlatformPackDevWatcher(binding.instanceId)?.pendingReload).toMatchObject({
      changeKind: 'manifest-contract',
      changedFiles: ['manifest'],
    });
  });

  it('records validation failures through reload history handoff', async () => {
    const binding = createBinding();
    const source = createSource();
    const invalidRuntime = createSource({
      runtimeRaw: '',
      runtimeModifiedAtMs: 200,
    });
    const recordReloadFailure = vi.fn();
    setPlatformPackDevWatcherEnabled(binding, true);
    await runPlatformPackDevWatcherPass(binding, {
      now: () => 1000,
      readSource: async () => source,
      recordReloadFailure,
    });

    const result = await runPlatformPackDevWatcherPass(binding, {
      now: () => 2000,
      readSource: async () => invalidRuntime,
      recordReloadFailure,
    });

    expect(result.action).toBe('validation-error');
    expect(recordReloadFailure).toHaveBeenCalledWith(
      binding,
      expect.stringContaining('Runtime entry is empty'),
      { revision: 2 }
    );
    expect(getPlatformPackDevWatcher(binding.instanceId)).toMatchObject({
      status: 'error',
      pendingReload: expect.objectContaining({ changeKind: 'runtime-only' }),
    });
  });
});
