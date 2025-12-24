import { beforeEach, describe, expect, it } from 'vitest';
import { writeJson } from '../../../modules/storage';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import type { InstalledPmpmPlugin, PmpmManifest } from '../pmpm';
import { getInstalledPmpmPlugin, recordPmpmPluginCrash } from '../pmpm';
import { readVerifiedPmpmPluginEntryCode } from '../pmpmRuntime';
import { trustPmpmSigningKeyId } from '../pmpmTrust';
import type { PmpmVerifiedSignature } from '../pmpmSignature';

const PLUGIN_ID = 'demo-policy';
const KEY_ID = 'a'.repeat(64);

function buildManifest(): PmpmManifest {
  return {
    formatVersion: '1.0',
    type: 'magnet-plugin',
    entryPoint: 'entry.js',
    metadata: {
      id: PLUGIN_ID,
      name: 'Demo Policy',
      version: '1.0.0',
    },
  };
}

function buildSignature(keyId = KEY_ID): PmpmVerifiedSignature {
  return {
    keyId,
    signature: {
      formatVersion: '1',
      algorithm: 'ECDSA-P256-SHA256',
      manifestSha256: 'b'.repeat(64),
      entrySha256: 'c'.repeat(64),
      signature: 'sig',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    },
  };
}

function installPlugin(plugin: InstalledPmpmPlugin): void {
  writeJson(STORAGE_KEYS.PMPM_PLUGINS, [plugin]);
}

describe('pmpmRuntime signature trust policy', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.PMPM_PLUGINS);
    localStorage.removeItem(STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS);
    localStorage.removeItem(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES);
    localStorage.removeItem(STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1);
  });

  it('blocks signed plugins with untrusted key when trusted signatures required', async () => {
    writeJson(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES, true);

    installPlugin({
      manifest: buildManifest(),
      entryCode: 'export function mount() {}',
      installedAt: Date.now(),
      signature: buildSignature(),
    });

    await expect(readVerifiedPmpmPluginEntryCode(PLUGIN_ID)).rejects.toThrow(/not trusted/i);

    const stored = getInstalledPmpmPlugin(PLUGIN_ID);
    expect(stored?.enabled).toBe(false);
    expect(stored?.disabledReason).toBe('policy');
    expect(stored?.lastError).toMatch(/^\[policy\]/);
  });

  it('allows signed plugins with trusted key when trusted signatures required', async () => {
    trustPmpmSigningKeyId(KEY_ID);
    writeJson(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES, true);

    const entryCode = 'export function mount() {}';
    installPlugin({
      manifest: buildManifest(),
      entryCode,
      installedAt: Date.now(),
      signature: buildSignature(),
    });

    await expect(readVerifiedPmpmPluginEntryCode(PLUGIN_ID)).resolves.toBe(entryCode);
  });

  it('blocks unsigned plugins even if allowUnsigned=true when trusted signatures required', async () => {
    writeJson(STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS, true);
    writeJson(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES, true);

    installPlugin({
      manifest: buildManifest(),
      entryCode: 'export function mount() {}',
      installedAt: Date.now(),
    });

    await expect(readVerifiedPmpmPluginEntryCode(PLUGIN_ID)).rejects.toThrow(/trusted signatures required/i);
  });

  it('does not override policy disable with crash disable', async () => {
    writeJson(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES, true);

    installPlugin({
      manifest: buildManifest(),
      entryCode: 'export function mount() {}',
      installedAt: Date.now(),
      signature: buildSignature(),
    });

    await expect(readVerifiedPmpmPluginEntryCode(PLUGIN_ID)).rejects.toThrow();

    recordPmpmPluginCrash(PLUGIN_ID, new Error('boom'), 'command');

    const stored = getInstalledPmpmPlugin(PLUGIN_ID);
    expect(stored?.disabledReason).toBe('policy');
  });
});
