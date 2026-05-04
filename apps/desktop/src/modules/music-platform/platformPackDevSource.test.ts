import { describe, expect, it } from 'vitest';

import {
  createPlatformPackDevSourceSnapshot,
  inspectPlatformPackDevSourceChanges,
  parsePlatformPackDevSourcePayload,
  type NativePlatformPackDevSourcePayload,
} from './platformPackDevSource';

function createValidPayload(
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
        workspaceKind: 'demo',
        workspaceMode: 'dedicated',
      },
    }),
    runtimePath: 'D:/packs/demo/runtime.js',
    runtimeRaw: 'export function mountPage() { return () => {}; }',
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

describe('platform pack dev source parser', () => {
  it('marks a complete platform pack dev source as ready', () => {
    const source = parsePlatformPackDevSourcePayload(createValidPayload());

    expect(source.status).toBe('ready');
    expect(source.manifest?.metadata.id).toBe('demo-pack');
    expect(source.contract?.extension?.connectorId).toBe('connector.platform.demo');
    expect(source.runtimeRaw).toContain('mountPage');
    expect(source.iconRawBase64).toBe('PHN2Zz48L3N2Zz4=');
    expect(source.diagnostics).toEqual([]);
  });

  it('reports contract connector mismatches before the source is attached', () => {
    const source = parsePlatformPackDevSourcePayload(
      createValidPayload({
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
          capabilities: {},
          apiBindings: {
            auth: 'host.pmp.connector-auth',
          },
          extension: {
            connectorId: 'connector.platform.other',
          },
        }),
      })
    );

    expect(source.status).toBe('error');
    expect(source.contract).toBeNull();
    expect(source.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'contract.invalid'
    );
  });

  it('classifies runtime-only changes as auto reloadable', () => {
    const previous = createPlatformPackDevSourceSnapshot(
      parsePlatformPackDevSourcePayload(createValidPayload())
    );
    const current = createPlatformPackDevSourceSnapshot(
      parsePlatformPackDevSourcePayload(
        createValidPayload({
          runtimeRaw: 'export const changed = true;',
          runtimeModifiedAtMs: 200,
        })
      )
    );

    const change = inspectPlatformPackDevSourceChanges(previous, current);

    expect(change.changeKind).toBe('runtime-only');
    expect(change.changedFiles).toEqual(['runtime']);
    expect(change.canAutoReload).toBe(true);
    expect(change.requiresConfirmation).toBe(false);
  });

  it('classifies manifest changes as confirmation-gated', () => {
    const previous = createPlatformPackDevSourceSnapshot(
      parsePlatformPackDevSourcePayload(createValidPayload())
    );
    const current = createPlatformPackDevSourceSnapshot(
      parsePlatformPackDevSourcePayload(
        createValidPayload({
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
        })
      )
    );

    const change = inspectPlatformPackDevSourceChanges(previous, current);

    expect(change.changeKind).toBe('manifest-contract');
    expect(change.changedFiles).toEqual(['manifest']);
    expect(change.canAutoReload).toBe(false);
    expect(change.requiresConfirmation).toBe(true);
  });
});
