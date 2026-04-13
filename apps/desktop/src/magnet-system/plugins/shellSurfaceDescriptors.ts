import type { ShellSurfaceContributionDescriptor } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import type { InstalledHostExtensionRecord } from './extensions';
import { getInstalledExtensionRecord } from './extensions';
import { readInstalledExtensionPmpHostContributions } from './installedExtensionHostPmp';

export type PluginShellSurfaceDescriptorRecord = {
  sourceKind: PluginSurfaceSourceKind;
  pluginId: string;
  pluginName: string;
  enabled: boolean;
  descriptor: ShellSurfaceContributionDescriptor;
};

export type PluginShellSurfaceLookup =
  | {
      status: 'present';
      record: PluginShellSurfaceDescriptorRecord;
    }
  | {
      status: 'missing-plugin';
      sourceKind: PluginSurfaceSourceKind;
      pluginId: string;
      surfaceId: string;
    }
  | {
      status: 'disabled-plugin' | 'missing-surface';
      sourceKind: PluginSurfaceSourceKind;
      pluginId: string;
      pluginName: string;
      surfaceId: string;
    };

function readInstalledExtensionShellSurfaceContribution(
  record: InstalledHostExtensionRecord,
  surfaceId: string
): ShellSurfaceContributionDescriptor | null {
  return (
    readInstalledExtensionPmpHostContributions(record)?.shellSurfaces?.find(
      (surface) => surface.id === surfaceId
    ) ?? null
  );
}

export function readPluginShellSurfaceDescriptor(options: {
  sourceKind: PluginSurfaceSourceKind;
  pluginId: string;
  surfaceId: string;
  surfaceType?: ShellSurfaceContributionDescriptor['surfaceType'];
}): PluginShellSurfaceLookup {
  if (options.sourceKind !== 'extv2') {
    return {
      status: 'missing-plugin',
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      surfaceId: options.surfaceId,
    };
  }

  const record = getInstalledExtensionRecord(options.pluginId);
  if (!record) {
    return {
      status: 'missing-plugin',
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      surfaceId: options.surfaceId,
    };
  }

  const pluginName = record.manifest.identity.displayName ?? record.manifest.identity.name;
  const enabled = record.enabled ?? true;
  if (!enabled) {
    return {
      status: 'disabled-plugin',
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      pluginName,
      surfaceId: options.surfaceId,
    };
  }

  const descriptor = readInstalledExtensionShellSurfaceContribution(record, options.surfaceId);
  if (!descriptor) {
    return {
      status: 'missing-surface',
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      pluginName,
      surfaceId: options.surfaceId,
    };
  }

  if (options.surfaceType && descriptor.surfaceType !== options.surfaceType) {
    return {
      status: 'missing-surface',
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      pluginName,
      surfaceId: options.surfaceId,
    };
  }

  return {
    status: 'present',
    record: {
      sourceKind: options.sourceKind,
      pluginId: options.pluginId,
      pluginName,
      enabled,
      descriptor,
    },
  };
}
