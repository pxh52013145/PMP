import { describe, expect, it } from 'vitest';
import {
  parsePmpmPackageSignatureFileV1,
  verifyPmpmPackageSignatureV1,
} from '../pmpmSignature';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('pmpmSignature', () => {
  it('verifies a valid ECDSA P-256 signature over manifest/entry digests', async () => {
    const manifestSha256 = await sha256Hex('manifest.json');
    const entrySha256 = await sha256Hex('entry.js');

    const keys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicKeyJwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;

    const message = new TextEncoder().encode(`pmpm-signature-v1:${manifestSha256}:${entrySha256}`);
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keys.privateKey,
        message
      )
    );

    const signatureFile = {
      formatVersion: '1',
      algorithm: 'ECDSA-P256-SHA256',
      manifestSha256,
      entrySha256,
      signature: bytesToBase64Url(sig),
      publicKeyJwk,
      createdAt: new Date().toISOString(),
    };

    const parsed = parsePmpmPackageSignatureFileV1(
      new TextEncoder().encode(JSON.stringify(signatureFile))
    );

    const verified = await verifyPmpmPackageSignatureV1({
      signature: parsed,
      manifestSha256,
      entrySha256,
    });

    expect(verified.keyId).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.signature.manifestSha256).toBe(manifestSha256);
    expect(verified.signature.entrySha256).toBe(entrySha256);
  });

  it('rejects invalid signatures', async () => {
    const manifestSha256 = await sha256Hex('manifest.json');
    const entrySha256 = await sha256Hex('entry.js');

    const keys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicKeyJwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;

    const invalidSig = new Uint8Array(64);
    invalidSig[0] = 1;

    const signatureFile = {
      formatVersion: '1',
      algorithm: 'ECDSA-P256-SHA256',
      manifestSha256,
      entrySha256,
      signature: bytesToBase64Url(invalidSig),
      publicKeyJwk,
    };

    const parsed = parsePmpmPackageSignatureFileV1(
      new TextEncoder().encode(JSON.stringify(signatureFile))
    );

    await expect(
      verifyPmpmPackageSignatureV1({
        signature: parsed,
        manifestSha256,
        entrySha256,
      })
    ).rejects.toThrow(/verification failed/i);
  });
});
