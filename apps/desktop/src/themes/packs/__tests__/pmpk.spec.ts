import { describe, expect, it } from 'vitest';

import { strToU8, unzip, zip } from 'fflate';
import type { AsyncZippable, Unzipped } from 'fflate';

import { createThemePackZipBytes, parseThemePackFromZipBytes, type ThemePackManifestV1 } from '../pmpk';

function ensureUint8Array(data: Uint8Array): Uint8Array {
  // Ensure `instanceof Uint8Array` matches the current realm (Vitest/jsdom may involve multiple realms).
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return await new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

async function zipAsync(data: AsyncZippable): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    zip(data, (err, zipped) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(zipped);
    });
  });
}

async function createZipBytes(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const normalized: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(files)) {
    normalized[key] = ensureUint8Array(value);
  }
  return await zipAsync(normalized);
}

describe('.pmpk theme-pack', () => {
  it('roundtrips minimal pack with checksums', async () => {
    const manifest: ThemePackManifestV1 = {
      formatVersion: '1.0',
      type: 'theme-pack',
      metadata: { id: 'neon-pack', name: 'Neon Pack', version: '1.0.0' },
      entry: { theme: 'theme.pmpt' },
    };

    const themeText = JSON.stringify(
      {
        id: 'neon',
        name: 'Neon',
        version: '1.0.0',
        bindings: { 'magnet.btn-play-pause': { variant: 'cover-glow' } },
      },
      null,
      2
    );

    const bytes = await createThemePackZipBytes({
      manifest,
      themeText,
      checksums: { enabled: true },
    });

    const parsed = await parseThemePackFromZipBytes(bytes);
    expect(parsed.manifest.metadata.id).toBe('neon-pack');
    expect(parsed.entryThemePath).toBe('theme.pmpt');
    expect(parsed.entryThemeText).toBe(themeText);
    expect(parsed.checksums?.algorithm).toBe('sha256');
    expect(parsed.dependencies).toHaveLength(0);
  });

  it('reads bundled dependency meta', async () => {
    const pmpmBytes = await createZipBytes({
      'manifest.json': strToU8(
        JSON.stringify(
          {
            formatVersion: '1.0',
            type: 'magnet-plugin',
            metadata: { id: 'visualizer-bars', name: 'Visualizer Bars', version: '0.5.2' },
            entryPoint: 'index.js',
            permissions: ['api:audio-cover'],
          },
          null,
          2
        )
      ),
      'index.js': strToU8('export function mount() {}'),
    });

    const pmpsBytes = await createZipBytes({
      'manifest.json': strToU8(
        JSON.stringify(
          {
            formatVersion: '2.0',
            type: 'shader-pack',
            metadata: { id: 'neon-wave', name: 'Neon Wave', version: '2.1.0' },
            entry: { fragment: 'fragment.glsl' },
          },
          null,
          2
        )
      ),
      'fragment.glsl': strToU8('void mainImage(out vec4 fragColor,in vec2 fragCoord){fragColor=vec4(0.0);}'),
    });

    const manifest: ThemePackManifestV1 = {
      formatVersion: '1.0',
      type: 'theme-pack',
      metadata: { id: 'neon-pack', name: 'Neon Pack', version: '1.0.0' },
      entry: { theme: 'theme.pmpt' },
      dependencies: {
        pmpm: [
          {
            id: 'visualizer-bars',
            version: '^0.5.0',
            bundlePath: 'bundles/plugins/visualizer-bars.pmpm',
          },
        ],
        pmps: [{ id: 'neon-wave', version: '^2.0.0', bundlePath: 'bundles/shaders/neon-wave.pmps' }],
      },
    };

    const bytes = await createThemePackZipBytes({
      manifest,
      themeText: JSON.stringify({ id: 'theme', name: 'Theme', version: '1.0.0' }, null, 2),
      bundles: {
        'bundles/plugins/visualizer-bars.pmpm': pmpmBytes,
        'bundles/shaders/neon-wave.pmps': pmpsBytes,
      },
      checksums: { enabled: true },
    });

    const parsed = await parseThemePackFromZipBytes(bytes);
    expect(parsed.dependencies).toHaveLength(2);

    const plugin = parsed.dependencies.find((dep) => dep.kind === 'pmpm');
    expect(plugin?.bundled).toBe(true);
    expect(plugin?.bundleMeta?.id).toBe('visualizer-bars');
    expect(plugin?.bundleMeta?.version).toBe('0.5.2');
    expect(plugin?.bundleMeta?.permissions).toEqual(['api:audio-cover']);

    const shader = parsed.dependencies.find((dep) => dep.kind === 'pmps');
    expect(shader?.bundled).toBe(true);
    expect(shader?.bundleMeta?.id).toBe('neon-wave');
    expect(shader?.bundleMeta?.version).toBe('2.1.0');
  });

  it('rejects checksum mismatch when checksums.json is present', async () => {
    const manifest: ThemePackManifestV1 = {
      formatVersion: '1.0',
      type: 'theme-pack',
      metadata: { id: 'tamper-pack', name: 'Tamper Pack', version: '1.0.0' },
      entry: { theme: 'theme.pmpt' },
    };

    const themeText = JSON.stringify({ id: 'theme', name: 'Theme', version: '1.0.0' }, null, 2);

    const bytes = await createThemePackZipBytes({
      manifest,
      themeText,
      checksums: { enabled: true },
    });

    const files = await unzipAsync(bytes);
    files['theme.pmpt'] = strToU8(`${themeText}\n`);
    const normalized: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(files)) {
      normalized[key] = ensureUint8Array(value as Uint8Array);
    }
    const tamperedBytes = await zipAsync(normalized);

    await expect(parseThemePackFromZipBytes(tamperedBytes)).rejects.toThrow(/Integrity check failed/);
  });
});
