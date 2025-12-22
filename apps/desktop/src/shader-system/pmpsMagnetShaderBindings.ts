import type { PmpsEntryPoint } from './pmps';
import { readJson } from '../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../utils/windowCommunication';

export type PmpsMagnetShaderBinding = {
  shaderId: string | null;
  enabled?: boolean;
  entryPoint?: PmpsEntryPoint;
  fpsLimit?: number;
  resolutionScale?: number;
};

export type PmpsMagnetShaderBindings = Record<string, PmpsMagnetShaderBinding>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function loadPmpsMagnetShaderBindings(): PmpsMagnetShaderBindings {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPS_MAGNET_SHADER_BINDINGS, {});
    if (!isRecord(parsed)) return {};
    return parsed as PmpsMagnetShaderBindings;
  } catch {
    return {};
  }
}

function savePmpsMagnetShaderBindings(bindings: PmpsMagnetShaderBindings): void {
  if (typeof window === 'undefined') return;
  void broadcastDataUpdate(
    STORAGE_KEYS.PMPS_MAGNET_SHADER_BINDINGS,
    bindings,
    TAURI_EVENTS.PMPS_MAGNET_SHADER_BINDINGS_UPDATED
  );
}

export function getPmpsMagnetShaderBinding(magnetId: string): PmpsMagnetShaderBinding | null {
  const bindings = loadPmpsMagnetShaderBindings();
  const binding = bindings[magnetId];
  return binding ?? null;
}

export function upsertPmpsMagnetShaderBinding(
  magnetId: string,
  binding: PmpsMagnetShaderBinding
): void {
  const bindings = loadPmpsMagnetShaderBindings();
  bindings[magnetId] = binding;
  savePmpsMagnetShaderBindings(bindings);
}

export function removePmpsMagnetShaderBinding(magnetId: string): void {
  const bindings = loadPmpsMagnetShaderBindings();
  if (!(magnetId in bindings)) return;
  delete bindings[magnetId];
  savePmpsMagnetShaderBindings(bindings);
}

