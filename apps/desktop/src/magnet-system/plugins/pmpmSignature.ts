type PmpmPackageSignatureAlgorithm = 'ECDSA-P256-SHA256';

export type PmpmPackageSignatureV1 = {
  formatVersion: '1';
  algorithm: PmpmPackageSignatureAlgorithm;
  manifestSha256: string;
  entrySha256: string;
  signature: string; // base64url (raw 64 bytes, r||s)
  publicKeyJwk: JsonWebKey;
  createdAt?: string;
};

export type PmpmVerifiedSignature = {
  keyId: string;
  signature: PmpmPackageSignatureV1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function parsePmpmPackageSignatureFileV1(bytes: Uint8Array): PmpmPackageSignatureV1 {
  const raw = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error('Invalid signature.json: must be an object');

  const formatVersion = parsed.formatVersion;
  if (formatVersion !== '1') throw new Error('Invalid signature.json: formatVersion must be "1"');

  const algorithm = parsed.algorithm;
  if (algorithm !== 'ECDSA-P256-SHA256') {
    throw new Error('Invalid signature.json: algorithm must be "ECDSA-P256-SHA256"');
  }

  const manifestSha256 = typeof parsed.manifestSha256 === 'string' ? parsed.manifestSha256 : '';
  if (!isSha256Hex(manifestSha256)) {
    throw new Error('Invalid signature.json: manifestSha256 must be sha256 hex');
  }

  const entrySha256 = typeof parsed.entrySha256 === 'string' ? parsed.entrySha256 : '';
  if (!isSha256Hex(entrySha256)) {
    throw new Error('Invalid signature.json: entrySha256 must be sha256 hex');
  }

  const signature = typeof parsed.signature === 'string' ? parsed.signature : '';
  if (!signature) throw new Error('Invalid signature.json: signature is required');

  const publicKeyJwk = parsed.publicKeyJwk;
  if (!isRecord(publicKeyJwk)) throw new Error('Invalid signature.json: publicKeyJwk is required');

  const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined;

  return {
    formatVersion: '1',
    algorithm,
    manifestSha256: manifestSha256.toLowerCase(),
    entrySha256: entrySha256.toLowerCase(),
    signature,
    publicKeyJwk: publicKeyJwk as JsonWebKey,
    createdAt,
  };
}

function buildSignatureMessageV1(manifestSha256: string, entrySha256: string): Uint8Array {
  const payload = `pmpm-signature-v1:${manifestSha256}:${entrySha256}`;
  return new TextEncoder().encode(payload);
}

async function computeKeyIdV1(publicKeyJwk: JsonWebKey): Promise<string> {
  const crv = publicKeyJwk.crv;
  const x = publicKeyJwk.x;
  const y = publicKeyJwk.y;
  if (crv !== 'P-256') throw new Error('Invalid publicKeyJwk: crv must be "P-256"');
  if (typeof x !== 'string' || !x) throw new Error('Invalid publicKeyJwk: x is required');
  if (typeof y !== 'string' || !y) throw new Error('Invalid publicKeyJwk: y is required');

  const material = new TextEncoder().encode(`pmpm-key-v1:${crv}:${x}:${y}`);
  return sha256Hex(material);
}

export async function verifyPmpmPackageSignatureV1(options: {
  signature: PmpmPackageSignatureV1;
  manifestSha256: string;
  entrySha256: string;
}): Promise<PmpmVerifiedSignature> {
  const manifestSha256 = options.manifestSha256.toLowerCase();
  const entrySha256 = options.entrySha256.toLowerCase();

  if (options.signature.manifestSha256 !== manifestSha256) {
    throw new Error('Plugin signature mismatch: manifestSha256 differs');
  }
  if (options.signature.entrySha256 !== entrySha256) {
    throw new Error('Plugin signature mismatch: entrySha256 differs');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    options.signature.publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  const signatureBytes = base64UrlToBytes(options.signature.signature);
  if (signatureBytes.length !== 64) {
    throw new Error(`Invalid signature.json: expected 64-byte signature, got ${signatureBytes.length}`);
  }

  const message = buildSignatureMessageV1(manifestSha256, entrySha256);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signatureBytes as unknown as BufferSource,
    message as unknown as BufferSource
  );
  if (!ok) {
    throw new Error('Plugin signature verification failed');
  }

  const keyId = await computeKeyIdV1(options.signature.publicKeyJwk);
  return { keyId, signature: options.signature };
}
