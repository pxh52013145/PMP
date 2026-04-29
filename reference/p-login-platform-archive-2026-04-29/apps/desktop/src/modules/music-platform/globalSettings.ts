import { readJson } from '../storage';
import {
  getNativeMusicPlatformGlobalCacheSettings,
  setNativeMusicPlatformGlobalCacheSettings,
  type NativeMusicPlatformGlobalCacheSettings,
} from '../music-library';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import {
  BILIBILI_CONNECTOR_ID,
  NETEASE_CONNECTOR_ID,
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';

export interface MusicPlatformGlobalCacheSettings {
  customRootPath?: string;
  effectiveRootPath: string;
  defaultRootPath: string;
}

export const MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_MODES = [
  'legacy',
  'pack',
  'auto',
] as const;

export type MusicPlatformWorkspaceOwnershipMode =
  (typeof MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_MODES)[number];

export interface MusicPlatformWorkspaceOwnershipSettings {
  defaultMode: MusicPlatformWorkspaceOwnershipMode;
  connectorModes: Partial<Record<PlatformConnectorId, MusicPlatformWorkspaceOwnershipMode>>;
}

const DEFAULT_MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_SETTINGS: MusicPlatformWorkspaceOwnershipSettings =
  {
    defaultMode: 'legacy',
    connectorModes: {
      [BILIBILI_CONNECTOR_ID]: 'legacy',
      [NETEASE_CONNECTOR_ID]: 'auto',
    },
  };

function isWorkspaceOwnershipMode(value: unknown): value is MusicPlatformWorkspaceOwnershipMode {
  return (
    typeof value === 'string' &&
    MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_MODES.includes(
      value as MusicPlatformWorkspaceOwnershipMode
    )
  );
}

function cloneWorkspaceOwnershipSettings(
  settings: MusicPlatformWorkspaceOwnershipSettings
): MusicPlatformWorkspaceOwnershipSettings {
  return {
    defaultMode: settings.defaultMode,
    connectorModes: { ...settings.connectorModes },
  };
}

function sanitizeWorkspaceOwnershipSettings(
  value: unknown
): MusicPlatformWorkspaceOwnershipSettings {
  const fallback = cloneWorkspaceOwnershipSettings(
    DEFAULT_MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_SETTINGS
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const candidate = value as {
    defaultMode?: unknown;
    connectorModes?: unknown;
  };
  const next: MusicPlatformWorkspaceOwnershipSettings = {
    defaultMode: isWorkspaceOwnershipMode(candidate.defaultMode)
      ? candidate.defaultMode
      : fallback.defaultMode,
    connectorModes: { ...fallback.connectorModes },
  };

  if (
    candidate.connectorModes &&
    typeof candidate.connectorModes === 'object' &&
    !Array.isArray(candidate.connectorModes)
  ) {
    for (const [connectorId, mode] of Object.entries(candidate.connectorModes)) {
      const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
      if (!normalizedConnectorId || !isWorkspaceOwnershipMode(mode)) {
        continue;
      }
      next.connectorModes[normalizedConnectorId] = mode;
    }
  }

  return next;
}

function mapGlobalCacheSettings(
  settings: NativeMusicPlatformGlobalCacheSettings | null
): MusicPlatformGlobalCacheSettings | null {
  if (!settings) return null;
  return {
    customRootPath:
      typeof settings.customRootPath === 'string' && settings.customRootPath.trim().length > 0
        ? settings.customRootPath.trim()
        : undefined,
    effectiveRootPath: settings.effectiveRootPath,
    defaultRootPath: settings.defaultRootPath,
  };
}

export async function getMusicPlatformGlobalCacheSettings(): Promise<MusicPlatformGlobalCacheSettings | null> {
  return mapGlobalCacheSettings(await getNativeMusicPlatformGlobalCacheSettings());
}

export async function setMusicPlatformGlobalCacheSettings(
  customRootPath?: string | null
): Promise<MusicPlatformGlobalCacheSettings | null> {
  return mapGlobalCacheSettings(await setNativeMusicPlatformGlobalCacheSettings(customRootPath));
}

export function getDefaultMusicPlatformWorkspaceOwnershipSettings(): MusicPlatformWorkspaceOwnershipSettings {
  return cloneWorkspaceOwnershipSettings(
    DEFAULT_MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_SETTINGS
  );
}

export function readMusicPlatformWorkspaceOwnershipSettings(): MusicPlatformWorkspaceOwnershipSettings {
  if (typeof window === 'undefined') {
    return getDefaultMusicPlatformWorkspaceOwnershipSettings();
  }
  const raw = readJson<unknown>(STORAGE_KEYS.MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_V1, null);
  return sanitizeWorkspaceOwnershipSettings(raw);
}

export function resolveMusicPlatformWorkspaceOwnershipMode(
  connectorId: string,
  settings: MusicPlatformWorkspaceOwnershipSettings = readMusicPlatformWorkspaceOwnershipSettings()
): MusicPlatformWorkspaceOwnershipMode {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) {
    return settings.defaultMode;
  }
  return settings.connectorModes[normalizedConnectorId] ?? settings.defaultMode;
}

export async function persistMusicPlatformWorkspaceOwnershipSettings(
  settings: MusicPlatformWorkspaceOwnershipSettings
): Promise<MusicPlatformWorkspaceOwnershipSettings> {
  const sanitized = sanitizeWorkspaceOwnershipSettings(settings);
  await broadcastDataUpdate(
    STORAGE_KEYS.MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_V1,
    sanitized,
    TAURI_EVENTS.MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_UPDATED
  );
  return sanitized;
}

export async function setMusicPlatformConnectorWorkspaceOwnershipMode(
  connectorId: string,
  mode: MusicPlatformWorkspaceOwnershipMode
): Promise<MusicPlatformWorkspaceOwnershipSettings> {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) {
    throw new Error(`Invalid platform connector id for workspace ownership: ${connectorId}`);
  }
  if (!isWorkspaceOwnershipMode(mode)) {
    throw new Error(`Invalid music platform workspace ownership mode: ${String(mode)}`);
  }

  const next = readMusicPlatformWorkspaceOwnershipSettings();
  next.connectorModes[normalizedConnectorId] = mode;
  return await persistMusicPlatformWorkspaceOwnershipSettings(next);
}

export async function subscribeMusicPlatformWorkspaceOwnershipSettings(
  listener: () => void
): Promise<() => void> {
  return await setupDualListener(
    [STORAGE_KEYS.MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_V1],
    [TAURI_EVENTS.MUSIC_PLATFORM_WORKSPACE_OWNERSHIP_UPDATED],
    listener
  );
}
