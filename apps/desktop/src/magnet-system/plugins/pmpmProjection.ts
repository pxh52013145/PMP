import {
  convertInstalledPmpmPluginToInstalledExtensionRecord,
  convertPmpmManifestToPxpManifestV2,
  mapPmpmPermissionToCapabilityId,
  type InstalledPmpmPluginRecord,
  type PmpmManifest,
} from '@pixel-matrix/plugin-platform-contracts';
import type { InstalledExtensionRecord, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';

export type InstalledPmpmExtensionRecord = InstalledExtensionRecord<PxpManifestV2>;

export type PmpmPermissionCapabilityBinding = {
  permission: string;
  capabilityId: string;
  granted: boolean;
};

export function projectPmpmManifestToExtensionManifest(manifest: PmpmManifest): PxpManifestV2 {
  return convertPmpmManifestToPxpManifestV2(manifest);
}

export function projectInstalledPmpmPluginToExtensionRecord<TSignature = unknown>(
  plugin: InstalledPmpmPluginRecord<TSignature>
): InstalledPmpmExtensionRecord {
  return convertInstalledPmpmPluginToInstalledExtensionRecord(plugin);
}

export function listPmpmPermissionCapabilityBindings<TSignature = unknown>(
  plugin: InstalledPmpmPluginRecord<TSignature>
): PmpmPermissionCapabilityBinding[] {
  const deniedPermissions = new Set(
    Array.isArray(plugin.deniedPermissions)
      ? plugin.deniedPermissions
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : []
  );

  const permissions = Array.isArray(plugin.manifest.permissions)
    ? plugin.manifest.permissions
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  return permissions.map((permission) => ({
    permission,
    capabilityId: mapPmpmPermissionToCapabilityId(permission),
    granted: !deniedPermissions.has(permission),
  }));
}

export function listEffectiveCapabilityIdsFromInstalledPmpmPlugin<TSignature = unknown>(
  plugin: InstalledPmpmPluginRecord<TSignature>
): string[] {
  const seen = new Set<string>();
  const effective: string[] = [];

  for (const binding of listPmpmPermissionCapabilityBindings(plugin)) {
    if (!binding.granted || seen.has(binding.capabilityId)) {
      continue;
    }
    seen.add(binding.capabilityId);
    effective.push(binding.capabilityId);
  }

  return effective;
}
