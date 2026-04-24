import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import type { InstalledHostExtensionRecord } from './extensions';
import {
  createPluginDevProjectSourceFromPath,
  detachPluginDevSession,
  getPluginDevSessionRecord,
  getPluginDevSessionsRevision,
  loadPluginDevSessions,
  refreshPluginDevSession,
  resolvePluginDevSessionEntry,
  setPluginDevSessionLastError,
  subscribePluginDevSessions,
  upsertPluginDevSession,
} from './devSessionRegistry';

const {
  getInstalledExtensionRecordMock,
  parseInstalledExtensionSourceFromFilePathMock,
  requestInstalledExtensionRuntimeRestartMock,
} = vi.hoisted(() => ({
  getInstalledExtensionRecordMock: vi.fn(),
  parseInstalledExtensionSourceFromFilePathMock: vi.fn(),
  requestInstalledExtensionRuntimeRestartMock: vi.fn(),
}));

vi.mock('./extensions', async () => {
  const actual = await vi.importActual<typeof import('./extensions')>('./extensions');
  return {
    ...actual,
    getInstalledExtensionRecord: getInstalledExtensionRecordMock,
    parseInstalledExtensionSourceFromFilePath: parseInstalledExtensionSourceFromFilePathMock,
  };
});

vi.mock('./hostExtensionRuntimeSupervisor', () => ({
  requestInstalledExtensionRuntimeRestart: requestInstalledExtensionRuntimeRestartMock,
}));

function createInstalledRecord(): InstalledHostExtensionRecord {
  return {
    installedAt: 1,
    enabled: true,
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'demo-plugin',
        publisher: 'pixel',
        version: '1.0.0',
        name: 'Demo Plugin',
        displayName: 'Demo Plugin',
      },
      hostTargets: [{ hostId: 'pmp' }],
      runtimes: [
        {
          runtimeId: 'webview.main',
          kind: 'webview',
          entry: 'dist/view.html',
          bridge: 'pxp.runtime.bridge.v1',
        },
        {
          runtimeId: 'worker.main',
          kind: 'extension-host',
          entry: 'dist/index.js',
          bridge: 'pxp.runtime.bridge.v1',
        },
        {
          runtimeId: 'sidecar.main',
          kind: 'sidecar',
          entry: 'bin/demo',
          bridge: 'pxp.runtime.bridge.v1',
          dataPlane: { kinds: ['pipe'] },
        },
      ],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'webview.main',
        path: 'C:/plugins/demo-plugin/dist/view.html',
      },
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo-plugin/dist/index.js',
      },
    ],
  };
}

describe('devSessionRegistry', () => {
  beforeEach(() => {
    localStorage.clear();
    getInstalledExtensionRecordMock.mockReset();
    parseInstalledExtensionSourceFromFilePathMock.mockReset();
    requestInstalledExtensionRuntimeRestartMock.mockReset();

    getInstalledExtensionRecordMock.mockImplementation((pluginId: string) =>
      pluginId === 'demo-plugin' ? createInstalledRecord() : null
    );
    parseInstalledExtensionSourceFromFilePathMock.mockResolvedValue({
      record: createInstalledRecord(),
      rootDir: 'D:/plugin-project',
      manifestPath: 'D:/plugin-project/manifest.v2.json',
    });
  });

  it('persists dev sessions, bumps revisions, and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginDevSessions(listener);
    const revisionBefore = getPluginDevSessionsRevision();

    const session = upsertPluginDevSession({
      pluginId: 'demo-plugin',
      projectRoot: 'D:/plugin-project',
      manifestPath: 'D:/plugin-project/manifest.v2.json',
      mode: 'entry-url',
      entryUrl: 'http://localhost:5173/plugin.html',
      runtimeKinds: ['webview'],
      lastError: null,
    });

    expect(session).toMatchObject({
      pluginId: 'demo-plugin',
      mode: 'entry-url',
      entryUrl: 'http://localhost:5173/plugin.html',
      runtimeKinds: ['webview'],
      lastRestartReason: 'dev-session-attached',
    });
    expect(loadPluginDevSessions()).toHaveLength(1);
    expect(getPluginDevSessionRecord('demo-plugin')).toMatchObject({
      pluginId: 'demo-plugin',
      mode: 'entry-url',
    });
    expect(listener).toHaveBeenCalled();
    expect(getPluginDevSessionsRevision()).toBeGreaterThan(revisionBefore);
    expect(requestInstalledExtensionRuntimeRestartMock).toHaveBeenCalledWith('demo-plugin', {
      reason: 'dev-session-attached',
    });

    unsubscribe();
  });

  it('responds to storage sync notifications across windows', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginDevSessions(listener);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEYS.EXTENSIONS_V2_DEV_SESSIONS_V1,
        storageArea: localStorage,
      })
    );

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('builds a project source from manifest.v2.json and defers sidecar runtimes', async () => {
    const source = await createPluginDevProjectSourceFromPath('D:/plugin-project');

    expect(source).toMatchObject({
      pluginId: 'demo-plugin',
      displayName: 'Demo Plugin',
      projectRoot: 'D:/plugin-project',
      manifestPath: 'D:/plugin-project/manifest.v2.json',
      supportedRuntimeKinds: ['webview', 'extension-host'],
      deferredRuntimeKinds: ['sidecar'],
      defaultMode: 'entry-url',
      defaultEntryPath: 'D:/plugin-project/dist/view.html',
    });
  });

  it('refreshes, reports errors, resolves entry fallback, and detaches to installed mode', () => {
    const attached = upsertPluginDevSession({
      pluginId: 'demo-plugin',
      projectRoot: 'D:/plugin-project',
      manifestPath: 'D:/plugin-project/manifest.v2.json',
      mode: 'entry-url',
      entryPath: 'dist/dev-index.js',
      runtimeKinds: ['extension-host'],
      lastError: null,
    });

    const resolvedEntry = resolvePluginDevSessionEntry(attached, 'extension-host');
    expect(resolvedEntry).toEqual({
      path: 'D:/plugin-project/dist/dev-index.js',
      field: 'entryPath',
      usedFallback: true,
    });

    const refreshed = refreshPluginDevSession('demo-plugin', {
      reason: 'dev-session-refresh',
    });
    expect(refreshed).toMatchObject({
      pluginId: 'demo-plugin',
      lastRestartReason: 'dev-session-refresh',
    });

    const withError = setPluginDevSessionLastError('demo-plugin', new Error('boom'));
    expect(withError?.lastError).toBe('boom');

    expect(detachPluginDevSession('demo-plugin')).toBe(true);
    expect(loadPluginDevSessions()).toEqual([]);
    expect(requestInstalledExtensionRuntimeRestartMock).toHaveBeenLastCalledWith(
      'demo-plugin',
      {
        reason: 'dev-session-detached',
      }
    );
  });
});
