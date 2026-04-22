import type {
  MusicPlatformWorkspaceDescriptor,
  MusicPlatformWorkspaceRootDescriptor,
  RuntimeCarrier,
} from '@pixel-matrix/plugin-platform-contracts';

import type { PlatformConnectorId } from './platformConnectorModel';

export const PLATFORM_PACK_WORKSPACE_DEFAULT_RUNTIME_CARRIER = 'webview-frame' as const;

export const PLATFORM_PACK_WORKSPACE_SUPPORTED_RUNTIME_CARRIERS = [
  PLATFORM_PACK_WORKSPACE_DEFAULT_RUNTIME_CARRIER,
] as const satisfies readonly RuntimeCarrier[];

export interface PlatformPackWorkspaceSurfaceRecord {
  connectorId: PlatformConnectorId;
  platformId: string;
  displayName: string;
  packId: string;
  packVersion: string;
  source: string;
  runtimeCode: string;
  runtimeImportUrl?: string;
  workspace: MusicPlatformWorkspaceDescriptor;
  root: MusicPlatformWorkspaceRootDescriptor;
  requiredRuntimeCarrier: RuntimeCarrier;
}

export interface CreatePlatformPackWorkspaceSurfaceRecordInput {
  connectorId: PlatformConnectorId;
  platformId: string;
  displayName: string;
  packId: string;
  packVersion: string;
  source: string;
  runtimeCode: string;
  runtimeImportUrl?: string;
  workspace: MusicPlatformWorkspaceDescriptor | null | undefined;
}

export function isPlatformPackWorkspaceHostRouterReady(): boolean {
  return true;
}

export function normalizePlatformPackWorkspaceRuntimeCarrier(
  carrier: RuntimeCarrier | null | undefined
): RuntimeCarrier {
  return carrier ?? PLATFORM_PACK_WORKSPACE_DEFAULT_RUNTIME_CARRIER;
}

export function isPlatformPackWorkspaceRuntimeCarrierSupported(
  carrier: RuntimeCarrier | null | undefined
): boolean {
  return (
    normalizePlatformPackWorkspaceRuntimeCarrier(carrier) ===
    PLATFORM_PACK_WORKSPACE_DEFAULT_RUNTIME_CARRIER
  );
}

export function createPlatformPackWorkspaceSurfaceRecord(
  input: CreatePlatformPackWorkspaceSurfaceRecordInput
): PlatformPackWorkspaceSurfaceRecord | null {
  const workspace = input.workspace;
  if (!workspace || workspace.ownership !== 'pack' || !workspace.root) {
    return null;
  }

  return {
    connectorId: input.connectorId,
    platformId: input.platformId,
    displayName: input.displayName,
    packId: input.packId,
    packVersion: input.packVersion,
    source: input.source,
    runtimeCode: input.runtimeCode,
    runtimeImportUrl: input.runtimeImportUrl,
    workspace: {
      ownership: workspace.ownership,
      requiredRuntimeCarrier: workspace.requiredRuntimeCarrier,
      root: {
        ...workspace.root,
      },
      shellSlots: workspace.shellSlots?.map((slot) => ({ ...slot })),
      capabilityFamilies: workspace.capabilityFamilies
        ? {
            required: workspace.capabilityFamilies.required?.slice(),
            optional: workspace.capabilityFamilies.optional?.slice(),
          }
        : undefined,
      context: workspace.context
        ? {
            scope: workspace.context.scope,
            fields: workspace.context.fields.slice(),
          }
        : undefined,
    },
    root: {
      ...workspace.root,
    },
    requiredRuntimeCarrier: normalizePlatformPackWorkspaceRuntimeCarrier(
      workspace.requiredRuntimeCarrier
    ),
  };
}

export function clonePlatformPackWorkspaceSurfaceRecord(
  record: PlatformPackWorkspaceSurfaceRecord
): PlatformPackWorkspaceSurfaceRecord {
  return {
    ...record,
    workspace: {
      ownership: record.workspace.ownership,
      requiredRuntimeCarrier: record.workspace.requiredRuntimeCarrier,
      root: record.workspace.root ? { ...record.workspace.root } : undefined,
      shellSlots: record.workspace.shellSlots?.map((slot) => ({ ...slot })),
      capabilityFamilies: record.workspace.capabilityFamilies
        ? {
            required: record.workspace.capabilityFamilies.required?.slice(),
            optional: record.workspace.capabilityFamilies.optional?.slice(),
          }
        : undefined,
      context: record.workspace.context
        ? {
            scope: record.workspace.context.scope,
            fields: record.workspace.context.fields.slice(),
          }
        : undefined,
    },
    root: {
      ...record.root,
    },
  };
}
