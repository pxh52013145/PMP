import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  siblingInstalledRecords: [] as Array<Record<string, unknown>>,
  importedInstance: null as Record<string, unknown> | null,
  instance: null as Record<string, unknown> | null,
  renderSelection: null as Record<string, unknown> | null,
  registryEntries: [] as Array<Record<string, unknown>>,
  actionLog: [] as string[],
  definitions: [
    {
      connectorId: 'connector.platform.bilibili',
      displayName: 'Bilibili',
      labelKey: 'platform.bilibili',
      iconKey: 'bilibili',
      enabled: true,
      authFlow: 'qr',
      workspaceKind: 'video',
      workspaceMode: 'dedicated',
      sortOrder: 10,
    },
  ] as Array<Record<string, unknown>>,
  clearBilibiliFacadeCaches: vi.fn(),
  clearNeteaseFacadeCaches: vi.fn(),
  getMusicPlatformGlobalCacheSettings: vi.fn(async () => null),
  removeInstalledPlatformPackRecordSpy: vi.fn(),
  removeInstalledPlatformPackError: null as Error | null,
  upsertPlatformInstanceSpy: vi.fn(),
  removePlatformInstanceSpy: vi.fn(),
  logoutPlatformInstance: vi.fn(async (..._args: unknown[]) => null),
  clearPlatformInstanceAuthCookies: vi.fn(async (..._args: unknown[]) => null),
  persistPlatformLoginRegistry: vi.fn(async (...args: unknown[]) => {
    const [entries] = args as [Array<Record<string, unknown>>];
    state.registryEntries = entries;
    state.actionLog.push('persistPlatformLoginRegistry');
  }),
  removePlatformRenderSelection: vi.fn((_instanceId: string) => {
    state.actionLog.push('removePlatformRenderSelection');
    return true;
  }),
  setPlatformRenderSelectionMounted: vi.fn(
    (_instanceId: string, _mounted: boolean) => {
      state.actionLog.push('setPlatformRenderSelectionMounted');
      return undefined;
    }
  ),
  removePlatformImportedInstanceRecordByInstallationIdSpy: vi.fn(),
  removePlatformPackRegistrationSpy: vi.fn(),
  removePlatformPackRegistrationForInstallationSpy: vi.fn(),
  disposePlatformPackSidecarSpy: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('./bilibiliFacade', () => ({
  clearBilibiliFacadeCaches: (instanceId?: string | null) =>
    state.clearBilibiliFacadeCaches(instanceId),
}));

vi.mock('./neteaseFacade', () => ({
  clearNeteaseFacadeCaches: (instanceId?: string | null) =>
    state.clearNeteaseFacadeCaches(instanceId),
}));

vi.mock('./globalSettings', () => ({
  getMusicPlatformGlobalCacheSettings: () => state.getMusicPlatformGlobalCacheSettings(),
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => state.definitions,
}));

vi.mock('./installedPlatformPacks', () => ({
  getInstalledPlatformPackRecord: (installationId: string) =>
    state.record?.installationId === installationId ? state.record : null,
  listInstalledPlatformPackRecordsForConnector: (connectorId: string) =>
    [
      ...(state.record?.connectorId === connectorId ? [state.record] : []),
      ...state.siblingInstalledRecords.filter((record) => record.connectorId === connectorId),
    ],
  removeInstalledPlatformPackRecord: async (installationId: string) => {
    state.removeInstalledPlatformPackRecordSpy(installationId);
    state.actionLog.push('removeInstalledPlatformPackRecord');
    if (state.removeInstalledPlatformPackError) {
      throw state.removeInstalledPlatformPackError;
    }
    if (state.record?.installationId !== installationId) {
      return null;
    }
    const matched = state.record;
    state.record = null;
    return matched;
  },
}));

vi.mock('./instanceRegistry', () => ({
  getPlatformInstance: (instanceId: string) =>
    state.instance?.instanceId === instanceId ? state.instance : null,
  listPlatformInstances: () => (state.instance ? [state.instance] : []),
  removePlatformInstance: (instanceId: string) => {
    state.removePlatformInstanceSpy(instanceId);
    state.actionLog.push('removePlatformInstance');
    if (state.instance?.instanceId !== instanceId) {
      return false;
    }
    state.instance = null;
    return true;
  },
  upsertPlatformInstance: (record: Record<string, unknown>) => {
    state.upsertPlatformInstanceSpy(record);
    state.instance = record;
  },
}));

