import { strToU8, zip } from 'fflate';
import type { AsyncZippable } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseExperiencePackFromZipBytes, type ExperiencePackParseError } from './experiencePack';

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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function ensureUint8Array(data: Uint8Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function encodeJson(value: unknown): Uint8Array {
  return ensureUint8Array(strToU8(JSON.stringify(value, null, 2)));
}

function createExtensionManifest() {
  return {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: 'com.example.visualizer',
      publisher: 'example',
      version: '1.0.0',
      name: 'Example Visualizer',
    },
    hostTargets: [{ hostId: 'pmp', required: true }],
    runtimes: [
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'dist/index.js',
      },
    ],
  };
}

async function createPmpeZip(): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'manifest.json': encodeJson({
      formatVersion: '1.0',
      type: 'extension-pack',
      metadata: {
        id: 'com.example.visualizer',
        name: 'Example Visualizer',
        version: '1.0.0',
      },
      entry: {
        manifest: 'extension/manifest.v2.json',
      },
    }),
    'extension/manifest.v2.json': encodeJson(createExtensionManifest()),
    'extension/dist/index.js': ensureUint8Array(strToU8('export function mount() {}\n')),
  };
  const checksums: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) {
    checksums[path] = await sha256Hex(bytes);
  }
  files['checksums.json'] = encodeJson({
    formatVersion: '1.0',
    algorithm: 'sha256',
    files: checksums,
  });
  return await zipAsync(files);
}

function createTheme() {
  return {
    id: 'dark-stage',
    name: 'Dark Stage',
    version: '1.0.0',
    pixel: {
      shape: 'square',
      size: 20,
      opacity: 1,
      colors: {
        default: { r: 1, g: 1, b: 1 },
        hover: { r: 2, g: 2, b: 2 },
        active: { r: 3, g: 3, b: 3 },
        occupied: { r: 4, g: 4, b: 4 },
      },
    },
    background: {
      maximized: { type: 'color', color: '#000000' },
      windowed: { type: 'color', color: '#101010' },
    },
    fonts: {
      primary: 'Inter',
    },
    bindings: {
      'magnet.com.example.visualizer': {
        renderer: 'plugin.visualizer',
      },
    },
  };
}

function createProfile(spacesMode: 'replace-all' | 'prompt' = 'replace-all') {
  return {
    formatVersion: '1.0',
    theme: {
      source: {
        kind: 'pmpt',
        path: 'theme.pmpt',
      },
    },
    magnets: {
      spaces: {
        value: {
          version: 1,
          activeSpaceId: 'space1',
          spaces: [{ id: 'space1', name: 'Main' }],
        },
      },
      spaceLayout: {
        value: {
          space1: {
            version: 1,
            activeMagnetIds: ['com.example.visualizer', 'missing-magnet'],
            anchorsByMagnetId: {
              'com.example.visualizer': { x: 0, y: 0, w: 4, h: 4 },
              'missing-magnet': { x: 4, y: 0, w: 4, h: 4 },
            },
          },
        },
      },
      spaceConfig: {
        value: {
          space1: {
            magnets: {
              'com.example.visualizer': { enabled: true },
              'missing-magnet': { enabled: true },
            },
            customMagnets: [{ id: 'custom-one' }],
          },
        },
      },
    },
    apply: {
      spaces: spacesMode,
    },
  };
}

