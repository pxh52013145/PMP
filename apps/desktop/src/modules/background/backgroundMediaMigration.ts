import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import type { BackgroundConfig, BackgroundSettings } from '../../types/background';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { persistBackgroundSnapshots } from './backgroundSnapshot';
import { readString, writeString } from '../storage';

const telemetry = getTelemetryLogger('background', 'backgroundMediaMigration');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BackgroundHistoryItem = {
  id: string;
  config: BackgroundConfig;
  timestamp: number;
};

type BackgroundImportInvokeResult =
  | string
  | {
      destPath: string;
      sourceBytes?: number;
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

async function importFileToManagedBackgroundMedia(
  sourcePath: string,
  kind: 'image' | 'video'
): Promise<string | null> {
  try {
    const tauri = await import('@tauri-apps/api/tauri');
    const importResult = await tauri.invoke<BackgroundImportInvokeResult>('background_import_media', {
      sourcePath,
      kind,
    });
    const destPath =
      typeof importResult === 'string' ? importResult : importResult?.destPath || '';
    if (!destPath) return null;
    return tauri.convertFileSrc(destPath);
  } catch (error) {
    telemetry.warn('background.import_media.failed', {
      message: readErrorMessage(error),
      fields: {
        sourcePath,
        kind,
      },
    });
    return null;
  }
}

async function migrateConfig(config: BackgroundConfig): Promise<{ config: BackgroundConfig; migrated: boolean }> {
  if (config.type === 'image') {
    const url = config.image?.url || '';
    if (!url || isManagedBackgroundUrl(url)) return { config, migrated: false };

    const sourcePath = extractLocalPathFromBackgroundUrl(url);
    if (!sourcePath) return { config, migrated: false };

    const migratedUrl = await importFileToManagedBackgroundMedia(sourcePath, 'image');
    if (!migratedUrl) return { config, migrated: false };

    const image = config.image ?? { url: '', fit: 'cover', position: 'center center', repeat: 'no-repeat' };
    return { config: { ...config, image: { ...image, url: migratedUrl } }, migrated: true };
  }

  if (config.type === 'video') {
    const url = config.video?.url || '';
    if (!url || isManagedBackgroundUrl(url)) return { config, migrated: false };

    const sourcePath = extractLocalPathFromBackgroundUrl(url);
    if (!sourcePath) return { config, migrated: false };

    const migratedUrl = await importFileToManagedBackgroundMedia(sourcePath, 'video');
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
  const status = readString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1);
  if (status === 'done' || status === '1') {
    return { migratedSettings: false, migratedHistory: false, migratedCount: 0 };
  }

  let migratedSettings = false;
  let migratedHistory = false;
  let migratedCount = 0;

  try {
    const settings = safeParseJson<BackgroundSettings>(readString(STORAGE_KEYS.BACKGROUND_SETTINGS));
    if (settings) {
      const [maximized, windowed] = await Promise.all([
        migrateConfig(settings.maximized),
        migrateConfig(settings.windowed),
      ]);
      if (maximized.migrated || windowed.migrated) {
        const next: BackgroundSettings = {
          ...settings,
          maximized: maximized.config,
          windowed: windowed.config,
        };
        const json = JSON.stringify(next);
        await broadcastDataUpdate(STORAGE_KEYS.BACKGROUND_SETTINGS, next, TAURI_EVENTS.BACKGROUND_UPDATED);
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
          return {
            item: migrated.migrated ? { ...item, config: migrated.config } : item,
            migrated: migrated.migrated,
          };
        })
      );

      const hasChanges = migratedItems.some((entry) => entry.migrated);
      if (hasChanges) {
        const next = migratedItems.map((entry) => entry.item);
        const json = JSON.stringify(next);
        await broadcastDataUpdate(STORAGE_KEYS.BACKGROUND_HISTORY, next, TAURI_EVENTS.BACKGROUND_UPDATED);
        await persistBackgroundSnapshots({ storageKey: STORAGE_KEYS.BACKGROUND_HISTORY, json });
        migratedHistory = true;
        migratedCount += migratedItems.reduce((sum, entry) => sum + Number(entry.migrated), 0);
      }
    }

    // Keep compatible with legacy flag checks in UI.
    writeString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1, '1');
  } catch (error) {
    telemetry.warn('background.migration.failed', {
      message: readErrorMessage(error),
    });
    writeString(STORAGE_KEYS.BACKGROUND_MEDIA_MIGRATION_V1, 'failed');
  }

  return { migratedSettings, migratedHistory, migratedCount };
}

export const __testOnly__ = {
  extractLocalPathFromBackgroundUrl,
  isManagedBackgroundUrl,
};
