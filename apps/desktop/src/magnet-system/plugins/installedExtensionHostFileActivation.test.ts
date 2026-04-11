import { describe, expect, it, vi } from 'vitest';
import {
  activateInstalledExtensionsForHostFile,
  activateInstalledExtensionsForHostFiles,
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
    expect(listInstalledExtensionHostFileTypes('/Users/demo/Demo.PMPM')).toEqual([
      'demo.pmpm',
      'pmpm',
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
});