vi.mock('./platformConnectorModel', () => ({
  BILIBILI_CONNECTOR_ID: 'connector.platform.bilibili',
  NETEASE_CONNECTOR_ID: 'connector.platform.netease',
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  getPlatformImportedInstanceRecord: (instanceId: string) =>
    state.importedInstance?.instanceId === instanceId ? state.importedInstance : null,
  getPlatformImportedInstanceRecordByInstallationId: (installationId: string) =>
    state.importedInstance?.installationId === installationId ? state.importedInstance : null,
  removePlatformImportedInstanceRecordByInstallationId: async (installationId: string) => {
    state.removePlatformImportedInstanceRecordByInstallationIdSpy(installationId);
    state.actionLog.push('removeImportedInstanceRecord');
    if (state.importedInstance?.installationId !== installationId) {
      return null;
    }
    const matched = state.importedInstance;
    state.importedInstance = null;
    return matched;
  },
}));

vi.mock('./platformInstanceAuth', () => ({
  logoutPlatformInstance: (instanceId: string) => {
    state.actionLog.push('logoutPlatformInstance');
    return state.logoutPlatformInstance(instanceId);
  },
  clearPlatformInstanceAuthCookies: (instanceId: string) =>
    {
      state.actionLog.push('clearPlatformInstanceAuthCookies');
      return state.clearPlatformInstanceAuthCookies(instanceId);
    },
}));

vi.mock('./platformLoginRegistry', () => ({
  readPlatformLoginRegistry: () => state.registryEntries,
  persistPlatformLoginRegistry: (entries: Array<Record<string, unknown>>) =>
    state.persistPlatformLoginRegistry(entries),
  removePlatformLoginRegistryEntry: (
    entries: Array<Record<string, unknown>>,
    instanceId: string
  ) => entries.filter((entry) => entry.instanceId !== instanceId),
}));

vi.mock('./platformPackRegistry', () => ({
  removePlatformPackRegistration: (connectorId: string) => {
    state.actionLog.push('removePlatformPackRegistration');
    state.removePlatformPackRegistrationSpy(connectorId);
    return true;
  },
  removePlatformPackRegistrationForInstallation: (installationId: string) => {
    state.actionLog.push('removePlatformPackRegistrationForInstallation');
    state.removePlatformPackRegistrationForInstallationSpy(installationId);
    return true;
  },
}));

vi.mock('./platformPackSidecarBridge', () => ({
  disposePlatformPackSidecar: (
    connectorId: string,
    entryPath: string,
    reason?: string
  ) => {
    state.actionLog.push('disposePlatformPackSidecar');
    return state.disposePlatformPackSidecarSpy(connectorId, entryPath, reason);
  },
}));

vi.mock('./renderSelectionRegistry', () => ({
  getPlatformRenderSelection: (instanceId: string) =>
    state.renderSelection?.instanceId === instanceId ? state.renderSelection : null,
  removePlatformRenderSelection: (instanceId: string) =>
    {
      if (state.renderSelection?.instanceId === instanceId) {
        state.renderSelection = null;
      }
      return state.removePlatformRenderSelection(instanceId);
    },
  setPlatformRenderSelectionMounted: (instanceId: string, mounted: boolean) => {
    state.renderSelection = {
      instanceId,
      mounted,
    };
    return state.setPlatformRenderSelectionMounted(instanceId, mounted);
  },
}));

function createInstalledRecord() {
  return {
    installationId: 'installation-1',
    packId: 'qqmusic-pack',
    packVersion: '1.0.0',
    packageDigest: 'digest-1',
    connectorId: 'connector.platform.bilibili',
    platformId: 'platform.qqmusic',
    sourceType: 'external',
    source: 'D:/packs/qqmusic.pmpp',
    installedAtMs: 1,
    manifest: {
      metadata: {
        id: 'qqmusic-pack',
        version: '1.0.0',
      },
      connector: {
        displayName: 'QQ Music',
      },
    },
    contract: {
      platform: {
        displayName: 'QQ Music',
      },
    },
    artifactRootPath: 'D:/artifacts/qqmusic',
    manifestPath: 'D:/artifacts/qqmusic/manifest.json',
    contractPath: 'D:/artifacts/qqmusic/contract.json',
    runtimePath: 'D:/artifacts/qqmusic/runtime.js',
    iconPath: 'D:/artifacts/qqmusic/icon.png',
  };
}

