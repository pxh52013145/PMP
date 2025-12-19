import { STORAGE_KEYS } from '../../utils/windowCommunication';
import type { BackgroundConfig, BackgroundSettings } from '../../types/background';
import { persistBackgroundSnapshots } from './backgroundSnapshot';
import { readString, writeString } from '../storage';

type BackgroundHistoryItem = {
  id: string;
  config: BackgroundConfig;
  timestamp: number;
};

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isManagedBackgroundUrl(url: string): boolean {
  return /(?:^|\/)background-media\/background-[^/?#]+/.test(url);
}

function extractLocalPathFromBackgroundUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('data:') || url.startsWith('blob:')) return null;

  try {
    const parsed = new URL(url);
    const embedded = parsed.searchParams.get('path');
    if (embedded) {
      return decodeURIComponent(embedded);
    }

    const pathname = decodeURIComponent(parsed.pathname);
    if (!pathname) return null;
    if (/^\/[a-zA-Z]:\//.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return null;
  }
}

async function importFileToManagedBackgroundMedia(sourcePath: string, extensionHint?: string): Promise<string | null> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    const pathApi = await import('@tauri-apps/api/path');
    const tauri = await import('@tauri-apps/api/tauri');

    const exists = await fs.exists(sourcePath);
    if (!exists) return null;

    const extFromPath = sourcePath.split('.').pop()?.toLowerCase();
    const ext = extFromPath || extensionHint || 'png';
    const fileName = `background-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const relativePath = `background-media/${fileName}`;

    await fs.createDir('background-media', { dir: fs.BaseDirectory.AppData, recursive: true });
    await fs.copyFile(sourcePath, relativePath, { dir: fs.BaseDirectory.AppData });

    const appDataDir = await pathApi.appDataDir();
    const fullPath = await pathApi.join(appDataDir, 'background-media', fileName);
    return tauri.convertFileSrc(fullPath);
  } catch (error) {
    console.warn('[background] Failed to import external background media:', error);
    return null;
  }
}

async function migrateConfig(config: BackgroundConfig): Promise<{ config: BackgroundConfig; migrated: boolean }> {
  if (config.type === 'image') {
    const url = config.image?.url || '';
    if (!url || isManagedBackgroundUrl(url)) return { config, migrated: false };

    const sourcePath = extractLocalPathFromBackgroundUrl(url);
    if (!sourcePath) return { config, migrated: false };

    const migratedUrl = await importFileToManagedBackgroundMedia(sourcePath, 'png');
    if (!migratedUrl) return { config, migrated: false };

    const image = config.image ?? { url: '', fit: 'cover', position: 'center center', repeat: 'no-repeat' };
    return { config: { ...config, image: { ...image, url: migratedUrl } }, migrated: true };
  }

  if (config.type === 'video') {
    const url = config.video?.url || '';
    if (!url || isManagedBackgroundUrl(url)) return { config, migrated: false };

    const sourcePath = extractLocalPathFromBackgroundUrl(url);
    if (!sourcePath) return { config, migrated: false };

    const migratedUrl = await importFileToManagedBackgroundMedia(sourcePath, 'mp4');
    if (!migratedUrl) return { config, migrated: false };

    const video = config.video ?? { url: '', fit: 'contain', loop: true, muted: true };
    return { config: { ...config, video: { ...video, url: migratedUrl } }, migrated: true };
  }

  return { config, migrated: false };
}

export async function migrateBackgroundStorageToManagedMedia(): Promise<{
  migratedSettings: boolean;
  migratedHistory: boolean;
  migratedCount: number;
}> {
  let migratedSettings = false;
  let migratedHistory = false;
  let migratedCount = 0;

  const settings = safeParseJson<BackgroundSettings>(readString(STORAGE_KEYS.BACKGROUND_SETTINGS));
  if (settings) {
    const [maximized, windowed] = await Promise.all([migrateConfig(settings.maximized), migrateConfig(settings.windowed)]);
    if (maximized.migrated || windowed.migrated) {
      const next: BackgroundSettings = {
        ...settings,
        maximized: maximized.config,
        windowed: windowed.config,
      };
      const json = JSON.stringify(next);
      writeString(STORAGE_KEYS.BACKGROUND_SETTINGS, json);
      await persistBackgroundSnapshots({ storageKey: STORAGE_KEYS.BACKGROUND_SETTINGS, json });
      migratedSettings = true;
      migratedCount += Number(maximized.migrated) + Number(windowed.migrated);
    }
  }

  const history = safeParseJson<BackgroundHistoryItem[]>(readString(STORAGE_KEYS.BACKGROUND_HISTORY));
  if (history && history.length > 0) {
    const migratedItems = await Promise.all(
      history.map(async (item) => {
        const migrated = await migrateConfig(item.config);
        return { item: migrated.migrated ? { ...item, config: migrated.config } : item, migrated: migrated.migrated };
      })
    );

    const hasChanges = migratedItems.some((entry) => entry.migrated);
    if (hasChanges) {
      const next = migratedItems.map((entry) => entry.item);
      const json = JSON.stringify(next);
      writeString(STORAGE_KEYS.BACKGROUND_HISTORY, json);
      await persistBackgroundSnapshots({ storageKey: STORAGE_KEYS.BACKGROUND_HISTORY, json });
      migratedHistory = true;
      migratedCount += migratedItems.reduce((sum, entry) => sum + Number(entry.migrated), 0);
    }
  }

  return { migratedSettings, migratedHistory, migratedCount };
}

export const __testOnly__ = {
  extractLocalPathFromBackgroundUrl,
  isManagedBackgroundUrl,
};
