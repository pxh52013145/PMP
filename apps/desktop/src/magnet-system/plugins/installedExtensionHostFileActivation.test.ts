import { describe, expect, it, vi } from 'vitest';
import {
  activateInstalledExtensionsForNativeHostFileOpen,
  activateInstalledExtensionsForNativeHostFileOpens,
  activateInstalledExtensionsForHostFile,
  activateInstalledExtensionsForHostFiles,
  INSTALLED_EXTENSION_HOST_FILE_OPEN_HOST_EVENT_ID,
  listInstalledExtensionHostFileTypes,
  normalizeInstalledExtensionHostFilePath,
} from './installedExtensionHostFileActivation';

describe('installedExtensionHostFileActivation', () => {
  it('normalizes host file paths for cross-window activation payloads', () => {
    expect(
      normalizeInstalledExtensionHostFilePath('  C:\\plugins\\manifest.v2.json  ')
    ).toBe('C:/plugins/manifest.v2.json');
    expect(normalizeInstalledExtensionHostFilePath('   ')).toBeNull();
  });

  it('derives specific and generic file types from host file paths', () => {
    expect(listInstalledExtensionHostFileTypes('C:\\plugins\\manifest.v2.json')).toEqual([
      'manifest.v2.json',
      'json',
    ]);
    expect(listInstalledExtensionHostFileTypes('/Users/demo/Demo.EXTENSION')).toEqual([
      'demo.extension',
      'extension',
    ]);
    expect(listInstalledExtensionHostFileTypes('/tmp/README')).toEqual(['readme']);
  });

  it('activates installed extensions for each derived host file type in order', async () => {
    const activateForFile = vi.fn(async () => {});

    await activateInstalledExtensionsForHostFile(
      { activateForFile },
      {
        filePath: '  C:\\plugins\\manifest.v2.json  ',
        action: 'selected',
        hostLabel: 'PluginsSettingsPanel',
      }
    );

    expect(activateForFile).toHaveBeenNthCalledWith(1, {
      fileType: 'manifest.v2.json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'selected',
      hostLabel: 'PluginsSettingsPanel',
    });
    expect(activateForFile).toHaveBeenNthCalledWith(2, {
      fileType: 'json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'selected',
      hostLabel: 'PluginsSettingsPanel',
    });
  });

  it('deduplicates normalized host file paths across batched activation requests', async () => {
    const activateForFile = vi.fn(async () => {});

    await activateInstalledExtensionsForHostFiles(
      { activateForFile },
      {
        filePaths: [
          'C:\\plugins\\manifest.v2.json',
          'C:/plugins/manifest.v2.json',
          'C:\\plugins\\sample.json',
        ],
        action: 'startup-opened',
        hostLabel: 'AppStartupFileOpen',
      }
    );

    expect(activateForFile).toHaveBeenCalledTimes(4);
    expect(activateForFile).toHaveBeenNthCalledWith(1, {
      fileType: 'manifest.v2.json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
    expect(activateForFile).toHaveBeenNthCalledWith(2, {
      fileType: 'json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
    expect(activateForFile).toHaveBeenNthCalledWith(3, {
      fileType: 'sample.json',
      filePath: 'C:/plugins/sample.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
    expect(activateForFile).toHaveBeenNthCalledWith(4, {
      fileType: 'json',
      filePath: 'C:/plugins/sample.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
  });

  it('activates installed extensions for native host file open payloads via host event and file types', async () => {
    const activateForHostEvent = vi.fn(async () => {});
    const activateForFile = vi.fn(async () => {});

    await activateInstalledExtensionsForNativeHostFileOpen(
      { activateForHostEvent, activateForFile },
      {
        paths: ['  C:\\plugins\\manifest.v2.json  ', 'C:/plugins/manifest.v2.json'],
        source: 'cli-startup',
        action: 'startup-opened',
        receivedAtMs: 42,
      }
    );

    expect(activateForHostEvent).toHaveBeenCalledTimes(1);
    expect(activateForHostEvent).toHaveBeenCalledWith({
      hostEventId: INSTALLED_EXTENSION_HOST_FILE_OPEN_HOST_EVENT_ID,
      payload: {
        paths: ['C:/plugins/manifest.v2.json'],
        source: 'cli-startup',
        action: 'startup-opened',
        receivedAtMs: 42,
      },
      hostLabel: 'AppStartupFileOpen',
    });

    expect(activateForFile).toHaveBeenCalledTimes(2);
    expect(activateForFile).toHaveBeenNthCalledWith(1, {
      fileType: 'manifest.v2.json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
    expect(activateForFile).toHaveBeenNthCalledWith(2, {
      fileType: 'json',
      filePath: 'C:/plugins/manifest.v2.json',
      action: 'startup-opened',
      hostLabel: 'AppStartupFileOpen',
    });
  });

  it('processes native host file open batches in order', async () => {
    const activateForHostEvent = vi.fn(async () => {});
    const activateForFile = vi.fn(async () => {});

    await activateInstalledExtensionsForNativeHostFileOpens(
      { activateForHostEvent, activateForFile },
      [
        {
          paths: ['C:\\plugins\\manifest.v2.json'],
          source: 'cli-startup',
          action: 'startup-opened',
          receivedAtMs: 1,
        },
        {
          paths: ['C:\\plugins\\demo.extension'],
          source: 'os-reopen',
          action: 'reopened',
          receivedAtMs: 2,
        },
      ]
    );

    expect(activateForHostEvent).toHaveBeenNthCalledWith(1, {
      hostEventId: INSTALLED_EXTENSION_HOST_FILE_OPEN_HOST_EVENT_ID,
      payload: {
        paths: ['C:/plugins/manifest.v2.json'],
        source: 'cli-startup',
        action: 'startup-opened',
        receivedAtMs: 1,
      },
      hostLabel: 'AppStartupFileOpen',
    });
    expect(activateForHostEvent).toHaveBeenNthCalledWith(2, {
      hostEventId: INSTALLED_EXTENSION_HOST_FILE_OPEN_HOST_EVENT_ID,
        payload: {
        paths: ['C:/plugins/demo.extension'],
        source: 'os-reopen',
        action: 'reopened',
        receivedAtMs: 2,
      },
      hostLabel: 'AppHostFileOpen',
    });
  });
});