async function createExperiencePackZip(options: {
  includeManifest?: boolean;
  includeChecksums?: boolean;
  includePlugin?: boolean;
  corruptChecksum?: boolean;
  manifestOverrides?: Record<string, unknown>;
  profilePath?: string;
  spacesMode?: 'replace-all' | 'prompt';
} = {}): Promise<Uint8Array> {
  const profilePath = options.profilePath ?? 'profile/profile.json';
  const files: Record<string, Uint8Array> = {};
  const manifest = {
    formatVersion: '1.0',
    type: 'experience-pack',
    metadata: {
      id: 'com.example.experience',
      name: 'Example Experience',
      version: '1.0.0',
    },
    dependencies: [{ id: 'com.example.optional-lib', versionRange: '^1.0.0', required: true }],
    plugins: [
      {
        id: 'com.example.visualizer',
        required: true,
        source: {
          kind: 'embedded',
          path: 'plugins/visualizer.pmpe',
        },
      },
    ],
    profile: {
      path: profilePath,
      apply: {
        theme: true,
        magnets: true,
        spaces: options.spacesMode ?? 'replace-all',
      },
    },
    ...options.manifestOverrides,
  };

  if (options.includeManifest ?? true) files['manifest.json'] = encodeJson(manifest);
  if (options.includePlugin ?? true) files['plugins/visualizer.pmpe'] = await createPmpeZip();
  files[profilePath] = encodeJson(createProfile(options.spacesMode ?? 'replace-all'));
  files['profile/theme.pmpt'] = encodeJson(createTheme());

  if (options.includeChecksums ?? true) {
    const checksums: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(files)) {
      checksums[path] = await sha256Hex(bytes);
    }
    if (options.corruptChecksum) checksums[profilePath] = '0'.repeat(64);
    files['checksums.json'] = encodeJson({
      formatVersion: '1.0',
      algorithm: 'sha256',
      files: checksums,
    });
  }

  return await zipAsync(files);
}

describe('experiencePack parser', () => {
  it('parses a full .pmpex into an ordered install plan', async () => {
    const parsed = await parseExperiencePackFromZipBytes(await createExperiencePackZip());

    expect(parsed.manifest.type).toBe('experience-pack');
    expect(parsed.executorPreview.summary).toMatchObject({
      extensionCount: 1,
      appliesTheme: true,
      appliesProfile: true,
      appliesSpaces: true,
      unsigned: true,
    });
    expect(parsed.plan.steps.map((step) => step.kind)).toEqual([
      'verify-integrity',
      'install-extension',
      'refresh-plugin-registries',
      'apply-theme',
      'apply-profile',
      'apply-space-layout',
      'report',
    ]);
    expect(parsed.plan.steps.find((step) => step.kind === 'apply-space-layout')).toMatchObject({
      dependsOn: ['apply-profile'],
      mode: 'replace-all',
    });
    expect(Object.keys(parsed.executorPreview.extensionPacksByStepId)).toEqual([
      'install-extension:com.example.visualizer',
    ]);
    expect(Object.keys(parsed.executorPreview.themeSourcesByPath)).toEqual(['profile/theme.pmpt']);
    expect(parsed.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'experience-pack.signature.unsigned',
      })
    );
    expect(parsed.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'experience-pack.dependencies.declaration-only',
      })
    );
  });

  it('rejects packs without manifest.json', async () => {
    await expect(
      parseExperiencePackFromZipBytes(await createExperiencePackZip({ includeManifest: false }))
    ).rejects.toMatchObject({
      code: 'MANIFEST_MISSING',
    } satisfies Partial<ExperiencePackParseError>);
  });

  it('rejects packs without checksums.json', async () => {
    await expect(
      parseExperiencePackFromZipBytes(await createExperiencePackZip({ includeChecksums: false }))
    ).rejects.toMatchObject({
      code: 'CHECKSUMS_MISSING',
    } satisfies Partial<ExperiencePackParseError>);
  });

  it('rejects profile path traversal', async () => {
    await expect(
      parseExperiencePackFromZipBytes(
        await createExperiencePackZip({
          manifestOverrides: {
            profile: {
              path: '../profile.json',
              apply: { theme: true, magnets: true, spaces: 'replace-all' },
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
    } satisfies Partial<ExperiencePackParseError>);
  });

  it('rejects checksum mismatches', async () => {
    await expect(
      parseExperiencePackFromZipBytes(await createExperiencePackZip({ corruptChecksum: true }))
    ).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    } satisfies Partial<ExperiencePackParseError>);
  });

  it('rejects missing embedded plugin sources', async () => {
    await expect(
      parseExperiencePackFromZipBytes(await createExperiencePackZip({ includePlugin: false }))
    ).rejects.toMatchObject({
      code: 'ENTRY_MISSING',
    } satisfies Partial<ExperiencePackParseError>);
  });

  it('preserves prompt space mode as a pending executor step', async () => {
    const parsed = await parseExperiencePackFromZipBytes(
      await createExperiencePackZip({ spacesMode: 'prompt' })
    );

    expect(parsed.plan.steps.find((step) => step.kind === 'apply-space-layout')).toMatchObject({
      mode: 'prompt',
    });
  });
});