function createInstalledRecordVariant(overrides: Record<string, unknown> = {}) {
  return {
    ...createInstalledRecord(),
    ...overrides,
  };
}

function createImportedInstance() {
  return {
    instanceId: 'qqmusic:imported-1',
    installationId: 'installation-1',
    connectorId: 'connector.platform.bilibili',
    platformId: 'platform.qqmusic',
    instanceLabel: 'QQ Music',
    displayName: 'QQ Music',
    createdAtMs: 1,
  };
}

function createInstanceRecord() {
  return {
    instanceId: 'qqmusic:imported-1',
    platformId: 'platform.qqmusic',
    instanceLabel: 'QQ Music',
    displayName: 'QQ Music',
    staticIcon: '',
    account: {
      accountId: 'user-1',
      accountName: 'User 1',
    },
    auth: {
      status: 'authorized',
      cookieUpdatedAtMs: 123,
    },
    capabilities: {},
    registrations: {
      navigationIds: [],
      settingsIds: [],
      pageIds: [],
    },
    availability: 'available',
    metadata: {
      imported: true,
      installationId: 'installation-1',
      connectorId: 'connector.platform.bilibili',
      authExpiresAtMs: 456,
    },
  };
}

describe('platformPackMaintenance', () => {
  beforeEach(() => {
    vi.resetModules();
    state.record = createInstalledRecord();
    state.siblingInstalledRecords = [];
    state.importedInstance = createImportedInstance();
    state.instance = createInstanceRecord();
    state.renderSelection = null;
    state.registryEntries = [
      {
        instanceId: 'qqmusic:imported-1',
        connectorId: 'connector.platform.bilibili',
        enabled: true,
        addedAtMs: 1,
      },
    ];
    state.actionLog = [];
    state.clearBilibiliFacadeCaches.mockClear();
    state.clearNeteaseFacadeCaches.mockClear();
    state.getMusicPlatformGlobalCacheSettings.mockClear();
    state.removeInstalledPlatformPackRecordSpy.mockClear();
    state.removeInstalledPlatformPackError = null;
    state.upsertPlatformInstanceSpy.mockClear();
    state.removePlatformInstanceSpy.mockClear();
    state.logoutPlatformInstance.mockClear();
    state.clearPlatformInstanceAuthCookies.mockClear();
    state.persistPlatformLoginRegistry.mockClear();
    state.removePlatformRenderSelection.mockClear();
    state.setPlatformRenderSelectionMounted.mockClear();
    state.removePlatformImportedInstanceRecordByInstallationIdSpy.mockClear();
    state.removePlatformPackRegistrationSpy.mockClear();
    state.removePlatformPackRegistrationForInstallationSpy.mockClear();
    state.disposePlatformPackSidecarSpy.mockClear();
  });

  it('resets imported pack auth state and hides its platform entry without unregistering it', async () => {
    const maintenance = await import('./platformPackMaintenance');

    const result = await maintenance.resetInstalledPlatformPackState({
      installationId: 'installation-1',
    });

    expect(result).not.toBeNull();
    expect(state.clearBilibiliFacadeCaches).toHaveBeenCalledWith('qqmusic:imported-1');
    expect(state.logoutPlatformInstance).toHaveBeenCalledWith('qqmusic:imported-1');
    expect(state.clearPlatformInstanceAuthCookies).toHaveBeenCalledWith(
      'qqmusic:imported-1'
    );
    expect(state.setPlatformRenderSelectionMounted).toHaveBeenCalledWith(
      'qqmusic:imported-1',
      false
    );
    expect(state.upsertPlatformInstanceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        account: {},
        auth: expect.objectContaining({
          status: 'empty',
          cookieUpdatedAtMs: undefined,
        }),
      })
    );
    expect(state.removeInstalledPlatformPackRecordSpy).not.toHaveBeenCalled();
    expect(state.persistPlatformLoginRegistry).not.toHaveBeenCalled();
  });

  it('unregisters imported packs across registry, instance, render selection, and installation storage', async () => {
    const maintenance = await import('./platformPackMaintenance');

    const result = await maintenance.unregisterInstalledPlatformPack({
      installationId: 'installation-1',
    });

    expect(result).not.toBeNull();
    expect(state.persistPlatformLoginRegistry).toHaveBeenCalledWith([]);
    expect(state.removePlatformRenderSelection).toHaveBeenCalledWith(
      'qqmusic:imported-1'
    );
    expect(state.removePlatformInstanceSpy).toHaveBeenCalledWith(
      'qqmusic:imported-1'
    );
    expect(state.removeInstalledPlatformPackRecordSpy).toHaveBeenCalledWith(
      'installation-1'
    );
    expect(
      state.removePlatformImportedInstanceRecordByInstallationIdSpy
    ).toHaveBeenCalledWith('installation-1');
    expect(state.removePlatformPackRegistrationSpy).toHaveBeenCalledWith(
      'connector.platform.bilibili'
    );
    expect(state.disposePlatformPackSidecarSpy).not.toHaveBeenCalled();
    expect(state.registryEntries).toEqual([]);
    expect(state.record).toBeNull();
    expect(state.importedInstance).toBeNull();
    expect(state.instance).toBeNull();
    expect(state.actionLog.indexOf('logoutPlatformInstance')).toBeGreaterThan(
      state.actionLog.indexOf('removeInstalledPlatformPackRecord')
    );
    expect(state.actionLog.indexOf('removeImportedInstanceRecord')).toBeGreaterThan(
      state.actionLog.indexOf('removePlatformInstance')
    );
    expect(state.actionLog.indexOf('removePlatformPackRegistration')).toBeGreaterThan(
      state.actionLog.indexOf('removeImportedInstanceRecord')
    );
  });

  it('does not clear imported instance auth or registry state when artifact removal fails', async () => {
    const maintenance = await import('./platformPackMaintenance');
    state.removeInstalledPlatformPackError = new Error('os error 5');

    await expect(
      maintenance.unregisterInstalledPlatformPack({
        installationId: 'installation-1',
      })
    ).rejects.toThrow('os error 5');

    expect(state.clearBilibiliFacadeCaches).toHaveBeenCalledWith('qqmusic:imported-1');
    expect(state.logoutPlatformInstance).not.toHaveBeenCalled();
    expect(state.clearPlatformInstanceAuthCookies).not.toHaveBeenCalled();
    expect(state.persistPlatformLoginRegistry).not.toHaveBeenCalled();
    expect(state.removePlatformRenderSelection).not.toHaveBeenCalled();
    expect(state.removePlatformInstanceSpy).not.toHaveBeenCalled();
    expect(state.removePlatformImportedInstanceRecordByInstallationIdSpy).not.toHaveBeenCalled();
    expect(state.removePlatformPackRegistrationSpy).not.toHaveBeenCalled();
    expect(state.record).not.toBeNull();
    expect(state.importedInstance).not.toBeNull();
    expect(state.instance).not.toBeNull();
    expect(state.registryEntries).toHaveLength(1);
    expect(state.actionLog.indexOf('removeInstalledPlatformPackRecord')).toBeGreaterThanOrEqual(0);
    expect(state.actionLog.indexOf('logoutPlatformInstance')).toBe(
      -1
    );
  });

  it('temporarily unmounts the active workspace before unregister and restores it when removal fails', async () => {
    const maintenance = await import('./platformPackMaintenance');
    state.renderSelection = {
      instanceId: 'qqmusic:imported-1',
      mounted: true,
    };
    state.removeInstalledPlatformPackError = new Error('os error 32');

    await expect(
      maintenance.unregisterInstalledPlatformPack({
        installationId: 'installation-1',
      })
    ).rejects.toThrow('os error 32');

    expect(state.setPlatformRenderSelectionMounted).toHaveBeenNthCalledWith(
      1,
      'qqmusic:imported-1',
      false
    );
    expect(state.setPlatformRenderSelectionMounted).toHaveBeenNthCalledWith(
      2,
      'qqmusic:imported-1',
      true
    );
    expect(state.removePlatformRenderSelection).not.toHaveBeenCalled();
    expect(state.removePlatformPackRegistrationSpy).not.toHaveBeenCalled();
  });

  it('removes only the installation-scoped registration when sibling installs remain for the connector', async () => {
    const maintenance = await import('./platformPackMaintenance');
    state.siblingInstalledRecords = [
      createInstalledRecordVariant({
        installationId: 'installation-2',
        source: 'D:/packs/qqmusic-copy.pmpp',
        installedAtMs: 2,
      }),
    ];

    const result = await maintenance.unregisterInstalledPlatformPack({
      installationId: 'installation-1',
    });

    expect(result).not.toBeNull();
    expect(state.removePlatformPackRegistrationForInstallationSpy).toHaveBeenCalledWith(
      'installation-1'
    );
    expect(state.removePlatformPackRegistrationSpy).not.toHaveBeenCalled();
  });
});
