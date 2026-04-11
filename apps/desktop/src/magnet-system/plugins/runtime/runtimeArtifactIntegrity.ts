export interface RuntimeArtifactIntegrityDeps {
  readArtifactBytes?: (artifactPath: string) => Promise<Uint8Array> | Uint8Array;
}

export interface AssertRuntimeArtifactIntegrityOptions {
  artifactPath: string;
  expectedSha256?: string | null;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function defaultReadArtifactBytes(artifactPath: string): Promise<Uint8Array> {
  const { readBinaryFile } = await import('@tauri-apps/api/fs');
  const bytes = await readBinaryFile(artifactPath);
  return new Uint8Array(bytes);
}

export async function assertRuntimeArtifactIntegrity(
  options: AssertRuntimeArtifactIntegrityOptions,
  deps: RuntimeArtifactIntegrityDeps = {}
): Promise<void> {
  const expectedSha256 =
    typeof options.expectedSha256 === 'string' ? options.expectedSha256.trim().toLowerCase() : '';
  if (!expectedSha256) return;

  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`Invalid runtime artifact digest metadata: ${options.artifactPath}`);
  }

  const readArtifactBytes = deps.readArtifactBytes ?? defaultReadArtifactBytes;
  const bytes = await Promise.resolve(readArtifactBytes(options.artifactPath));
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Runtime artifact integrity check failed (sha256 mismatch): ${options.artifactPath}`
    );
  }
}
