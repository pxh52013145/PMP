import { describe, expect, it } from 'vitest';

import {
  parsePlatformCompatContractFromJson,
  validatePlatformCompatContract,
} from './platformCompatContractSchema';

function createContractJson() {
  return {
    contractVersion: '1.0',
    platform: {
      platformId: 'netease',
      displayName: 'Netease',
      staticIcon: 'icon.svg',
      supportsMultiInstance: false,
    },
    auth: {
      loginMode: 'qr',
      requiresCookie: false,
      requiresAccountId: false,
      supportsRefresh: true,
    },
    capabilities: {
      playlists: true,
      favorites: false,
      dailyRecommendations: true,
      search: true,
      quality: true,
      navigation: false,
      settings: false,
      pages: true,
    },
    apiBindings: {
      auth: 'host.pmp.connector-auth',
      library: 'host.pmp.platform-instance.library',
      recommendations: 'host.pmp.platform-instance.recommendations',
      search: 'host.pmp.platform-instance.search',
      quality: 'host.pmp.platform-instance.quality',
      pages: 'host.pmp.platform-instance.pages',
    },
    workspace: {
      ownership: 'pack',
      requiredRuntimeCarrier: 'webview-frame',
      root: {
        viewId: 'netease.workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      shellSlots: [
        {
          slotId: 'workspace.shell.search',
          viewId: 'netease.workspace.search',
        },
      ],
      capabilityFamilies: {
        required: ['host.pmp.navigation', 'host.pmp.connector-auth'],
        optional: ['host.pmp.telemetry'],
      },
      context: {
        scope: 'platform-instance',
        fields: ['connectorId', 'instanceId', 'grantedCapabilityFamilies'],
      },
    },
    extension: {
      connectorId: 'connector.platform.netease',
      workspaceKind: 'netease',
      workspaceMode: 'dedicated',
    },
  };
}

describe('platformCompatContractSchema workspace contract', () => {
  it('parses and validates declarative pack-owned workspace descriptors', () => {
    const contract = parsePlatformCompatContractFromJson(
      createContractJson(),
      'test:netease-contract'
    );

    validatePlatformCompatContract(contract, 'test:netease-contract', {
      connectorId: 'connector.platform.netease',
      workspaceKind: 'netease',
      workspaceMode: 'dedicated',
    });

    expect(contract.workspace).toEqual({
      ownership: 'pack',
      requiredRuntimeCarrier: 'webview-frame',
      root: {
        viewId: 'netease.workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      shellSlots: [
        {
          slotId: 'workspace.shell.search',
          viewId: 'netease.workspace.search',
          viewType: undefined,
        },
      ],
      capabilityFamilies: {
        required: ['host.pmp.navigation', 'host.pmp.connector-auth'],
        optional: ['host.pmp.telemetry'],
      },
      context: {
        scope: 'platform-instance',
        fields: ['connectorId', 'instanceId', 'grantedCapabilityFamilies'],
      },
    });
  });

  it('rejects pack-owned workspace contracts that declare no mount surfaces', () => {
    const contract = parsePlatformCompatContractFromJson(
      {
        ...createContractJson(),
        workspace: {
          ownership: 'pack',
        },
      },
      'test:invalid-workspace'
    );

    expect(() =>
      validatePlatformCompatContract(contract, 'test:invalid-workspace')
    ).toThrow(/workspace\.ownership=pack requires workspace\.root or workspace\.shellSlots/i);
  });
});
