import { strToU8, zip } from 'fflate';
import type { AsyncZippable } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseExtensionPackFromZipBytes } from './extensionPack';
import type { ExtensionPackParseError } from './extensionPack';

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

function encodeJson(value: unknown): Uint8Array {
  return ensureUint8Array(strToU8(JSON.stringify(value, null, 2)));
}

function ensureUint8Array(data: Uint8Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function computeRustInstallSourceDigest(
  files: Array<{ relativePath: string; bytes: number[] | Uint8Array }>
): Promise<string> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const file of [...files].sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  )) {
    const header = encoder.encode(`${file.relativePath}\u0000`);
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const footer = new Uint8Array([0]);
    chunks.push(header, bytes, footer);
    totalLength += header.byteLength + bytes.byteLength + footer.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return await sha256Hex(merged);
}

function createExtensionManifest(overrides: Record<string, unknown> = {}) {
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
    requiresCapabilities: [{ capabilityId: 'host.pmp.magnets.layout' }],
    ...overrides,
  };
}

async function createExtensionPackZip(options: {
  includePackageManifest?: boolean;
  includeChecksums?: boolean;
  includeEntryManifest?: boolean;
  includeRuntimeEntry?: boolean;
  corruptChecksum?: boolean;
  entryManifestPath?: string;
  extraFiles?: Record<string, Uint8Array>;
  packageMetadata?: Partial<{ id: string; name: string; version: string }>;
  extensionManifest?: unknown;
  mutateChecksums?: (checksums: Record<string, string>) => void;
} = {}): Promise<Uint8Array> {
  const includePackageManifest = options.includePackageManifest ?? true;
  const includeChecksums = options.includeChecksums ?? true;
  const includeEntryManifest = options.includeEntryManifest ?? true;
  const includeRuntimeEntry = options.includeRuntimeEntry ?? true;
  const entryManifestPath = options.entryManifestPath ?? 'extension/manifest.v2.json';
  const packageMetadata = {
    id: 'com.example.visualizer',
    name: 'Example Visualizer',
    version: '1.0.0',
    ...options.packageMetadata,
  };
  const files: Record<string, Uint8Array> = {};

  if (includePackageManifest) {
    files['manifest.json'] = encodeJson({
      formatVersion: '1.0',
      type: 'extension-pack',
      metadata: packageMetadata,
      entry: {
        manifest: entryManifestPath,
      },
    });
  }

  if (includeEntryManifest) {
    files[entryManifestPath] = encodeJson(
      options.extensionManifest ?? createExtensionManifest()
    );
  }

  if (includeRuntimeEntry) {
    files['extension/dist/index.js'] = ensureUint8Array(strToU8('export function mount() {}\n'));
  }

  for (const [path, bytes] of Object.entries(options.extraFiles ?? {})) {
    files[path] = bytes;
  }

  if (includeChecksums) {
    const checksumFiles: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(files)) {
      checksumFiles[path] = await sha256Hex(bytes);
    }
    if (options.corruptChecksum) {
      checksumFiles['extension/dist/index.js'] = '0'.repeat(64);
    }
    options.mutateChecksums?.(checksumFiles);
    files['checksums.json'] = encodeJson({
      formatVersion: '1.0',
      algorithm: 'sha256',
      files: checksumFiles,
    });
  }

  return await zipAsync(files);
}

