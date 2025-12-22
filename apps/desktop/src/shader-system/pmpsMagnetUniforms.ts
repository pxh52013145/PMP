import type { PmpsManifest, PmpsUniformDefinition, PmpsUniformType } from './pmps';
import { readJson } from '../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../utils/windowCommunication';

export type PmpsUniformValue = number | boolean | string | number[];
export type PmpsUniformValues = Record<string, PmpsUniformValue>;

export type PmpsMagnetUniformStore = Record<string, Record<string, PmpsUniformValues>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
  const clampedMin = typeof min === 'number' && Number.isFinite(min) ? min : undefined;
  const clampedMax = typeof max === 'number' && Number.isFinite(max) ? max : undefined;
  if (typeof clampedMin === 'number' && value < clampedMin) return clampedMin;
  if (typeof clampedMax === 'number' && value > clampedMax) return clampedMax;
  return value;
}

function normalizeNumberArray(value: unknown, expectedLength: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((item) => (typeof item === 'number' ? item : NaN));
  if (numbers.some((n) => Number.isNaN(n))) return null;
  if (numbers.length !== expectedLength) return null;
  return numbers;
}

function byteToHex(byte: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(byte)));
  return clamped.toString(16).padStart(2, '0');
}

function float01ToHex(float01: number): string {
  return byteToHex(float01 * 255);
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return null;
  return `#${trimmed.slice(1).toLowerCase()}`;
}

function normalizeColorValue(value: unknown): string | null {
  const hex = normalizeHexColor(value);
  if (hex) return hex;

  const vec3 = normalizeNumberArray(value, 3);
  if (vec3) {
    return `#${float01ToHex(vec3[0])}${float01ToHex(vec3[1])}${float01ToHex(vec3[2])}`;
  }
  const vec4 = normalizeNumberArray(value, 4);
  if (vec4) {
    const rgb = `#${float01ToHex(vec4[0])}${float01ToHex(vec4[1])}${float01ToHex(vec4[2])}`;
    const alpha = float01ToHex(vec4[3]);
    return alpha === 'ff' ? rgb : `${rgb}${alpha}`;
  }

  return null;
}

function coerceByType(def: PmpsUniformDefinition, value: unknown): PmpsUniformValue | null {
  const type: PmpsUniformType = def.type;
  switch (type) {
    case 'float': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return clampNumber(value, def.min, def.max);
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return Math.trunc(clampNumber(value, def.min, def.max));
    }
    case 'bool': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
      return null;
    }
    case 'vec2': {
      const vec = normalizeNumberArray(value, 2);
      return vec ?? null;
    }
    case 'vec3': {
      const vec = normalizeNumberArray(value, 3);
      return vec ?? null;
    }
    case 'vec4': {
      const vec = normalizeNumberArray(value, 4);
      return vec ?? null;
    }
    case 'color': {
      return normalizeColorValue(value);
    }
    default: {
      return null;
    }
  }
}

export function getPmpsUniformDefaultValues(manifest: PmpsManifest): PmpsUniformValues {
  const uniforms = manifest.uniforms ?? [];
  const defaults: PmpsUniformValues = {};
  for (const def of uniforms) {
    const value = coerceByType(def, def.default);
    if (value !== null) {
      defaults[def.name] = value;
    }
  }
  return defaults;
}

function sanitizeUnknownValue(value: unknown): PmpsUniformValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  const hex = normalizeHexColor(value);
  if (hex) return hex;
  if (Array.isArray(value)) {
    const numbers = value.map((item) => (typeof item === 'number' ? item : NaN));
    if (numbers.some((n) => Number.isNaN(n))) return null;
    return numbers;
  }
  return null;
}

export function resolvePmpsUniformValues(
  manifest: PmpsManifest,
  overrides: PmpsUniformValues
): PmpsUniformValues {
  const result: PmpsUniformValues = { ...getPmpsUniformDefaultValues(manifest) };
  const defs = new Map<string, PmpsUniformDefinition>((manifest.uniforms ?? []).map((def) => [def.name, def]));

  for (const [name, rawValue] of Object.entries(overrides)) {
    const def = defs.get(name);
    const value = def ? coerceByType(def, rawValue) : sanitizeUnknownValue(rawValue);
    if (value !== null) {
      result[name] = value;
    }
  }

  return result;
}

export function loadPmpsMagnetUniformStore(): PmpsMagnetUniformStore {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPS_MAGNET_UNIFORMS, {});
    if (!isRecord(parsed)) return {};
    return parsed as PmpsMagnetUniformStore;
  } catch {
    return {};
  }
}

function savePmpsMagnetUniformStore(store: PmpsMagnetUniformStore): void {
  if (typeof window === 'undefined') return;
  void broadcastDataUpdate(STORAGE_KEYS.PMPS_MAGNET_UNIFORMS, store, TAURI_EVENTS.PMPS_UNIFORMS_UPDATED);
}

export function getPmpsMagnetUniformOverrides(magnetId: string, shaderId: string): PmpsUniformValues {
  const store = loadPmpsMagnetUniformStore();
  const byMagnet = store[magnetId];
  if (!byMagnet || !isRecord(byMagnet)) return {};
  const values = byMagnet[shaderId];
  if (!values || !isRecord(values)) return {};
  return values as PmpsUniformValues;
}

export function upsertPmpsMagnetUniformOverrides(
  magnetId: string,
  shaderId: string,
  values: PmpsUniformValues
): void {
  const store = loadPmpsMagnetUniformStore();
  const byMagnet = (store[magnetId] ?? {}) as Record<string, PmpsUniformValues>;
  byMagnet[shaderId] = values;
  store[magnetId] = byMagnet;
  savePmpsMagnetUniformStore(store);
}

export function setPmpsMagnetUniformValue(
  magnetId: string,
  shaderId: string,
  uniformName: string,
  value: PmpsUniformValue
): void {
  const store = loadPmpsMagnetUniformStore();
  const byMagnet = (store[magnetId] ?? {}) as Record<string, PmpsUniformValues>;
  const uniforms = { ...(byMagnet[shaderId] ?? {}) } as PmpsUniformValues;
  uniforms[uniformName] = value;
  byMagnet[shaderId] = uniforms;
  store[magnetId] = byMagnet;
  savePmpsMagnetUniformStore(store);
}

export function removePmpsMagnetUniformOverrides(magnetId: string, shaderId: string): void {
  const store = loadPmpsMagnetUniformStore();
  const byMagnet = store[magnetId];
  if (!byMagnet || !isRecord(byMagnet)) return;
  if (!(shaderId in byMagnet)) return;
  delete (byMagnet as Record<string, unknown>)[shaderId];
  store[magnetId] = byMagnet as Record<string, PmpsUniformValues>;
  savePmpsMagnetUniformStore(store);
}

