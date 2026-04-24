import { describe, expect, it } from 'vitest';

import {
  createParsedPlatformPackFromDevSource,
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
      },
      auth: {
        loginMode: 'none',
      },
      capabilities: {},
      apiBindings: {
        auth: 'auth',
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
    iconPath: 'D:/packs/demo/icon.svg',
    iconRawBase64: 'PHN2Zz48L3N2Zz4=',
    iconExists: true,
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
          },
          auth: {
            loginMode: 'none',
          },
          capabilities: {},
          apiBindings: {
            auth: 'auth',
          },
          extension: {
            connectorId: 'connector.platform.other',
            workspaceKind: 'demo',
            workspaceMode: 'dedicated',
          },
        }),
      })
    );

    expect(source.status).toBe('error');
    expect(source.contract).toBeNull();
    expect(source.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'contract.connector-mismatch'
    );
  });

  it('keeps native artifact diagnostics in the combined result', () => {
    const source = parsePlatformPackDevSourcePayload(
      createValidPayload({
        runtimeExists: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'runtime.entry.missing',
            message: 'Runtime entry is missing: runtime.js',
          },
        ],
      })
    );

    expect(source.status).toBe('error');
    expect(source.runtimeExists).toBe(false);
    expect(source.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'runtime.entry.missing',
        message: 'Runtime entry is missing: runtime.js',
      },
    ]);
  });

  it('builds a parsed platform pack from a ready dev source', () => {
    const source = parsePlatformPackDevSourcePayload(createValidPayload());
    const pack = createParsedPlatformPackFromDevSource(source);

    expect(pack.runtimeCode).toContain('mountPage');
    expect(pack.iconAssetUrl).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    expect(pack.workspace).toBeNull();
  });
});
