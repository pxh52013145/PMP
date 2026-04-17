import {
  getNativeMusicPlatformGlobalCacheSettings,
  setNativeMusicPlatformGlobalCacheSettings,
  type NativeMusicPlatformGlobalCacheSettings,
} from '../music-library';

export interface MusicPlatformGlobalCacheSettings {
  customRootPath?: string;
  effectiveRootPath: string;
  defaultRootPath: string;
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
