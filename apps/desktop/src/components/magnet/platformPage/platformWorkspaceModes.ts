import type {
  PlatformConnectorDefinition,
  PlatformConnectorWorkspaceKind,
  PlatformRuntimeWorkspaceRouting,
} from '../../../modules/music-platform';

export const GENERIC_PLATFORM_WORKSPACE_MODE = 'generic' as const;

export type PlatformWorkspaceMode =
  | typeof GENERIC_PLATFORM_WORKSPACE_MODE
  | `workspace:${string}`;

export interface PlatformWorkspaceDescriptor {
  mode: PlatformWorkspaceMode;
  connectorId?: string;
  workspaceKind: PlatformConnectorWorkspaceKind;
  displayName: string;
  labelKey?: string;
}

export interface PlatformWorkspaceRouteDisplayState {
  ownershipMode: 'legacy' | 'pack' | 'auto';
  path: 'legacy' | 'pack' | 'none';
  status: 'active' | 'fallback' | 'blocked';
  fallbackReasonCode: string | null;
  fallbackReasonMessage: string | null;
  packWorkspaceReady: boolean;
}

function normalizeConnectorId(connectorId: string): string {
  return connectorId.trim().toLowerCase();
}

export function toConnectorWorkspaceMode(connectorId: string): PlatformWorkspaceMode {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return GENERIC_PLATFORM_WORKSPACE_MODE;
  return `workspace:${normalizedConnectorId}`;
}

export function getWorkspaceConnectorId(mode: PlatformWorkspaceMode): string | null {
  if (mode === GENERIC_PLATFORM_WORKSPACE_MODE) return null;
  const prefix = 'workspace:';
  if (!mode.startsWith(prefix)) return null;
  const connectorId = mode.slice(prefix.length).trim();
  return connectorId.length > 0 ? connectorId : null;
}

export function buildPlatformWorkspaceDescriptors(
  definitions: PlatformConnectorDefinition[]
): PlatformWorkspaceDescriptor[] {
  const dedicatedDescriptors = definitions
    .filter((definition) => definition.workspaceMode === 'dedicated')
    .map<PlatformWorkspaceDescriptor>((definition) => ({
      mode: toConnectorWorkspaceMode(definition.connectorId),
      connectorId: normalizeConnectorId(definition.connectorId),
      workspaceKind: definition.workspaceKind,
      displayName: definition.displayName,
      labelKey: definition.labelKey,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));

  return [
    ...dedicatedDescriptors,
    {
      mode: GENERIC_PLATFORM_WORKSPACE_MODE,
      workspaceKind: 'generic',
      displayName: 'Generic',
      labelKey: 'magnet.platform.mode.generic',
    },
  ];
}

export function normalizeWorkspaceMode(
  mode: PlatformWorkspaceMode,
  descriptors: PlatformWorkspaceDescriptor[]
): PlatformWorkspaceMode {
  if (descriptors.some((item) => item.mode === mode)) {
    return mode;
  }

  return descriptors[0]?.mode ?? GENERIC_PLATFORM_WORKSPACE_MODE;
}

export function toPlatformWorkspaceRouteDisplayState(
  routing: PlatformRuntimeWorkspaceRouting | null | undefined
): PlatformWorkspaceRouteDisplayState {
  return {
    ownershipMode: routing?.ownershipMode ?? 'legacy',
    path: routing?.path ?? 'legacy',
    status: routing?.status ?? 'active',
    fallbackReasonCode: routing?.fallbackReasonCode ?? null,
    fallbackReasonMessage: routing?.fallbackReasonMessage ?? null,
    packWorkspaceReady: routing?.packWorkspaceReady ?? false,
  };
}

export function shouldRenderLegacyPlatformWorkspace(
  state: PlatformWorkspaceRouteDisplayState
): boolean {
  return state.path === 'legacy';
}

export function shouldRenderPackPlatformWorkspace(
  state: PlatformWorkspaceRouteDisplayState
): boolean {
  return state.path === 'pack' && state.status === 'active';
}

export function shouldRenderBlockedPackWorkspace(
  state: PlatformWorkspaceRouteDisplayState
): boolean {
  return state.status === 'blocked';
}
