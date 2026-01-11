import { describe, expect, it } from 'vitest';

import { strToU8, unzip, zip } from 'fflate';
import type { AsyncZippable, Unzipped } from 'fflate';

import { createProfilePackZipBytes, parseProfilePackFromZipBytes } from '../profilePack';

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

function ensureUint8Array(data: Uint8Array): Uint8Array {
  // Ensure `instanceof Uint8Array` matches the current realm (Vitest/jsdom may involve multiple realms).
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

describe('.pmpk profile-pack', () => {
  it('roundtrips manifest and profile without checksums', async () => {
    const bytes = await createProfilePackZipBytes({
      manifest: {
        formatVersion: '1.0',
        type: 'profile-pack',
        metadata: { id: 'my-profile', name: 'My Profile', version: '1.0.0' },
        entry: { profile: 'profile.json' },
      },
      profile: {
        formatVersion: '1.0',
        theme: { source: { kind: 'pmpt', path: 'theme.pmpt' } },
        magnets: {
          spaces: { value: {} },
          spaceLayout: { value: {} },
          spaceConfig: { value: {} },
        },
      },
      themeText: JSON.stringify({ id: 'theme-default', name: 'Default', version: '1.0.0' }),
      checksums: { enabled: false },
    });

    const parsed = await parseProfilePackFromZipBytes(bytes);
    expect(parsed.manifest.metadata.id).toBe('my-profile');
    expect(parsed.entryProfilePath).toBe('profile.json');
    expect(parsed.themeEntry?.path).toBe('theme.pmpt');
  });

  it('rejects checksum mismatch when checksums.json is present', async () => {
    const bytes = await createProfilePackZipBytes({
      manifest: {
        formatVersion: '1.0',
        type: 'profile-pack',
        metadata: { id: 'my-profile', name: 'My Profile', version: '1.0.0' },
        entry: { profile: 'profile.json' },
      },
      profile: {
        formatVersion: '1.0',
        theme: { source: { kind: 'pmpt', path: 'theme.pmpt' } },
        magnets: {
          spaces: { value: {} },
          spaceLayout: { value: {} },
          spaceConfig: { value: {} },
        },
      },
      themeText: JSON.stringify({ id: 'theme-default', name: 'Default', version: '1.0.0' }),
      checksums: { enabled: true },
    });

    const files = await unzipAsync(bytes);
    files['profile.json'] = strToU8(`${JSON.stringify({ formatVersion: '1.0' })}\n`);

    const normalized: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(files)) {
      normalized[key] = ensureUint8Array(value as Uint8Array);
    }
    const tamperedBytes = await zipAsync(normalized);

    await expect(parseProfilePackFromZipBytes(tamperedBytes)).rejects.toThrow(/Integrity check failed/);
  });

  it('rejects non profile-pack manifests', async () => {
    await expect(
      createProfilePackZipBytes({
        // @ts-expect-error validating runtime error path
        manifest: { formatVersion: '1.0', type: 'theme-pack' },
        profile: { formatVersion: '1.0' },
        checksums: { enabled: false },
      })
    ).rejects.toThrow(/profile-pack/);
  });
});
