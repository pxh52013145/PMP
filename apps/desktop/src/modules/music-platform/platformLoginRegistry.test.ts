import { beforeEach, describe, expect, it, vi } from 'vitest';

const importedInstanceRecordsMock = vi.hoisted(() => ({
  list: [] as Array<{
    instanceId: string;
    installationId: string;
    connectorId: `connector.platform.${string}`;
    platformId: string;
    instanceLabel: string;
    displayName: string;
    createdAtMs: number;
  }>,
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  listPlatformImportedInstanceRecords: () => importedInstanceRecordsMock.list,
}));

function createDefinition(connectorId: `connector.platform.${string}`) {
  return {
    connectorId,
    displayName: 'QQ Music',
    labelKey: 'platform.qqmusic',
    iconKey: 'qqmusic',
    enabled: true,
    authFlow: 'qr' as const,
    workspaceKind: 'qqmusic',
    workspaceMode: 'dedicated' as const,
    sortOrder: 10,
  };
}

describe('platformLoginRegistry', () => {
  beforeEach(() => {
    importedInstanceRecordsMock.list = [];
  });

  it('keeps imported instance entries while instance materialization is still catching up', async () => {
    importedInstanceRecordsMock.list = [
      {
        instanceId: 'qqmusic:imported-a',
        installationId: 'installation-a',
        connectorId: 'connector.platform.qqmusic',
        platformId: 'qqmusic',
        instanceLabel: 'QQ Music',
        displayName: 'QQ Music',
        createdAtMs: 1,
      },
    ];

    const { sanitizePlatformLoginRegistry } = await import('./platformLoginRegistry');
    const entries = sanitizePlatformLoginRegistry(
      [
        {
          instanceId: 'qqmusic:imported-a',
          connectorId: 'connector.platform.qqmusic',
          enabled: true,
          addedAtMs: 123,
        },
      ],
      [createDefinition('connector.platform.qqmusic')],
      null,
      []
    );

    expect(entries).toEqual([
      {
        instanceId: 'qqmusic:imported-a',
        connectorId: 'connector.platform.qqmusic',
        enabled: true,
        addedAtMs: 123,
      },
    ]);
  });

  it('drops stale concrete instance entries when they are neither materialized nor imported', async () => {
    const { sanitizePlatformLoginRegistry } = await import('./platformLoginRegistry');
    const entries = sanitizePlatformLoginRegistry(
      [
        {
          instanceId: 'qqmusic:imported-missing',
          connectorId: 'connector.platform.qqmusic',
          enabled: true,
          addedAtMs: 123,
        },
      ],
      [createDefinition('connector.platform.qqmusic')],
      null,
      []
    );

    expect(entries).toEqual([]);
  });
});
