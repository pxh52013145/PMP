import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

const durableText = new Map<string, string>();
let failWrites = new Set<string>();

vi.mock('../durableTextStore', () => {
  return {
    readDurableText: async (namespace: string, id: string) => {
      return durableText.get(`${namespace}:${id}`) ?? null;
    },
    writeDurableText: async (namespace: string, id: string, value: string) => {
      if (failWrites.has(`${namespace}:${id}`)) return false;
      durableText.set(`${namespace}:${id}`, value);
      return true;
    },
    removeDurableText: async (namespace: string, id: string) => {
      durableText.delete(`${namespace}:${id}`);
    },
  };
});

beforeEach(() => {
  durableText.clear();
  failWrites = new Set<string>();
  localStorage.clear();
});

describe('R3 durable migrations', () => {
  let pmpm: typeof import('../../../magnet-system/plugins/pmpm');
  let pmps: typeof import('../../../shader-system/pmps');

  beforeAll(async () => {
    [pmpm, pmps] = await Promise.all([
      import('../../../magnet-system/plugins/pmpm'),
      import('../../../shader-system/pmps'),
    ]);
  }, 20000);

  it('migrates .pmpm entryCode with backup and can rollback (backup)', async () => {
    const installed = [
      {
        manifest: {
          formatVersion: '1.0',
          type: 'magnet-plugin',
          metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
          entryPoint: 'dist/plugin.js',
        },
        entryCode: 'export function mount() {}',
        installedAt: Date.now(),
      },
    ];

    localStorage.setItem(STORAGE_KEYS.PMPM_PLUGINS, JSON.stringify(installed));

    const result = await pmpm.migrateInstalledPmpmPluginsToDurableStorage({ force: true });
    expect(result).toEqual({ migrated: 1, failed: 0 });

    const storedRaw = localStorage.getItem(STORAGE_KEYS.PMPM_PLUGINS) ?? '[]';
    const stored = JSON.parse(storedRaw) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].entryCode).toBeUndefined();

    expect(durableText.get('pmpm-entry:magnet-demo')).toBe('export function mount() {}');
    expect(durableText.get('migration-backup:pmpm-plugins-v1')).toContain('"entryCode"');
    expect(localStorage.getItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1)).toBe('done');

    const rollback = await pmpm.rollbackPmpmDurableMigrationV1({ strategy: 'backup' });
    expect(rollback.ok).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1)).toBe('rolled-back');

    const restored = JSON.parse(localStorage.getItem(STORAGE_KEYS.PMPM_PLUGINS) ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(restored[0].entryCode).toBe('export function mount() {}');
  }, 15000);

  it('migrates .pmps fragmentCode with backup and can rollback (rehydrate)', async () => {
    const installed = [
      {
        manifest: {
          formatVersion: '2.0',
          type: 'shader-pack',
          metadata: { id: 'shader-demo', name: 'Demo', version: '0.1.0' },
          entry: { fragment: 'main.frag' },
        },
        fragmentCode: 'void main() { gl_FragColor = vec4(1.0); }',
        installedAt: Date.now(),
        source: 'pmps',
      },
    ];

    localStorage.setItem(STORAGE_KEYS.PMPS_SHADERS, JSON.stringify(installed));

    const result = await pmps.migrateInstalledPmpsShaderPacksToDurableStorage({ force: true });
    expect(result).toEqual({ migrated: 1, failed: 0 });

    const storedRaw = localStorage.getItem(STORAGE_KEYS.PMPS_SHADERS) ?? '[]';
    const stored = JSON.parse(storedRaw) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].fragmentCode).toBeUndefined();

    expect(durableText.get('pmps-fragment:shader-demo')).toBe(
      'void main() { gl_FragColor = vec4(1.0); }'
    );

    // Remove backup to force rehydrate path.
    durableText.delete('migration-backup:pmps-shaders-v1');

    const rollback = await pmps.rollbackPmpsDurableMigrationV1({ strategy: 'rehydrate' });
    expect(rollback.ok).toBe(true);
    expect(rollback.restored).toBe(1);
    expect(rollback.missing).toBe(0);

    const restored = JSON.parse(localStorage.getItem(STORAGE_KEYS.PMPS_SHADERS) ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(restored[0].fragmentCode).toBe('void main() { gl_FragColor = vec4(1.0); }');
  }, 15000);

  it('aborts when backup write fails (pmpm)', async () => {
    failWrites.add('migration-backup:pmpm-plugins-v1');

    const installed = [
      {
        manifest: {
          formatVersion: '1.0',
          type: 'magnet-plugin',
          metadata: { id: 'magnet-demo', name: 'Demo', version: '0.1.0' },
          entryPoint: 'dist/plugin.js',
        },
        entryCode: 'export function mount() {}',
        installedAt: Date.now(),
      },
    ];

    localStorage.setItem(STORAGE_KEYS.PMPM_PLUGINS, JSON.stringify(installed));

    const result = await pmpm.migrateInstalledPmpmPluginsToDurableStorage({ force: true });
    expect(result.migrated).toBe(0);
    expect(result.failed).toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1)).toBe('failed');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.PMPM_PLUGINS) ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(stored[0].entryCode).toBe('export function mount() {}');
  }, 15000);
});
