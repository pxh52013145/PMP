import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export type PmpmTrustedKeysListener = () => void;

const trustedKeysListeners = new Set<PmpmTrustedKeysListener>();
let trustedKeysRevision = 0;
let syncDisposer: (() => void) | null = null;

function notifyTrustedKeysListeners(): void {
  trustedKeysRevision += 1;
  for (const listener of Array.from(trustedKeysListeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[pmpm-trust] listener failed', error);
    }
  }
}

function ensureTrustedKeysSync(): void {
  if (syncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1) return;
    notifyTrustedKeysListeners();
  };

  window.addEventListener('storage', onStorage);
  syncDisposer = () => {
    window.removeEventListener('storage', onStorage);
    syncDisposer = null;
  };
}

function normalizeKeyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) return null;
  return trimmed;
}

export function readPmpmTrustedKeyIds(): string[] {
  const raw = readJson<unknown>(STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1, []);
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    const keyId = normalizeKeyId(item);
    if (!keyId) continue;
    out.add(keyId);
  }
  return Array.from(out).sort();
}

export function isPmpmSigningKeyTrusted(keyId: string): boolean {
  const normalized = normalizeKeyId(keyId);
  if (!normalized) return false;
  const trusted = readPmpmTrustedKeyIds();
  return trusted.includes(normalized);
}

export function trustPmpmSigningKeyId(keyId: string): void {
  const normalized = normalizeKeyId(keyId);
  if (!normalized) {
    throw new Error('Invalid keyId (expected sha256 hex)');
  }

  const existing = readPmpmTrustedKeyIds();
  if (existing.includes(normalized)) return;

  writeJson(STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1, [...existing, normalized]);
  notifyTrustedKeysListeners();
}

export function untrustPmpmSigningKeyId(keyId: string): void {
  const normalized = normalizeKeyId(keyId);
  if (!normalized) return;

  const existing = readPmpmTrustedKeyIds();
  const next = existing.filter((id) => id !== normalized);
  if (next.length === existing.length) return;

  writeJson(STORAGE_KEYS.PMPM_TRUSTED_KEY_IDS_V1, next);
  notifyTrustedKeysListeners();
}

export function getPmpmTrustedKeysRevision(): number {
  return trustedKeysRevision;
}

export function subscribePmpmTrustedKeys(listener: PmpmTrustedKeysListener): () => void {
  trustedKeysListeners.add(listener);
  ensureTrustedKeysSync();
  return () => {
    trustedKeysListeners.delete(listener);
    if (trustedKeysListeners.size === 0) {
      syncDisposer?.();
    }
  };
}

