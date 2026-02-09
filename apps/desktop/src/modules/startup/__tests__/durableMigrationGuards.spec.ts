import { beforeEach, describe, expect, it } from 'vitest';
import {
  shouldRunDurableStorageMigrations,
  shouldRunPmpmDurableMigration,
  shouldRunPmpsDurableMigration,
} from '../durableMigrationGuards';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

describe('durable migration startup guards', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1);
    localStorage.removeItem(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1);
    localStorage.removeItem(STORAGE_KEYS.PMPM_PLUGINS);
    localStorage.removeItem(STORAGE_KEYS.PMPS_SHADERS);
  });

  it('skips PMPM migration when done and no legacy entryCode payloads', () => {
    localStorage.setItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([{ manifest: { metadata: { id: 'demo' } }, entryCode: '' }])
    );

    expect(shouldRunPmpmDurableMigration()).toBe(false);
  });

  it('runs PMPM migration when done but legacy entryCode payload exists', () => {
    localStorage.setItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(
      STORAGE_KEYS.PMPM_PLUGINS,
      JSON.stringify([{ manifest: { metadata: { id: 'demo' } }, entryCode: 'legacy-code' }])
    );

    expect(shouldRunPmpmDurableMigration()).toBe(true);
  });

  it('skips PMPS migration when done and no legacy fragmentCode payloads', () => {
    localStorage.setItem(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(
      STORAGE_KEYS.PMPS_SHADERS,
      JSON.stringify([{ manifest: { metadata: { id: 'shader' } }, fragmentCode: '' }])
    );

    expect(shouldRunPmpsDurableMigration()).toBe(false);
  });

  it('runs PMPS migration when done but legacy fragmentCode payload exists', () => {
    localStorage.setItem(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(
      STORAGE_KEYS.PMPS_SHADERS,
      JSON.stringify([{ manifest: { metadata: { id: 'shader' } }, fragmentCode: 'legacy-fragment' }])
    );

    expect(shouldRunPmpsDurableMigration()).toBe(true);
  });

  it('aggregates both guards through durable migration gate', () => {
    localStorage.setItem(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(STORAGE_KEYS.PMPM_PLUGINS, '[]');
    localStorage.setItem(STORAGE_KEYS.PMPS_DURABLE_MIGRATION_V1, 'done');
    localStorage.setItem(
      STORAGE_KEYS.PMPS_SHADERS,
      JSON.stringify([{ manifest: { metadata: { id: 'shader' } }, fragmentCode: 'legacy' }])
    );

    expect(shouldRunDurableStorageMigrations()).toBe(true);
  });
});