describe('extensionPack parser', () => {
  it('parses a valid extension pack into an install plan', async () => {
    const parsed = await parseExtensionPackFromZipBytes(await createExtensionPackZip());

    expect(parsed.manifest.type).toBe('extension-pack');
    expect(parsed.extensionManifest.identity.id).toBe('com.example.visualizer');
    expect(parsed.entryManifestPath).toBe('extension/manifest.v2.json');
    expect(parsed.extensionRootPath).toBe('extension');
    expect(parsed.plan).toMatchObject({
      formatVersion: '1.0',
      status: 'ready',
      source: {
        packageType: 'extension-pack',
      },
      summary: {
        packageType: 'extension-pack',
        extensionCount: 1,
      },
      steps: [
        { kind: 'verify-integrity' },
        {
          kind: 'install-extension',
          pluginId: 'com.example.visualizer',
          manifestPath: 'extension/manifest.v2.json',
        },
        { kind: 'refresh-plugin-registries' },
      ],
    });
    expect(parsed.executorPreview).toMatchObject({
      mode: 'preview',
      summary: {
        pluginId: 'com.example.visualizer',
        version: '1.0.0',
        fileCount: 2,
        runtimeEntryRelativePaths: ['dist/index.js'],
      },
      installSource: {
        kind: 'embedded-manifest-v2-source',
        sourcePackageType: 'extension-pack',
        rootDir: 'extension',
        manifestPath: 'extension/manifest.v2.json',
        validatedManifest: {
          identity: {
            id: 'com.example.visualizer',
          },
        },
      },
      nextAction: {
        kind: 'materialize-embedded-source-and-install-manifest-v2',
        installStepId: 'install-extension:com.example.visualizer',
        manifestRelativePath: 'manifest.v2.json',
      },
    });
    expect(parsed.executorPreview.installSource.files.map((file) => file.relativePath)).toEqual([
      'dist/index.js',
      'manifest.v2.json',
    ]);
    expect(parsed.executorPreview.installSource.files.every((file) => file.sha256)).toBe(true);
    expect(parsed.executorPreview.installSource.packageDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes packageDigest using Rust-compatible path ordering', async () => {
    const parsed = await parseExtensionPackFromZipBytes(
      await createExtensionPackZip({
        extraFiles: {
          'extension/dist/Z-extra.js': ensureUint8Array(strToU8('export const upper = true;\n')),
          'extension/dist/a-extra.js': ensureUint8Array(strToU8('export const lower = true;\n')),
        },
      })
    );

    expect(parsed.executorPreview.installSource.files.map((file) => file.relativePath)).toEqual([
      'dist/Z-extra.js',
      'dist/a-extra.js',
      'dist/index.js',
      'manifest.v2.json',
    ]);
    await expect(
      computeRustInstallSourceDigest(parsed.executorPreview.installSource.files)
    ).resolves.toBe(parsed.executorPreview.installSource.packageDigest);
  });

  it('rejects packs without root manifest.json', async () => {
    await expect(
      parseExtensionPackFromZipBytes(await createExtensionPackZip({ includePackageManifest: false }))
    ).rejects.toMatchObject({
      code: 'MANIFEST_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs without checksums.json', async () => {
    await expect(
      parseExtensionPackFromZipBytes(await createExtensionPackZip({ includeChecksums: false }))
    ).rejects.toMatchObject({
      code: 'CHECKSUMS_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs whose entry manifest is missing', async () => {
    await expect(
      parseExtensionPackFromZipBytes(await createExtensionPackZip({ includeEntryManifest: false }))
    ).rejects.toMatchObject({
      code: 'ENTRY_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs whose entry manifest path escapes the zip root', async () => {
    const bytes = await zipAsync({
      'manifest.json': encodeJson({
        formatVersion: '1.0',
        type: 'extension-pack',
        metadata: {
          id: 'com.example.visualizer',
          name: 'Example Visualizer',
          version: '1.0.0',
        },
        entry: {
          manifest: '../extension/manifest.v2.json',
        },
      }),
    });

    await expect(parseExtensionPackFromZipBytes(bytes)).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects zip entries that collide after case-insensitive normalization', async () => {
    const bytes = await zipAsync({
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
      'MANIFEST.json': encodeJson({ duplicate: true }),
    });

    await expect(parseExtensionPackFromZipBytes(bytes)).rejects.toMatchObject({
      code: 'INVALID_ZIP',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs with checksum mismatches', async () => {
    await expect(
      parseExtensionPackFromZipBytes(await createExtensionPackZip({ corruptChecksum: true }))
    ).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs when checksums.json references a missing file', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          mutateChecksums(checksums) {
            checksums['extension/missing.js'] = '0'.repeat(64);
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'CHECKSUMS_INVALID',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs when a zip file is missing from checksums.json', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          mutateChecksums(checksums) {
            delete checksums['extension/dist/index.js'];
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'CHECKSUMS_INVALID',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs whose package metadata does not match the extension identity', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          packageMetadata: {
            id: 'com.example.other',
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'ENTRY_INVALID',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs with invalid extv2 manifests', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          extensionManifest: createExtensionManifest({ runtimes: [] }),
        })
      )
    ).rejects.toMatchObject({
      code: 'ENTRY_INVALID',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs whose declared runtime entry is missing', async () => {
    await expect(
      parseExtensionPackFromZipBytes(await createExtensionPackZip({ includeRuntimeEntry: false }))
    ).rejects.toMatchObject({
      code: 'RUNTIME_ENTRY_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs when any declared runtime entry is missing', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          extensionManifest: createExtensionManifest({
            runtimes: [
              {
                runtimeId: 'webview.main',
                kind: 'webview',
                entry: 'dist/index.js',
              },
              {
                runtimeId: 'webview.secondary',
                kind: 'webview',
                entry: 'dist/secondary.js',
              },
            ],
          }),
        })
      )
    ).rejects.toMatchObject({
      code: 'RUNTIME_ENTRY_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('rejects packs when a declared sidecar runtime entry is missing', async () => {
    await expect(
      parseExtensionPackFromZipBytes(
        await createExtensionPackZip({
          includeRuntimeEntry: false,
          extensionManifest: createExtensionManifest({
            runtimes: [
              {
                runtimeId: 'sidecar.main',
                kind: 'sidecar',
                entry: 'bin/sidecar.exe',
              },
            ],
          }),
        })
      )
    ).rejects.toMatchObject({
      code: 'RUNTIME_ENTRY_MISSING',
    } satisfies Partial<ExtensionPackParseError>);
  });

  it('supports extension packs whose manifest.v2.json is at the zip root', async () => {
    const parsed = await parseExtensionPackFromZipBytes(
      await createExtensionPackZip({
        entryManifestPath: 'manifest.v2.json',
        includeRuntimeEntry: false,
        extraFiles: {
          'dist/index.js': ensureUint8Array(strToU8('export function mount() {}\n')),
        },
      })
    );

    expect(parsed.extensionRootPath).toBe('');
    expect(parsed.executorPreview.installSource.rootDir).toBe('.');
    expect(parsed.executorPreview.nextAction.manifestRelativePath).toBe('manifest.v2.json');
    expect(parsed.executorPreview.installSource.files.map((file) => file.relativePath)).toEqual([
      'dist/index.js',
      'manifest.v2.json',
    ]);
  });

  it('reports checksum-verified files outside the extension root without installing them', async () => {
    const parsed = await parseExtensionPackFromZipBytes(
      await createExtensionPackZip({
        extraFiles: {
          'notes/readme.txt': ensureUint8Array(strToU8('not installed\n')),
        },
      })
    );

    expect(parsed.executorPreview.installSource.files.map((file) => file.relativePath)).toEqual([
      'dist/index.js',
      'manifest.v2.json',
    ]);
    expect(parsed.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'extension-pack.ignored-non-extension-files',
        details: expect.objectContaining({
          count: 1,
          paths: ['notes/readme.txt'],
        }),
      })
    );
  });

  it('warns when the extension root is nested more deeply than the recommended layout', async () => {
    const parsed = await parseExtensionPackFromZipBytes(
      await createExtensionPackZip({
        entryManifestPath: 'packages/visualizer/manifest.v2.json',
        includeRuntimeEntry: false,
        extraFiles: {
          'packages/visualizer/dist/index.js': ensureUint8Array(
            strToU8('export function mount() {}\n')
          ),
        },
      })
    );

    expect(parsed.extensionRootPath).toBe('packages/visualizer');
    expect(parsed.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'extension-pack.deep-entry-root',
        details: expect.objectContaining({
          extensionRootPath: 'packages/visualizer',
        }),
      })
    );
  });
});
