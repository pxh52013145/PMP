import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { readJson, readString } from '../storage';

function hasStringFieldCandidates(raw: unknown, fieldName: string): boolean {
  if (!Array.isArray(raw)) return false;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = (entry as Record<string, unknown>)[fieldName];
    if (typeof value === 'string' && value.length > 0) {
      return true;
    }
  }
  return false;
}

export function shouldRunPmpsDurableMigration(): boolean {
  const flag = readString(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1);
  if (flag === 'rolled-back') return false;
  if (flag !== 'done') return true;
  return hasStringFieldCandidates(readJson<unknown>(STORAGE_KEYS.PMPS_SHADERS, []), 'fragmentCode');
}

export function shouldRunDurableStorageMigrations(): boolean {
  return shouldRunPmpsDurableMigration();
}

