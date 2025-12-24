import { beforeEach, describe, expect, it } from 'vitest';
import type { InstalledPmpmPlugin } from '../pmpm';
import {
  loadInstalledPmpmPlugins,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
  setPmpmPluginEnabled,
} from '../pmpm';
import { readPmpmAuditLog } from '../pmpmGovernance';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

beforeEach(() => {
  localStorage.clear();
});

function installPlugin(plugin: InstalledPmpmPlugin): void {
  localStorage.setItem(STORAGE_KEYS.PMPM_PLUGINS, JSON.stringify([plugin]));
}

describe('pmpm governance', () => {
  it('records permission denied events', () => {
    recordPmpmPermissionDenied({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      capability: 'api:navigation',
      action: 'navigation.navigateTo(home)',
    });

    const events = readPmpmAuditLog();
    expect(events.some((e) => e.type === 'permission-denied' && e.pluginId === 'demo')).toBe(true);
  });

  it('toggles plugin enabled state and audits', () => {
    const plugin: InstalledPmpmPlugin = {
      manifest: {
        formatVersion: '1.0',
        type: 'magnet-plugin',
        metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
        entryPoint: 'dist/plugin.js',
      },
      installedAt: Date.now(),
      entryCode: 'export function mount() {}',
    };
    installPlugin(plugin);

    setPmpmPluginEnabled('magnet-demo', false);
    const disabled = loadInstalledPmpmPlugins()[0];
    expect(disabled.enabled).toBe(false);
    expect(disabled.disabledReason).toBe('manual');

    setPmpmPluginEnabled('magnet-demo', true);
    const enabled = loadInstalledPmpmPlugins()[0];
    expect(enabled.enabled).toBe(true);
    expect(enabled.disabledReason).toBeUndefined();

    const events = readPmpmAuditLog();
    expect(events.some((e) => e.type === 'disabled' && e.pluginId === 'magnet-demo')).toBe(true);
    expect(events.some((e) => e.type === 'enabled' && e.pluginId === 'magnet-demo')).toBe(true);
  });

  it('records plugin crashes into audit log', () => {
    const plugin: InstalledPmpmPlugin = {
      manifest: {
        formatVersion: '1.0',
        type: 'magnet-plugin',
        metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
        entryPoint: 'dist/plugin.js',
      },
      installedAt: Date.now(),
      entryCode: 'export function mount() {}',
    };
    installPlugin(plugin);

    recordPmpmPluginCrash('magnet-demo', new Error('boom'), 'magnet');
    const updated = loadInstalledPmpmPlugins()[0];
    expect(updated.enabled).toBe(false);
    expect(updated.disabledReason).toBe('crash');
    expect(updated.lastError).toContain('boom');

    const events = readPmpmAuditLog();
    expect(events.some((e) => e.type === 'crash' && e.pluginId === 'magnet-demo')).toBe(true);
  });
});

