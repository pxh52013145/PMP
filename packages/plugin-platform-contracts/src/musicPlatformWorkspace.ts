import type { RuntimeCarrier } from './runtime-bridge';

export type MusicPlatformWorkspaceOwnership = 'host' | 'pack';

export const MUSIC_PLATFORM_WORKSPACE_ROOT_SLOT_ID = 'workspace.root' as const;
export const MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT =
  'host.pmp.music-platform.workspace.root' as const;

export const MUSIC_PLATFORM_WORKSPACE_SHELL_SLOT_IDS = [
  'workspace.shell.leading',
  'workspace.shell.search',
  'workspace.shell.navigation',
  'workspace.shell.actions',
  'workspace.sidebar.primary',
  'workspace.sidebar.secondary',
  'workspace.body',
  'workspace.footer.leading',
  'workspace.footer.trailing',
] as const;

export type MusicPlatformWorkspaceShellSlotId =
  (typeof MUSIC_PLATFORM_WORKSPACE_SHELL_SLOT_IDS)[number];

export const MUSIC_PLATFORM_WORKSPACE_SHELL_SURFACE_SLOTS = {
  'workspace.shell.leading': 'host.pmp.music-platform.workspace.shell.leading',
  'workspace.shell.search': 'host.pmp.music-platform.workspace.shell.search',
  'workspace.shell.navigation': 'host.pmp.music-platform.workspace.shell.navigation',
  'workspace.shell.actions': 'host.pmp.music-platform.workspace.shell.actions',
  'workspace.sidebar.primary': 'host.pmp.music-platform.workspace.sidebar.primary',
  'workspace.sidebar.secondary': 'host.pmp.music-platform.workspace.sidebar.secondary',
  'workspace.body': 'host.pmp.music-platform.workspace.body',
  'workspace.footer.leading': 'host.pmp.music-platform.workspace.footer.leading',
  'workspace.footer.trailing': 'host.pmp.music-platform.workspace.footer.trailing',
} as const satisfies Record<MusicPlatformWorkspaceShellSlotId, string>;

export type MusicPlatformWorkspaceSurfaceSlot =
  | typeof MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT
  | (typeof MUSIC_PLATFORM_WORKSPACE_SHELL_SURFACE_SLOTS)[MusicPlatformWorkspaceShellSlotId];

export const MUSIC_PLATFORM_WORKSPACE_CONTEXT_FIELDS = [
  'connectorId',
  'platformId',
  'instanceId',
  'authSession',
  'cacheScope',
  'grantedCapabilityFamilies',
] as const;

export type MusicPlatformWorkspaceContextField =
  (typeof MUSIC_PLATFORM_WORKSPACE_CONTEXT_FIELDS)[number];

export interface MusicPlatformWorkspaceContextDescriptor {
  scope: 'platform-instance';
  fields: MusicPlatformWorkspaceContextField[];
}

export interface MusicPlatformWorkspaceCapabilityFamilies {
  required?: string[];
  optional?: string[];
}

export interface MusicPlatformWorkspaceRootDescriptor {
  viewId: string;
  viewType?: string;
}

export interface MusicPlatformWorkspaceShellSlotDescriptor {
  slotId: MusicPlatformWorkspaceShellSlotId;
  viewId: string;
  viewType?: string;
}

export interface MusicPlatformWorkspaceDescriptor {
  ownership: MusicPlatformWorkspaceOwnership;
  requiredRuntimeCarrier?: RuntimeCarrier;
  root?: MusicPlatformWorkspaceRootDescriptor;
  shellSlots?: MusicPlatformWorkspaceShellSlotDescriptor[];
  capabilityFamilies?: MusicPlatformWorkspaceCapabilityFamilies;
  context?: MusicPlatformWorkspaceContextDescriptor;
}

export function isMusicPlatformWorkspaceShellSlotId(
  value: unknown
): value is MusicPlatformWorkspaceShellSlotId {
  return (
    typeof value === 'string' &&
    MUSIC_PLATFORM_WORKSPACE_SHELL_SLOT_IDS.includes(
      value as MusicPlatformWorkspaceShellSlotId
    )
  );
}

export function isMusicPlatformWorkspaceContextField(
  value: unknown
): value is MusicPlatformWorkspaceContextField {
  return (
    typeof value === 'string' &&
    MUSIC_PLATFORM_WORKSPACE_CONTEXT_FIELDS.includes(
      value as MusicPlatformWorkspaceContextField
    )
  );
}

export function resolveMusicPlatformWorkspaceShellSurfaceSlot(
  slotId: MusicPlatformWorkspaceShellSlotId
): MusicPlatformWorkspaceSurfaceSlot {
  return MUSIC_PLATFORM_WORKSPACE_SHELL_SURFACE_SLOTS[slotId];
}
